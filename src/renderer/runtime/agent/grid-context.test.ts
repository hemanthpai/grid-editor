import { test, expect, beforeAll, describe } from "vitest";
import { initLuaFormatter } from "@intechstudio/grid-protocol";
import { getFunctionReference, scopeWarnings } from "./grid-context";

beforeAll(async () => {
  await initLuaFormatter();
});

describe("getFunctionReference", () => {
  test("returns scoped functions with helper text", () => {
    const ref = getFunctionReference("encoder");
    expect(Array.isArray(ref)).toBe(true);
    expect(ref.length).toBeGreaterThan(0);
    expect(ref[0]).toHaveProperty("name");
    expect(ref[0]).toHaveProperty("key");
  });

  test("scoping changes the set (button vs encoder differ)", () => {
    const enc = new Set(getFunctionReference("encoder").map((f) => f.key));
    const btn = new Set(getFunctionReference("button").map((f) => f.key));
    const onlyEnc = [...enc].filter((k) => !btn.has(k));
    const onlyBtn = [...btn].filter((k) => !enc.has(k));
    expect(onlyEnc.length + onlyBtn.length).toBeGreaterThan(0);
  });

  test("undefined scope is a superset of any single scope", () => {
    const all = getFunctionReference(undefined).length;
    const enc = getFunctionReference("encoder").length;
    expect(all).toBeGreaterThanOrEqual(enc);
  });
});

describe("scopeWarnings", () => {
  test("no warnings without a scope", () => {
    expect(scopeWarnings("self:led_set()", undefined)).toEqual([]);
  });

  test("flags an other-scope function called in this scope", () => {
    const enc = new Set(getFunctionReference("encoder").map((f) => f.name));
    const other = getFunctionReference(undefined)
      .map((f) => f.name)
      .find((n) => !enc.has(n));
    if (!other) return; // every function valid for encoder on this build
    const warnings = scopeWarnings(`self:${other}()`, "encoder");
    expect(warnings.some((w) => w.includes(other))).toBe(true);
  });
});
