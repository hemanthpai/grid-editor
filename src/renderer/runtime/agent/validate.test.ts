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
    expect(r.expandedLength).toBeGreaterThan(0);
    expect(r.maxLength).toBeGreaterThan(0);
    expect(r.maxUsable).toBe(r.maxLength - 1);
  });

  test("rejects a syntax error", () => {
    const r = validateScript("local x =");
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  test("rejects over-length scripts on the expanded (stored) axis", () => {
    const max = grid.getProperty("CONFIG_LENGTH");
    const big = "a=1;".repeat(max); // stored form well over the cap
    const r = validateScript(big);
    expect(r.ok).toBe(false);
    expect(r.expandedLength).toBeGreaterThanOrEqual(max);
    expect(r.error).toMatch(/too long/i);
  });

  test("counts the code-block annotation overhead in expandedLength", () => {
    const r = validateScript("x=1");
    // stored as "--[[@cb]] x=1" -> 10 (prefix) + 3
    expect(r.expandedLength).toBe(13);
  });

  test("rejects forbidden identifiers", () => {
    const forbiddens = grid.lua_function_forbiddens();
    if (forbiddens.length === 0) return; // nothing forbidden on this build
    const r = validateScript(`${forbiddens[0]}()`);
    expect(r.ok).toBe(false);
    expect(r.forbidden).toContain(forbiddens[0]);
  });
});
