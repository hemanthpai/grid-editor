/**
 * Renderer-side AI agent bridge.
 *
 * The external `package-ai-agent` hosts an MCP server in the package process,
 * but the live config tree / validator / stores live here in the renderer.
 * This module answers structured queries that arrive over the MessagePort the
 * package opens to us (see App.svelte's "agent-bridge-ready" handler). Read /
 * observe / validate methods are unguarded. The mutating methods (write_script,
 * send_immediate) re-validate server-side and then stage the change for explicit
 * human approval (stageApproval) — nothing reaches a device without it.
 *
 * Wire protocol (package -> renderer): { id, method, params }
 *               (renderer -> package): { id, ok: true, result }
 *                                    | { id, ok: false, error }
 */
import { get } from "svelte/store";
import { mount } from "svelte";
import { NumberToEventType, GridScript } from "@intechstudio/grid-protocol";
import { runtime_manager } from "../runtime-manager.store";
import { GridAction } from "../runtime";
import { logger } from "../runtime.store";
import {
  debug_monitor_store,
  lua_error_store,
} from "../../main/panels/DebugMonitor/DebugMonitor.store";
import { Modal } from "../../main/modals/modal.store";
import AgentApproval from "./AgentApproval.svelte";
import AgentLauncher from "./AgentLauncher.svelte";
import { validateScript } from "./validate";
import { getFunctionReference, scopeWarnings } from "./grid-context";
import { agent_activity } from "./agent-activity.store";

// Mount the floating "Ask the agent" launcher once, when the bridge first
// connects. Self-contained (appended to body) so it needs no layout changes.
let launcherMounted = false;
function ensureLauncher(): void {
  if (launcherMounted || typeof document === "undefined") return;
  launcherMounted = true;
  const node = document.createElement("div");
  document.body.appendChild(node);
  mount(AgentLauncher, { target: node });
}

interface ApprovalRequest {
  title: string;
  targetLabel: string;
  oldScript?: string;
  newScript: string;
  warnings: string[];
  approveLabel: string;
}

/**
 * Stage a write for explicit human approval: open the approval dialog and
 * resolve only when the user decides (or closes the dialog — treated as a
 * rejection). Nothing reaches a device until this resolves `approved: true`.
 */
function stageApproval(
  request: ApprovalRequest,
): Promise<{ approved: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (approved: boolean) => {
      if (!settled) {
        settled = true;
        resolve({ approved });
      }
    };
    const win = new Modal.Window(AgentApproval as any);
    win.show({
      request,
      decide: (approved: boolean) => done(approved),
      onClosed: () => done(false),
    });
  });
}

interface AgentRequest {
  id: number;
  method: string;
  params?: Record<string, any>;
}

function activeRuntime(): any {
  const rt = get(runtime_manager)?.active?.runtime;
  if (!rt) throw new Error("No active Grid connection.");
  return rt;
}

