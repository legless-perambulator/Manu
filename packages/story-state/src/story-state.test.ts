import { describe, expect, it } from "vitest";
import { StoryTimeline, TimelineError } from "./timeline";
import { describeTransition, validateTransition, TransitionError } from "./validate";
import type { StateTransition, TransitionKind } from "./types";

const ELIAS = "CHAR_0001";
const MARA = "CHAR_0002";
const MANOR = "LOC_0001";
const LONDON = "LOC_0002";
const KEY = "OBJECT_0001";
const VAULT_EXISTS = "FACT_0001";
const MARA_SPIES = "FACT_0002";

const SCENES = ["SCENE_0040", "SCENE_0041", "SCENE_0042", "SCENE_0043", "SCENE_0051"];

let seq = 0;
const t = (
  sceneId: string,
  kind: TransitionKind,
  subjectId: string,
  value: string,
  extra: Partial<StateTransition> = {},
): StateTransition => ({
  id: `TRANS_${String(++seq).padStart(4, "0")}`,
  sceneId,
  kind,
  subjectId,
  value,
  source: "author",
  confirmationStatus: "confirmed",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

/**
 * A fixture timeline with a real shape: Elias arrives at the manor and learns
 * about the vault in 42; Mara leaves for London in 43; the key changes hands
 * twice; one transition is only proposed, and one is rejected.
 */
function fixture(): StoryTimeline {
  seq = 0;
  return new StoryTimeline(SCENES, [
    t("SCENE_0040", "character_location", ELIAS, LONDON),
    t("SCENE_0040", "character_location", MARA, MANOR),
    t("SCENE_0040", "object_owner", KEY, MARA),
    t("SCENE_0041", "fact_established", VAULT_EXISTS, VAULT_EXISTS),
    t("SCENE_0041", "knowledge_changed", MARA, VAULT_EXISTS, {
      certainty: 1,
      knowledgeState: "known",
      sourceType: "witnessed",
    }),
    t("SCENE_0042", "character_location", ELIAS, MANOR),
    t("SCENE_0042", "knowledge_changed", ELIAS, VAULT_EXISTS, {
      certainty: 0.8,
      knowledgeState: "believed",
      sourceType: "told",
      sourceEntityId: MARA,
    }),
    t("SCENE_0042", "object_owner", KEY, ELIAS),
    t("SCENE_0043", "character_location", MARA, LONDON),
    t("SCENE_0043", "object_location", KEY, MANOR),
    // Not canon: proposed by a model, not yet confirmed.
    t("SCENE_0043", "knowledge_changed", ELIAS, MARA_SPIES, {
      confirmationStatus: "proposed",
      source: "agent",
      modelId: "mock:test",
      certainty: 0.4,
      knowledgeState: "suspected",
      sourceType: "inferred",
    }),
    // Considered and dismissed.
    t("SCENE_0043", "character_status", MARA, "deceased", {
      confirmationStatus: "rejected",
      source: "agent",
    }),
    t("SCENE_0051", "character_status", ELIAS, "deceased"),
  ]);
}

describe("historical reconstruction", () => {
  it("answers where a character is immediately before a scene", () => {
    const timeline = fixture();
    // The acceptance question: where is Elias immediately before Scene 42?
    expect(timeline.characterStateBeforeScene(ELIAS, "SCENE_0042").locationId).toBe(LONDON);
    expect(timeline.characterStateAfterScene(ELIAS, "SCENE_0042").locationId).toBe(MANOR);
    // And he stays there.
    expect(timeline.characterStateBeforeScene(ELIAS, "SCENE_0051").locationId).toBe(MANOR);
  });

  it("answers whether a character knows a fact at a point in the story", () => {
    const timeline = fixture();
    // The acceptance question: does Mara know about the vault at this point?
    expect(
      timeline.knows(MARA, VAULT_EXISTS, { sceneId: "SCENE_0041", position: "before" }),
    ).toBeNull();
    const known = timeline.knows(MARA, VAULT_EXISTS, {
      sceneId: "SCENE_0041",
      position: "after",
    });
    expect(known).toMatchObject({
      certainty: 1,
      state: "known",
      sourceType: "witnessed",
      acquiredAtSceneId: "SCENE_0041",
    });

    // Elias does not know it before 42, and knows it with less certainty after.
    expect(timeline.characterKnowledgeBeforeScene(ELIAS, "SCENE_0042")).toHaveLength(0);
    expect(timeline.characterKnowledgeAfterScene(ELIAS, "SCENE_0042")).toEqual([
      {
        id: `${ELIAS}:${VAULT_EXISTS}`,
        characterId: ELIAS,
        factId: VAULT_EXISTS,
        state: "believed",
        certainty: 0.8,
        sourceType: "told",
        sourceEntityId: MARA,
        acquiredAtSceneId: "SCENE_0042",
      },
    ]);
  });

  it("tracks object ownership and location over time", () => {
    const timeline = fixture();
    expect(timeline.objectStateBeforeScene(KEY, "SCENE_0042").ownerId).toBe(MARA);
    expect(timeline.objectStateAfterScene(KEY, "SCENE_0042").ownerId).toBe(ELIAS);
    expect(timeline.objectStateBeforeScene(KEY, "SCENE_0051")).toMatchObject({
      ownerId: ELIAS,
      locationId: MANOR,
    });
  });

  it("derives inventory from ownership at the queried moment", () => {
    const timeline = fixture();
    expect(timeline.characterStateBeforeScene(ELIAS, "SCENE_0042").inventory).toEqual([]);
    expect(timeline.characterStateAfterScene(ELIAS, "SCENE_0042").inventory).toEqual([KEY]);
    expect(timeline.characterStateAfterScene(MARA, "SCENE_0042").inventory).toEqual([]);
  });

  it("tracks alive/dead status and defaults to active", () => {
    const timeline = fixture();
    expect(timeline.characterStateBeforeScene(ELIAS, "SCENE_0051").status).toBe("active");
    expect(timeline.characterStateAfterScene(ELIAS, "SCENE_0051").status).toBe("deceased");
    // Mara has no status transition at all.
    expect(timeline.characterStateAfterScene(MARA, "SCENE_0051").status).toBe("active");
  });

  it("tracks when facts become true in the world", () => {
    const timeline = fixture();
    expect(timeline.establishedFactsBeforeScene("SCENE_0041")).toEqual([]);
    expect(timeline.establishedFactsAt({ sceneId: "SCENE_0041", position: "after" })).toEqual([
      VAULT_EXISTS,
    ]);
  });

  it("reconstructs rather than storing a latest snapshot", () => {
    const timeline = fixture();
    // Every earlier answer stays available after later changes exist.
    expect(timeline.characterStateAfterScene(MARA, "SCENE_0040").locationId).toBe(MANOR);
    expect(timeline.characterStateAfterScene(MARA, "SCENE_0043").locationId).toBe(LONDON);
  });
});

describe("canon vs proposal", () => {
  it("excludes proposed transitions from canonical state", () => {
    const timeline = fixture();
    const canon = timeline.characterStateAfterScene(ELIAS, "SCENE_0043");
    expect(canon.knowledge.map((k) => k.factId)).toEqual([VAULT_EXISTS]);
  });

  it("can preview state including proposals, without changing canon", () => {
    const timeline = fixture();
    const preview = timeline.characterStateAfterScene(ELIAS, "SCENE_0043", {
      include: "with_proposed",
    });
    expect(preview.knowledge.map((k) => k.factId)).toEqual([MARA_SPIES, VAULT_EXISTS].sort());
    expect(timeline.characterStateAfterScene(ELIAS, "SCENE_0043").knowledge).toHaveLength(1);
  });

  it("never honours a rejected transition, even in preview", () => {
    const timeline = fixture();
    for (const include of ["confirmed", "with_proposed"] as const) {
      expect(timeline.characterStateAfterScene(MARA, "SCENE_0043", { include }).status).toBe(
        "active",
      );
    }
  });
});

describe("world state", () => {
  it("assembles every tracked subject at a boundary", () => {
    const world = fixture().worldStateAt({ sceneId: "SCENE_0042", position: "after" });
    expect(world.characters.map((c) => c.characterId)).toEqual([ELIAS, MARA]);
    expect(world.objects.map((o) => o.objectId)).toEqual([KEY]);
    expect(world.establishedFacts).toEqual([VAULT_EXISTS]);
    expect(world.characters.find((c) => c.characterId === ELIAS)).toMatchObject({
      locationId: MANOR,
      inventory: [KEY],
    });
  });

  it("lists the transitions recorded at one scene", () => {
    expect(
      fixture()
        .transitionsAtScene("SCENE_0042")
        .map((t) => t.kind),
    ).toEqual(["character_location", "knowledge_changed", "object_owner"]);
  });
});

describe("determinism", () => {
  it("does not depend on the order transitions are supplied in", () => {
    const forward = fixture();
    const shuffled = new StoryTimeline(
      SCENES,
      [...forward.transitionsAtScene("SCENE_0042")]
        .reverse()
        .concat(
          SCENES.filter((s) => s !== "SCENE_0042").flatMap((s) => forward.transitionsAtScene(s)),
        ),
    );
    expect(JSON.stringify(shuffled.characterStateAfterScene(ELIAS, "SCENE_0043"))).toBe(
      JSON.stringify(forward.characterStateAfterScene(ELIAS, "SCENE_0043")),
    );
  });

  it("rejects a query against a scene outside the story order", () => {
    expect(() => fixture().characterStateAfterScene(ELIAS, "SCENE_9999")).toThrow(TimelineError);
  });

  it("ignores transitions anchored to scenes that no longer exist", () => {
    const timeline = new StoryTimeline(SCENES, [
      t("SCENE_0040", "character_location", ELIAS, MANOR),
      t("SCENE_9999", "character_location", ELIAS, LONDON),
    ]);
    expect(timeline.characterStateAfterScene(ELIAS, "SCENE_0051").locationId).toBe(MANOR);
  });
});

describe("transition validation", () => {
  const draft = (kind: TransitionKind, subjectId: string, value: string) => ({
    sceneId: "SCENE_0001",
    kind,
    subjectId,
    value,
  });

  it("accepts well-formed transitions", () => {
    expect(() => validateTransition(draft("character_location", ELIAS, MANOR))).not.toThrow();
    expect(() => validateTransition(draft("knowledge_changed", MARA, VAULT_EXISTS))).not.toThrow();
    expect(() => validateTransition(draft("object_owner", KEY, ""))).not.toThrow();
    expect(() => validateTransition(draft("character_status", ELIAS, "deceased"))).not.toThrow();
  });

  it("refuses subjects and values of the wrong kind", () => {
    expect(() => validateTransition(draft("character_location", KEY, MANOR))).toThrow(
      TransitionError,
    );
    expect(() => validateTransition(draft("character_location", ELIAS, VAULT_EXISTS))).toThrow(
      /needs a location value/,
    );
    expect(() => validateTransition(draft("knowledge_changed", MARA, MANOR))).toThrow(
      /needs a fact value/,
    );
    expect(() => validateTransition(draft("character_status", ELIAS, "sleepy"))).toThrow(
      /not a character status/,
    );
  });

  it("requires a scene anchor and a sane certainty", () => {
    expect(() =>
      validateTransition({ ...draft("character_location", ELIAS, MANOR), sceneId: "CHAPTER_0001" }),
    ).toThrow(/anchored to a scene/);
    expect(() =>
      validateTransition({ ...draft("knowledge_changed", MARA, VAULT_EXISTS), certainty: 1.5 }),
    ).toThrow(/between 0 and 1/);
  });

  it("describes transitions in plain language", () => {
    expect(
      describeTransition({ kind: "knowledge_changed", subjectId: MARA, value: VAULT_EXISTS }),
    ).toBe("CHAR_0002 learns FACT_0001");
    expect(describeTransition({ kind: "object_owner", subjectId: KEY, value: ELIAS })).toBe(
      "CHAR_0001 takes possession of OBJECT_0001",
    );
    expect(describeTransition({ kind: "object_owner", subjectId: KEY, value: "" })).toBe(
      "OBJECT_0001 has no owner",
    );
  });
});
