import { describe, expect, it, expectTypeOf } from "vitest";
import { ID_PREFIX } from "./entity-kind";
import {
  formatEntityId,
  parseId,
  entityKindOf,
  isEntityId,
  isStoryProjectId,
  isCharacterId,
  isSceneId,
  createStoryProjectId,
  assertIdOfKind,
  idValue,
  type CharacterId,
  type SceneId,
  type EntityId,
} from "./ids";

describe("formatEntityId", () => {
  it("zero-pads to at least four digits", () => {
    expect(formatEntityId("character", 1)).toBe("CHAR_0001");
    expect(formatEntityId("scene", 42)).toBe("SCENE_0042");
    expect(formatEntityId("plot_thread", 8)).toBe("THREAD_0008");
  });

  it("grows beyond four digits when needed", () => {
    expect(formatEntityId("chapter", 12345)).toBe("CHAPTER_12345");
  });

  it("rejects non-positive or non-integer sequences", () => {
    expect(() => formatEntityId("character", 0)).toThrow(RangeError);
    expect(() => formatEntityId("character", -3)).toThrow(RangeError);
    expect(() => formatEntityId("character", 1.5)).toThrow(RangeError);
  });

  it("produces the branded static type for the kind", () => {
    expectTypeOf(formatEntityId("character", 1)).toEqualTypeOf<CharacterId>();
    expectTypeOf(formatEntityId("scene", 1)).toEqualTypeOf<SceneId>();
  });
});

describe("parseId", () => {
  it("parses sequence-based IDs", () => {
    expect(parseId("CHAR_0001")).toEqual({
      kind: "character",
      prefix: "CHAR",
      sequence: 1,
      raw: "CHAR_0001",
    });
    expect(parseId("EVENT_0068")?.sequence).toBe(68);
  });

  it("parses project IDs with an opaque suffix", () => {
    const parsed = parseId("PROJ_abc-123");
    expect(parsed?.kind).toBe("project");
    expect(parsed?.sequence).toBeNull();
  });

  it("rejects malformed or unknown IDs", () => {
    expect(parseId("")).toBeNull();
    expect(parseId("CHAR")).toBeNull();
    expect(parseId("_0001")).toBeNull();
    expect(parseId("CHAR_")).toBeNull();
    expect(parseId("NOPE_0001")).toBeNull();
    expect(parseId("CHAR_00x1")).toBeNull();
    expect(parseId("CHAR_0000")).toBeNull(); // sequence must be >= 1
  });
});

describe("guards", () => {
  it("entityKindOf resolves kinds", () => {
    expect(entityKindOf("LOC_0017")).toBe("location");
    expect(entityKindOf("garbage")).toBeNull();
  });

  it("isEntityId excludes project IDs", () => {
    expect(isEntityId("CHAR_0001")).toBe(true);
    expect(isEntityId("PROJ_x")).toBe(false);
    expect(isStoryProjectId("PROJ_x")).toBe(true);
  });

  it("kind-specific guards narrow correctly", () => {
    expect(isCharacterId("CHAR_0001")).toBe(true);
    expect(isCharacterId("SCENE_0001")).toBe(false);
    expect(isSceneId("SCENE_0001")).toBe(true);

    const raw: string = "CHAR_0007";
    if (isCharacterId(raw)) {
      expectTypeOf(raw).toEqualTypeOf<CharacterId>();
    }
  });
});

describe("createStoryProjectId", () => {
  it("mints an opaque, name-independent ID", () => {
    const id = createStoryProjectId("fixed-token");
    expect(idValue(id)).toBe("PROJ_fixed-token");
    expect(isStoryProjectId(id)).toBe(true);
  });

  it("uses a UUID by default", () => {
    const id = createStoryProjectId();
    expect(idValue(id).startsWith(`${ID_PREFIX.project}_`)).toBe(true);
  });

  it("rejects tokens containing an underscore", () => {
    expect(() => createStoryProjectId("bad_token")).toThrow(RangeError);
  });
});

describe("assertIdOfKind", () => {
  it("returns the branded value on match", () => {
    const id = assertIdOfKind("character", "CHAR_0009");
    expectTypeOf(id).toEqualTypeOf<CharacterId>();
    expect(id).toBe("CHAR_0009");
  });

  it("throws on mismatch", () => {
    expect(() => assertIdOfKind("scene", "CHAR_0009")).toThrow(TypeError);
  });
});

describe("branding (type-level)", () => {
  it("keeps distinct ID types mutually incompatible", () => {
    const character = formatEntityId("character", 1);
    const scene = formatEntityId("scene", 1);

    // A CharacterId is assignable to the EntityId union...
    expectTypeOf(character).toMatchTypeOf<EntityId>();

    // ...but the two concrete brands are not interchangeable.
    // @ts-expect-error CharacterId is not assignable to SceneId
    const wrong: SceneId = character;
    void wrong;
    void scene;
  });

  it("does not accept a raw string where a branded ID is required", () => {
    // @ts-expect-error plain string is not a CharacterId
    const bad: CharacterId = "CHAR_0001";
    void bad;
  });
});
