import { describe, expect, it, expectTypeOf } from "vitest";
import { SequentialIdGenerator, createStoryProjectId } from "../ids";
import { isWorldRuleId, isRelationshipId } from "../ids";
import type { ChapterId } from "../ids";
import type { Character, Chapter, Location, PlotThread, WorldRule, Relationship } from "./entities";
import { SCHEMA_VERSION, APP_FORMAT_VERSION, MANIFEST_PATH } from "./manifest";

describe("entity ID generation per prefix", () => {
  it("mints a correctly-prefixed ID for every entity kind", () => {
    const ids = new SequentialIdGenerator();
    expect(createStoryProjectId("t").startsWith("PROJ_")).toBe(true);
    expect(ids.next("chapter")).toBe("CHAPTER_0001");
    expect(ids.next("scene")).toBe("SCENE_0001");
    expect(ids.next("character")).toBe("CHAR_0001");
    expect(ids.next("location")).toBe("LOC_0001");
    expect(ids.next("plot_thread")).toBe("THREAD_0001");
    expect(ids.next("fact")).toBe("FACT_0001");
    expect(ids.next("object")).toBe("OBJECT_0001");
    expect(ids.next("event")).toBe("EVENT_0001");
    expect(ids.next("world_rule")).toBe("RULE_0001");
    expect(ids.next("relationship")).toBe("REL_0001");
  });

  it("guards the new ID kinds", () => {
    expect(isWorldRuleId("RULE_0001")).toBe(true);
    expect(isWorldRuleId("CHAR_0001")).toBe(false);
    expect(isRelationshipId("REL_0009")).toBe(true);
  });

  it("keeps IDs stable and independent of any display name", () => {
    const ids = new SequentialIdGenerator();
    const character: Character = {
      id: ids.next("character"),
      name: "Marcus Vale",
      aliases: [],
      description: "",
      role: "antagonist",
      goals: [],
      notes: "",
      status: "active",
      filePath: "characters/CHAR_0001.md",
    };
    const renamed: Character = { ...character, name: "Marcus Kane" };
    expect(renamed.id).toBe(character.id);
  });
});

describe("entity shapes", () => {
  it("types entities with branded IDs and links", () => {
    const ids = new SequentialIdGenerator();
    const chapter: Chapter = {
      id: ids.next("chapter"),
      title: "The Letter",
      order: 0,
      filePath: "manuscript/CHAPTER_0001.md",
      status: "outline",
    };
    const location: Location = {
      id: ids.next("location"),
      name: "Blackthorn Manor",
      aliases: ["the manor"],
      description: "",
      notes: "",
      filePath: "world/locations/LOC_0001.md",
    };
    const thread: PlotThread = {
      id: ids.next("plot_thread"),
      name: "The missing photograph",
      description: "",
      status: "introduced",
      relatedSceneIds: [],
    };
    const rule: WorldRule = {
      id: ids.next("world_rule"),
      name: "No resurrection",
      description: "Magic cannot resurrect the dead.",
      severity: "hard",
      scope: "magic",
    };
    const rel: Relationship = {
      id: ids.next("relationship"),
      characterAId: ids.next("character"),
      characterBId: ids.next("character"),
      type: "sibling",
      status: "",
      description: "",
    };
    expectTypeOf(chapter.id).toEqualTypeOf<ChapterId>();
    expect(location.aliases).toContain("the manor");
    expect(thread.status).toBe("introduced");
    expect(rule.severity).toBe("hard");
    expect(rel.type).toBe("sibling");
  });
});

describe("manifest constants", () => {
  it("exposes stable schema/app versions and manifest path", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(APP_FORMAT_VERSION).toBe("0.1.0");
    expect(MANIFEST_PATH).toBe(".writer/project.json");
  });
});
