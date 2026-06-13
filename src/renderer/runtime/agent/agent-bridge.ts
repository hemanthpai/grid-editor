/**
 * Renderer-side AI agent bridge.
 *
 * The external `package-ai-agent` hosts an MCP server in the package process,
 * but the live config tree / validator / stores live here in the renderer.
 * This module answers structured, READ-ONLY queries that arrive over the
 * MessagePort the package opens to us (see App.svelte's "agent-bridge-ready"
 * handler). No mutating methods are implemented — writing to hardware is gated
 * behind a later phase + an approval gate.
 *
 * Wire protocol (package -> renderer): { id, method, params }
 *               (renderer -> package): { id, ok: true, result }
 *                                    | { id, ok: false, error }
 */
import { get } from "svelte/store";
import { NumberToEventType } from "@intechstudio/grid-protocol";
import { runtime_manager } from "../runtime-manager.store";
import {
  debug_monitor_store,
  lua_error_store,
} from "../../main/panels/DebugMonitor/DebugMonitor.store";
import { validateScript } from "./validate";
import { getFunctionReference } from "./grid-context";

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
  // Let the package know the renderer side is live.
  port.postMessage({ type: "bridge-ready" });
}