async function handle(
  method: string,
  params: Record<string, any> = {},
): Promise<unknown> {
  switch (method) {
    case "list_modules": {
      const rt = activeRuntime();
      return rt.modules.map((m: any) => ({
        dx: m.dx,
        dy: m.dy,
        type: m.type,
        architecture: m.architecture,
        fwVersion: m.fwVersion,
        pages: (m.pages ?? []).map((p: any) => p.pageNumber),
      }));
    }

    case "list_elements": {
      const { dx, dy, page = 0 } = params;
      const p = activeRuntime().findPage(dx, dy, page);
      if (!p) throw new Error(`No page ${page} on module (${dx},${dy}).`);
      return p.control_elements.map((el: any) => ({
        element: el.elementIndex,
        type: el.type,
        name: el.name,
      }));
    }

    case "list_events": {
      const { dx, dy, page = 0, element } = params;
      const el = activeRuntime().findElement(dx, dy, page, element);
      if (!el)
        throw new Error(`No element ${element} on (${dx},${dy}) page ${page}.`);
      return el.events.map((ev: any) => ({
        event: ev.type,
        name: NumberToEventType(ev.type),
        state: ev.state,
      }));
    }

    case "get_config": {
      const { dx, dy, page = 0, element, event } = params;
      const rt = activeRuntime();
      const ev = rt.findEvent(dx, dy, page, element, event);
      if (!ev) {
        throw new Error(
          `Event not found: (${dx},${dy}) page ${page} element ${element} event ${event}.`,
        );
      }
      let script = ev.toLua();
      // Best-effort: fetch from device if this event hasn't been loaded yet.
      if (!script && typeof ev.load === "function") {
        try {
          await ev.load();
          script = ev.toLua();
        } catch {
          /* leave script as-is */
        }
      }
      const el = rt.findElement(dx, dy, page, element);
      return { script, scope: el?.type, stored: ev.stored, state: ev.state };
    }

    case "dump_all": {
      // Full config tree for the file-export workflow: every event's script
      // across all modules/pages/elements, with element scope.
      const rt = activeRuntime();
      const modules = [];
      for (const m of rt.modules) {
        const mod: any = { dx: m.dx, dy: m.dy, type: m.type, pages: [] };
        for (const p of m.pages ?? []) {
          const page: any = { page: p.pageNumber, elements: [] };
          for (const el of p.control_elements) {
            const elem: any = {
              element: el.elementIndex,
              scope: el.type,
              name: el.name,
              events: [],
            };
            for (const ev of el.events) {
              let script = ev.toLua();
              if (!script && typeof ev.load === "function") {
                try {
                  await ev.load();
                  script = ev.toLua();
                } catch {
                  /* leave empty */
                }
              }
              elem.events.push({
                event: ev.type,
                name: NumberToEventType(ev.type),
                script,
              });
            }
            page.elements.push(elem);
          }
          mod.pages.push(page);
        }
        modules.push(mod);
      }
      return { modules };
    }

    case "get_function_reference":
      return getFunctionReference(params.scope);

    case "validate_script":
      return validateScript(String(params.script ?? ""));

    case "read_debug_log": {
      const limit = Number(params.limit ?? 50);
      const entries = get(debug_monitor_store) as unknown[];
      return entries.slice(-limit);
    }

    case "read_errors": {
      const limit = Number(params.limit ?? 15);
      const entries = get(lua_error_store) as unknown[];
      return entries.slice(-limit);
    }

    case "write_script": {
      const { dx, dy, page = 0, element, event } = params;
      const raw = String(params.script ?? "");
      const rt = activeRuntime();
      const ev = rt.findEvent(dx, dy, page, element, event);
      if (!ev) {
        throw new Error(
          `Event not found: (${dx},${dy}) page ${page} element ${element} event ${event}.`,
        );
      }
      const el = rt.findElement(dx, dy, page, element);
      const scope: string | undefined = el?.type;

      // Bare Lua has no action-block annotations; wrap it as a single code
      // block so the runtime parser produces an action.
      const normalized = /--\[\[@/.test(raw) ? raw : `--[[@cb]] ${raw}`;
      const newActions = GridAction.parse(normalized);
      if (newActions.length === 0) {
        throw new Error(
          "Script did not parse into any action blocks. Pass intech_lua, or the editor's --[[@short]] block form.",
        );
      }

      // Server-side re-validation, independent of anything the agent asserts:
      // re-run the real parser/length/forbidden check per action block.
      const invalid = newActions
        .map((a: any) => ({ short: a.short, ...validateScript(a.script) }))
        .filter((b: any) => !b.ok);
      if (invalid.length > 0) {
        throw new Error(
          "Validation failed: " +
            invalid.map((b: any) => `[${b.short}] ${b.error}`).join("; "),
        );
      }

      const targetLabel =
        `module (${dx},${dy}) · page ${page} · element ${element}` +
        ` (${scope ?? "?"}) · event ${event}`;
      const oldScript = ev.toLua();
      const warnings = scopeWarnings(raw, scope);

      agent_activity.log({ kind: "write-proposed", target: targetLabel });

      const decision = await stageApproval({
        title: "AI agent wants to write a script",
        targetLabel,
        oldScript,
        newScript: normalized,
        warnings,
        approveLabel: "Approve & apply",
      });
      if (!decision.approved) {
        agent_activity.log({ kind: "write-rejected", target: targetLabel });
        return {
          applied: false,
          reason: "Rejected by the user in the editor.",
        };
      }

      try {
        const current = [...ev.config];
        if (current.length > 0) await ev.remove(...current);
        await ev.insert(0, ...newActions);
        await ev.sendToGrid();
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        agent_activity.log({
          kind: "write-failed",
          target: targetLabel,
          detail,
        });
        throw new Error(`Apply failed: ${detail}`);
      }

      agent_activity.log({ kind: "write-applied", target: targetLabel });
      logger.set({
        type: "success",
        message: `AI agent applied a script to element ${element}, event ${event}.`,
      });
      return { applied: true, target: { dx, dy, page, element, event } };
    }

    case "send_immediate": {
      const raw = String(params.script ?? "");
      const dx = typeof params.dx === "number" ? params.dx : -127;
      const dy = typeof params.dy === "number" ? params.dy : -127;
      // Ensure there is an active connection to run on.
      activeRuntime();

      const v = validateScript(raw);
      if (!v.ok) {
        throw new Error(`Validation failed: ${v.error}`);
      }

      const targetLabel =
        dx === -127 && dy === -127
          ? "all connected modules"
          : `module (${dx},${dy})`;

      agent_activity.log({ kind: "exec-proposed", target: targetLabel });

      const decision = await stageApproval({
        title: "AI agent wants to run Lua on the device",
        targetLabel,
        newScript: raw, // no diff — this is a one-off execution
        warnings: [],
        approveLabel: "Approve & run",
      });
      if (!decision.approved) {
        agent_activity.log({ kind: "exec-rejected", target: targetLabel });
        return {
          executed: false,
          reason: "Rejected by the user in the editor.",
        };
      }

      try {
        // LUAExecImmediate compresses + sends SendConfigImmediate to the device.
        runtime_manager.LUAExecImmediate(dx, dy, raw);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        agent_activity.log({
          kind: "exec-failed",
          target: targetLabel,
          detail,
        });
        throw new Error(`Execution failed: ${detail}`);
      }

      agent_activity.log({ kind: "exec-run", target: targetLabel });
      logger.set({
        type: "success",
        message: `AI agent ran a one-off script on ${targetLabel}.`,
      });
      return {
        executed: true,
        note: "Use read_debug_log / read_errors to observe the result.",
      };
    }

    default:
      throw new Error(`Unknown agent method: ${method}`);
  }
}

/**
 * Wire up a MessagePort (opened by the renderer to the agent package) as a
 * request/response server.
 */
export function setupAgentBridge(port: MessagePort): void {
  port.onmessage = async (e: MessageEvent) => {
    const req = e.data as AgentRequest;
    if (!req || typeof req.id !== "number" || typeof req.method !== "string")
      return;
    try {
      const result = await handle(req.method, req.params ?? {});
      port.postMessage({ id: req.id, ok: true, result });
    } catch (err) {
      port.postMessage({
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
  port.start?.();
  ensureLauncher();
  // Let the package know the renderer side is live.
  port.postMessage({ type: "bridge-ready" });
}
