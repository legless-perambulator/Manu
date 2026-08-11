import { describe, expect, it } from "vitest";
import { ok, err, isOk, isErr, mapResult, unwrap } from "./result";

describe("Result", () => {
  it("constructs ok and err values", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("boom")).toEqual({ ok: false, error: "boom" });
  });

  it("narrows with isOk / isErr", () => {
    const good = ok(42);
    const bad = err(new Error("no"));
    expect(isOk(good)).toBe(true);
    expect(isErr(good)).toBe(false);
    expect(isOk(bad)).toBe(false);
    expect(isErr(bad)).toBe(true);
  });

  it("maps only success values", () => {
    expect(mapResult(ok(2), (n) => n * 10)).toEqual(ok(20));
    const e = err("fail");
    expect(mapResult(e, (n: number) => n * 10)).toBe(e);
  });

  it("unwraps success and throws on error", () => {
    expect(unwrap(ok("x"))).toBe("x");
    expect(() => unwrap(err(new Error("kaboom")))).toThrow("kaboom");
    expect(() => unwrap(err("stringy"))).toThrow("stringy");
  });
});
