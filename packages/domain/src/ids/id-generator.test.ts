import { describe, expect, it, expectTypeOf } from "vitest";
import { SequentialIdGenerator } from "./id-generator";
import type { CharacterId } from "./ids";

describe("SequentialIdGenerator", () => {
  it("allocates monotonic, zero-padded IDs per kind", () => {
    const gen = new SequentialIdGenerator();
    expect(gen.next("character")).toBe("CHAR_0001");
    expect(gen.next("character")).toBe("CHAR_0002");
    // Counters are independent per kind.
    expect(gen.next("scene")).toBe("SCENE_0001");
    expect(gen.next("character")).toBe("CHAR_0003");
  });

  it("returns the branded type for the kind", () => {
    const gen = new SequentialIdGenerator();
    expectTypeOf(gen.next("character")).toEqualTypeOf<CharacterId>();
  });

  it("peek reports the next sequence without consuming it", () => {
    const gen = new SequentialIdGenerator();
    expect(gen.peek("character")).toBe(1);
    gen.next("character");
    expect(gen.peek("character")).toBe(2);
    expect(gen.next("character")).toBe("CHAR_0002");
  });

  it("resumes from a snapshot", () => {
    const first = new SequentialIdGenerator();
    first.next("character");
    first.next("character");
    const snap = first.snapshot();
    expect(snap).toEqual({ character: 2 });

    const resumed = new SequentialIdGenerator(snap);
    expect(resumed.next("character")).toBe("CHAR_0003");
  });

  it("reconstructs counters from existing IDs so new IDs never collide", () => {
    const gen = SequentialIdGenerator.fromExistingIds([
      "CHAR_0001",
      "CHAR_0005",
      "SCENE_0002",
      "PROJ_ignored",
      "not-an-id",
    ]);
    expect(gen.next("character")).toBe("CHAR_0006");
    expect(gen.next("scene")).toBe("SCENE_0003");
    // A kind with no prior IDs still starts at 1.
    expect(gen.next("location")).toBe("LOC_0001");
  });

  it("rejects invalid seeds", () => {
    expect(() => new SequentialIdGenerator({ character: -1 })).toThrow(RangeError);
    expect(() => new SequentialIdGenerator({ scene: 1.5 })).toThrow(RangeError);
  });

  it("does not depend on entity names for identity", () => {
    // The same allocation sequence yields the same IDs regardless of any
    // (future) names attached to entities — identity is positional, not nominal.
    const a = new SequentialIdGenerator();
    const b = new SequentialIdGenerator();
    expect(a.next("character")).toBe(b.next("character"));
  });
});
