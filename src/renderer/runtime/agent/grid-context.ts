/**
 * Scope-aware intech_lua function reference for the AI agent bridge.
 *
 * Reproduces the scope-filtering branches monaco.ts uses when building Lua
 * completions, so get_function_reference(scope) gives the agent exactly the
 * functions valid for an element type (its grounding corpus).
 */
import { grid, ElementType } from "@intechstudio/grid-protocol";

const ELEMENT_TYPE_MAPPING: Record<string, string> = {
  GRID_LUA_FNC_EP: "endless",
  GRID_LUA_FNC_E: "encoder",
  GRID_LUA_FNC_B: "button",
  GRID_LUA_FNC_P: "potmeter",
  GRID_LUA_FNC_L: "lcd",
};

export interface FunctionRef {
  key: string;
  name: string;
  helper?: string;
}

/**
 * @param scope element type (e.g. "button"); undefined returns the full list.
 */
export function getFunctionReference(scope?: string): FunctionRef[] {
  const out: FunctionRef[] = [];

  for (const [key, value] of grid.lua_function_to_human_map()) {
    const prefix = Object.keys(ELEMENT_TYPE_MAPPING).find((p) =>
      key.startsWith(p),
    );

    let include = false;
    if (
      prefix &&
      (scope === ELEMENT_TYPE_MAPPING[prefix] || scope === undefined)
    ) {
      // Scoped element function matching the requested element type.
      include = true;
    } else if (scope === ElementType.SYSTEM || !scope) {
      // System scope (or unscoped) sees element[0] functions.
      include = true;
    } else if (!prefix) {
      // Global (non-element-scoped) function — always available.
      include = true;
    }

    if (include) {
      const helper = grid.get_lua_function_helper(key);
      out.push({ key, name: value, helper: helper ?? undefined });
    }
  }

  return out;
}
