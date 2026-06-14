/**
 * Shared intech_lua validator for the AI agent bridge.
 *
 * The device/editor constraint is on the **expanded, stored** form of the whole
 * event — the editor rejects when `event.toLua().length >= CONFIG_LENGTH`
 * (Monaco.svelte) and `GridEvent.insert` enforces the same via getAvailableChars.
 * The stored form wraps bare Lua as a `--[[@cb]] <script>` code block, so each
 * block carries ~10 chars of annotation overhead that count toward the cap.
 *
 * We therefore validate on EXPANDED length (matching the editor + the apply
 * path), not compressed length. Compressed length is still reported for info.
 * Read-only — never touches hardware.
 */
import { GridScript, grid } from "@intechstudio/grid-protocol";

/** Hard cap on a config's length (same source the editor uses): CONFIG_LENGTH. */
function maxScriptLength(): number {
  return grid.getProperty("CONFIG_LENGTH");
}

/** A bare script is stored as a single code block with this prefix. */
const CODE_BLOCK_PREFIX = "--[[@cb]] ";

export interface ValidateResult {
  ok: boolean;
  /** Length of the stored (expanded) form — the axis the editor/device enforce. */
  expandedLength: number;
  /** Device-compressed length (informational only). */
  compressedLength?: number;
  /** CONFIG_LENGTH. */
  maxLength: number;
  /** Largest accepted expandedLength (maxLength - 1). */
  maxUsable: number;
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

const ANNOTATED = /--\[\[@/;

export function validateScript(script: string): ValidateResult {
  const maxLength = maxScriptLength();
  const maxUsable = maxLength - 1;

  // Stored (expanded) form: bare Lua becomes one code block; already-annotated
  // multi-block scripts are stored as-is.
  const stored = ANNOTATED.test(script) ? script : CODE_BLOCK_PREFIX + script;
  const expandedLength = stored.length;

  const hits = findForbidden(script);

  // Syntax check via the real parser. Strip any block annotations first so the
  // concatenated code is plain Lua the compressor can parse.
  const codeOnly = script.replace(/--\[\[@.*?\]\]/gs, " ");
  let compressedLength: number | undefined;
  try {
    compressedLength = GridScript.compressScript(codeOnly).length;
  } catch (e) {
    return {
      ok: false,
      expandedLength,
      maxLength,
      maxUsable,
      error: e instanceof Error ? e.message : String(e),
      forbidden: hits.length ? hits : undefined,
    };
  }

  // The editor rejects at `>= maxLength` on the expanded stored form.
  if (expandedLength >= maxLength) {
    return {
      ok: false,
      expandedLength,
      compressedLength,
      maxLength,
      maxUsable,
      error:
        `Script too long: stored form is ${expandedLength} chars; the limit is ` +
        `${maxUsable} (CONFIG_LENGTH ${maxLength}). Note the stored form includes ` +
        `~10 chars of per-block annotation. Shorten the script.`,
      forbidden: hits.length ? hits : undefined,
    };
  }

  if (hits.length) {
    return {
      ok: false,
      expandedLength,
      compressedLength,
      maxLength,
      maxUsable,
      error: `Uses forbidden identifier(s): ${hits.join(", ")}.`,
      forbidden: hits,
    };
  }

  return { ok: true, expandedLength, compressedLength, maxLength, maxUsable };
}
