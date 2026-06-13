import { test, expect, beforeAll, describe } from "vitest";
import { initLuaFormatter, grid } from "@intechstudio/grid-protocol";
import { validateScript } from "./validate";

// GridScript's parser needs the Lua formatter initialised first (same as the
// editor does at startup).
beforeAll(async () => {
  await initLuaFormatter();
});

describe("validateScript", () => {
  test("accepts a simple valid statement", () => {
    const r = validateScript("local x = 1");
    expect(r.ok).toBe(true);
    expect(r.compressedLength).toBeGreaterThan(0);
    expect(r.maxLength).toBeGreaterThan(0);
  });

  test("rejects a syntax error", () => {
    const r = validateScript("local x =");
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  test("rejects over-length scripts", () => {
    const max = grid.getProperty("CONFIG_LENGTH");
    const big = "a=1;".repeat(max); // well over the cap
    const r = validateScript(big);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too long/i);
  });

  test("rejects forbidden identifiers", () => {
    const forbiddens = grid.lua_function_forbiddens();
    if (forbiddens.length === 0) return; // nothing forbidden on this build
    const r = validateScript(`${forbiddens[0]}()`);
    expect(r.ok).toBe(false);
    expect(r.forbidden).toContain(forbiddens[0]);
  });
});
