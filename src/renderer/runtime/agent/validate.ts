/**
 * Shared intech_lua validator for the AI agent bridge.
 *
 * Mirrors the validate + length + forbidden-identifier logic that
 * Monaco.svelte / monaco.ts apply when editing a script, so the agent's
 * validate_script loop uses the SAME real parser the editor does. Read-only —
 * never touches hardware.
 */
import { GridScript, grid } from "@intechstudio/grid-protocol";
import { Grid } from "../../lib/_utils";

export interface ValidateResult {
  ok: boolean;
  compressedLength?: number;
  maxLength: number;
  error?: string;
  forbidden?: string[];
}

let _forbiddens: string[] | null = null;
function forbiddens(): string[] {
  if (_forbiddens === null) {
    try {
      _forbiddens = grid.lua_function_forbiddens() ?? [];
    } catch {
      _forbiddens = [];
    }
  }
  return _forbiddens;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findForbidden(script: string): string[] {
  return forbiddens().filter((f) =>
    new RegExp(`\\b${escapeRegExp(f)}\\b`).test(script),
  );
}

export function validateScript(script: string): ValidateResult {
  const maxLength = Grid.Protocol.maxScriptLength;
  const hits = findForbidden(script);

  let compressed: string;
  try {
    compressed = GridScript.compressScript(script);
  } catch (e) {
    return {
      ok: false,
      maxLength,
      error: e instanceof Error ? e.message : String(e),
      forbidden: hits.length ? hits : undefined,
    };
  }

  const compressedLength = compressed.length;
  if (compressedLength >= maxLength) {
    return {
      ok: false,
      compressedLength,
      maxLength,
      error: `Script too long: compressed length ${compressedLength} >= limit ${maxLength}.`,
      forbidden: hits.length ? hits : undefined,
    };
  }

  if (hits.length) {
    return {
      ok: false,
      compressedLength,
      maxLength,
      error: `Uses forbidden identifier(s): ${hits.join(", ")}.`,
      forbidden: hits,
    };
  }

  return { ok: true, compressedLength, maxLength };
}
