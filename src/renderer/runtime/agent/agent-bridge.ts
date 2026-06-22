/**
 * Renderer-side AI agent bridge.
 *
 * The external `package-ai-agent` hosts an MCP server in the package process,
 * but the live config tree / validator / stores live here in the renderer.
 * This module answers structured queries that arrive over the MessagePort the
 * package opens to us (see App.svelte's "agent-bridge-ready" handler). Read /
 * observe / validate methods are unguarded. The mutating methods (write_script,
 * send_immediate) re-validate server-side and then apply immediately (auto-apply)
 * — server-side validation is the gate, and changes are only persisted to the
 * module's memory when the user clicks Store in the editor.
 *
 * Wire protocol (package -> renderer): { id, method, params }
 *               (renderer -> package): { id, ok: true, result }
 *                                    | { id, ok: false, error }
 */
import { get } from "svelte/store";
import { mount } from "svelte";
import {
  NumberToEventType,
  GridScript,
  grid,
} from "@intechstudio/grid-protocol";
import { runtime_manager } from "../runtime-manager.store";
import { GridAction } from "../runtime";
import { logger } from "../runtime.store";
import {
  debug_monitor_store,
  lua_error_store,
} from "../../main/panels/DebugMonitor/DebugMonitor.store";
import AgentLauncher from "./AgentLauncher.svelte";
import { validateScript } from "./validate";
import { getFunctionReference } from "./grid-context";
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

      // Fetch the event from the device first. An unloaded event has empty/stale
      // config AND GridEvent.sendToGrid() silently no-ops on it (returns success
      // without transmitting), so the change would never reach the device and a
      // later Store would persist the OLD config. load() is idempotent.
      if (typeof ev.load === "function") {
        try {
          await ev.load();
        } catch {
          /* the post-send transmit check below will catch a non-transmit */
        }
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

      // Fast length pre-check — mirror GridEvent.insert (write_script REPLACES
      // the event, so the budget is the full cap). Fail before staging approval.
      const cap = grid.getProperty("CONFIG_LENGTH");
      const storedLength = newActions
        .map((a: any) => a.toLua())
        .join("").length;
      if (storedLength >= cap) {
        throw new Error(
          `Script too long: stored form is ${storedLength} chars; the limit is ` +
            `${cap - 1} (CONFIG_LENGTH ${cap}). The stored form includes ~10 chars of ` +
            `per-block annotation. Shorten the script.`,
        );
      }

      const targetLabel =
        `module (${dx},${dy}) · page ${page} · element ${element}` +
        ` (${scope ?? "?"}) · event ${event}`;

      // Auto-apply: server-side validation above is the gate; the change is
      // synced live and only persisted when the user clicks Store.
      try {
        const current = [...ev.config];
        if (current.length > 0) await ev.remove(...current);
        await ev.insert(0, ...newActions);
        const sync: any = await ev.sendToGrid();
        // sendToGrid resolves value:true even when it transmits nothing (event
        // not loaded / invalid). Treat a non-transmit as a real failure so we
        // never report success for a change the device never received.
        const text = String(sync?.text ?? "");
        if (!sync?.value || /nothing to sync/i.test(text)) {
          throw new Error(
            `the editor did not transmit the config to the device${
              text ? ` (${text})` : ""
            }`,
          );
        }
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
        message: `AI agent applied a script to element ${element}, event ${event}. Click Store to persist it.`,
      });
      return {
        applied: true,
        target: { dx, dy, page, element, event },
        note: "Synced to the device (live). Persisting to the module's memory requires clicking Store in the editor.",
      };
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

      // Auto-apply: validation above is the gate; run the one-off immediately.
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
