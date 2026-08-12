import { describe, expect, it } from "vitest";
import type { Fact, Scene } from "@jellytind/domain";
import { factKnowledgeGraph, falseBeliefsAt, informationAsymmetriesAt } from "./graph";
import { describeKnowledge, holdsAsTrue } from "./knowledge";
import { StoryTimeline } from "./timeline";
import { validateTransition, TransitionError } from "./validate";
import { checkKnowledgeViolations } from "./violations";
import type { StateTransition, TransitionKind } from "./types";
import type { KnowledgeState, AcquisitionSource } from "./knowledge";

const MARA = "CHAR_0001";
const ELIAS = "CHAR_0002";
const MARCUS = "CHAR_0003";
const VAULT = "FACT_0001"; // true
const KILLER_IS_MARCUS = "FACT_0002"; // false
const LETTER = "FACT_0003"; // true, established late

const SCENES = ["SCENE_0041", "SCENE_0042", "SCENE_0043", "SCENE_0044"];

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

const know = (
  sceneId: string,
  characterId: string,
  factId: string,
  state: KnowledgeState,
  sourceType: AcquisitionSource,
  extra: Partial<StateTransition> = {},
): StateTransition =>
  t(sceneId, "knowledge_changed", characterId, factId, {
    knowledgeState: state,
    sourceType,
    ...extra,
  });

const FACTS = new Map<string, Fact>([
  [
    VAULT,
    {
      id: VAULT,
      statement: "A vault lies beneath the manor.",
      status: "canonical",
      objectiveTruth: true,
    },
  ],
  [
    KILLER_IS_MARCUS,
    {
      id: KILLER_IS_MARCUS,
      statement: "Marcus is the killer.",
      status: "canonical",
      objectiveTruth: false,
    },
  ],
  [
    LETTER,
    { id: LETTER, statement: "The letter was forged.", status: "canonical", objectiveTruth: true },
  ],
] as Array<[string, Fact]>);

const scene = (id: string, fields: Record<string, unknown> = {}): Scene =>
  ({
    id,
    title: id,
    chapterId: "CHAPTER_0001",
    characterIds: [],
    plotThreadIds: [],
    objectIds: [],
    factIds: [],
    purpose: [],
    status: "drafted",
    ...fields,
  }) as unknown as Scene;

/**
 * A fixture with a real information shape: Mara witnesses the vault and tells
 * Elias; Elias comes to believe a false proposition after Mara deceives him;
 * Marcus never learns anything.
 */
function fixture(): StoryTimeline {
  seq = 0;
  return new StoryTimeline(SCENES, [
    know("SCENE_0041", MARA, VAULT, "known", "witnessed"),
    know("SCENE_0042", ELIAS, VAULT, "believed", "told", { sourceEntityId: MARA, certainty: 0.7 }),
    know("SCENE_0042", ELIAS, KILLER_IS_MARCUS, "believed", "deceived", { sourceEntityId: MARA }),
    know("SCENE_0043", ELIAS, VAULT, "known", "witnessed"),
    know("SCENE_0043", MARA, KILLER_IS_MARCUS, "disbelieved", "inferred"),
    t("SCENE_0041", "fact_established", VAULT, VAULT),
    t("SCENE_0044", "fact_established", LETTER, LETTER),
  ]);
}

describe("knowledge acquisition", () => {
  it("records what a character holds, how, and from whom", () => {
    const record = fixture().knows(ELIAS, VAULT, { sceneId: "SCENE_0042", position: "after" });
    expect(record).toMatchObject({
      characterId: ELIAS,
      factId: VAULT,
      state: "believed",
      sourceType: "told",
      sourceEntityId: MARA,
      acquiredAtSceneId: "SCENE_0042",
      certainty: 0.7,
    });
    expect(describeKnowledge(record!)).toBe(
      "believed FACT_0001 (told by CHAR_0001 in SCENE_0042, certainty 0.7)",
    );
  });

  it("answers what a character knows immediately before a scene", () => {
    const timeline = fixture();
    expect(timeline.characterKnowledgeBeforeScene(ELIAS, "SCENE_0042")).toHaveLength(0);
    expect(timeline.characterKnowledgeAfterScene(ELIAS, "SCENE_0042").map((k) => k.factId)).toEqual(
      [VAULT, KILLER_IS_MARCUS].sort(),
    );
  });

  it("keeps the scene a position was first taken when it later firms up", () => {
    // Elias believes in 42 and knows in 43 — he first learned it in 42.
    const record = fixture().knows(ELIAS, VAULT, { sceneId: "SCENE_0043", position: "after" });
    expect(record).toMatchObject({ state: "known", acquiredAtSceneId: "SCENE_0042" });
  });

  it("records giving a position up, and where", () => {
    const timeline = new StoryTimeline(SCENES, [
      know("SCENE_0041", MARA, VAULT, "known", "witnessed"),
      know("SCENE_0043", MARA, VAULT, "unknown", "unknown"),
    ]);
    expect(
      timeline.knows(MARA, VAULT, { sceneId: "SCENE_0042", position: "after" }),
    ).not.toBeNull();
    // A position of `unknown` is the absence of a position.
    expect(timeline.knows(MARA, VAULT, { sceneId: "SCENE_0043", position: "after" })).toBeNull();
  });

  it("distinguishes holding a position from treating it as true", () => {
    const timeline = fixture();
    const after = { sceneId: "SCENE_0043", position: "after" } as const;
    expect(timeline.doesCharacterKnowFactAtScene(MARA, KILLER_IS_MARCUS, after)).toBe(false);
    // Mara has a position — she rejects it — which is not the same as unknown.
    expect(timeline.knows(MARA, KILLER_IS_MARCUS, after)?.state).toBe("disbelieved");
    expect(holdsAsTrue("suspected")).toBe(false);
    expect(holdsAsTrue("known")).toBe(true);
  });
});

describe("false beliefs", () => {
  it("lets a character confidently hold a false proposition", () => {
    const timeline = fixture();
    const after = { sceneId: "SCENE_0043", position: "after" } as const;
    const beliefs = falseBeliefsAt(timeline, FACTS, after, {
      characterIds: [MARA, ELIAS, MARCUS],
    });
    expect(beliefs).toEqual([
      { characterId: ELIAS, factId: KILLER_IS_MARCUS, kind: "believes_false" },
    ]);
    // The fact itself is untouched — belief never mutates truth.
    expect(FACTS.get(KILLER_IS_MARCUS)?.objectiveTruth).toBe(false);
  });

  it("also reports rejecting something true", () => {
    const timeline = new StoryTimeline(SCENES, [
      know("SCENE_0041", MARCUS, VAULT, "disbelieved", "assumed"),
    ]);
    expect(falseBeliefsAt(timeline, FACTS, { sceneId: "SCENE_0041", position: "after" })).toEqual([
      { characterId: MARCUS, factId: VAULT, kind: "rejects_true" },
    ]);
  });
});

describe("the knowledge graph", () => {
  it("shows everyone's position on one fact, including who has none", () => {
    const graph = factKnowledgeGraph(
      fixture(),
      FACTS.get(VAULT)!,
      { sceneId: "SCENE_0042", position: "after" },
      { characterIds: [MARA, ELIAS, MARCUS] },
    );
    expect(graph).toMatchObject({ factId: VAULT, objectiveTruth: true });
    expect(graph.holders).toEqual([
      expect.objectContaining({
        characterId: MARA,
        state: "known",
        sourceType: "witnessed",
        acquiredAtSceneId: "SCENE_0041",
        isFalseBelief: false,
      }),
      expect.objectContaining({
        characterId: ELIAS,
        state: "believed",
        sourceType: "told",
        sourceEntityId: MARA,
        isFalseBelief: false,
      }),
      expect.objectContaining({ characterId: MARCUS, state: "unknown", isFalseBelief: false }),
    ]);
  });

  it("flags a holder of a false proposition", () => {
    const graph = factKnowledgeGraph(
      fixture(),
      FACTS.get(KILLER_IS_MARCUS)!,
      { sceneId: "SCENE_0043", position: "after" },
      { characterIds: [ELIAS] },
    );
    expect(graph.holders[0]).toMatchObject({ state: "believed", isFalseBelief: true });
  });

  it("lists who holds a fact as true at a point", () => {
    const timeline = fixture();
    expect(
      timeline
        .charactersWhoKnowFactAtScene(VAULT, { sceneId: "SCENE_0041", position: "after" })
        .map((r) => r.characterId),
    ).toEqual([MARA]);
    expect(
      timeline
        .charactersWhoKnowFactAtScene(VAULT, { sceneId: "SCENE_0042", position: "after" })
        .map((r) => r.characterId)
        .sort(),
    ).toEqual([MARA, ELIAS].sort());
  });
});

describe("information transfer", () => {
  it("traces a chain back to its first-hand source", () => {
    const chain = fixture().traceAcquisition(ELIAS, VAULT, {
      sceneId: "SCENE_0042",
      position: "after",
    });
    expect(chain).toEqual([
      expect.objectContaining({ characterId: ELIAS, sourceType: "told", sourceEntityId: MARA }),
      expect.objectContaining({ characterId: MARA, sourceType: "witnessed" }),
    ]);
  });

  it("gives the history of one character's position on one fact", () => {
    expect(
      fixture()
        .knowledgeHistory(ELIAS, VAULT)
        .map((s) => `${s.sceneId}:${s.state}`),
    ).toEqual(["SCENE_0042:believed", "SCENE_0043:known"]);
  });

  it("gives the whole timeline of one fact across characters", () => {
    expect(
      fixture()
        .factKnowledgeTimeline(KILLER_IS_MARCUS)
        .map((s) => `${s.sceneId}:${s.characterId}:${s.state}`),
    ).toEqual(["SCENE_0042:CHAR_0002:believed", "SCENE_0043:CHAR_0001:disbelieved"]);
  });

  it("stops rather than looping when two characters cite each other", () => {
    const timeline = new StoryTimeline(SCENES, [
      know("SCENE_0041", MARA, VAULT, "known", "told", { sourceEntityId: ELIAS }),
      know("SCENE_0041", ELIAS, VAULT, "known", "told", { sourceEntityId: MARA }),
    ]);
    expect(
      timeline.traceAcquisition(MARA, VAULT, { sceneId: "SCENE_0042", position: "after" }).length,
    ).toBeLessThanOrEqual(2);
  });
});

describe("information asymmetry", () => {
  it("reports what the people in a scene do not share", () => {
    const asymmetries = informationAsymmetriesAt(
      fixture(),
      scene("SCENE_0042", { pov: MARA, characterIds: [MARA, ELIAS, MARCUS] }),
      { sceneId: "SCENE_0042", position: "before" },
    );
    // Entering 42, only Mara holds the vault fact.
    expect(asymmetries).toEqual([{ factId: VAULT, holders: [MARA], outsiders: [ELIAS, MARCUS] }]);
  });

  it("reports nothing for a scene with a single character", () => {
    expect(
      informationAsymmetriesAt(fixture(), scene("SCENE_0042", { pov: MARA }), {
        sceneId: "SCENE_0042",
        position: "before",
      }),
    ).toEqual([]);
  });
});

describe("knowledge violations", () => {
  const scenes = [
    scene("SCENE_0041", { pov: MARA, characterIds: [MARA] }),
    scene("SCENE_0042", { pov: MARA, characterIds: [MARA, ELIAS] }),
    scene("SCENE_0043", { pov: ELIAS, characterIds: [ELIAS, MARA] }),
    scene("SCENE_0044", { pov: MARCUS, characterIds: [MARCUS] }),
  ];

  it("finds nothing wrong with a well-formed timeline", () => {
    expect(
      checkKnowledgeViolations({ timeline: fixture(), scenes, facts: FACTS }).filter(
        (v) => v.severity === "error",
      ),
    ).toEqual([]);
  });

  it("catches a character passing on what they never held", () => {
    const timeline = new StoryTimeline(SCENES, [
      know("SCENE_0042", ELIAS, VAULT, "known", "told", { sourceEntityId: MARA }),
    ]);
    const found = checkKnowledgeViolations({ timeline, scenes, facts: FACTS });
    expect(found).toContainEqual(
      expect.objectContaining({
        kind: "told_without_knowing",
        severity: "error",
        characterId: MARA,
        factId: VAULT,
      }),
    );
  });

  it("catches a scene referencing information its POV has not acquired", () => {
    const withReference = [
      ...scenes.slice(0, 3),
      scene("SCENE_0044", { pov: MARCUS, characterIds: [MARCUS], factIds: [VAULT] }),
    ];
    const found = checkKnowledgeViolations({
      timeline: fixture(),
      scenes: withReference,
      facts: FACTS,
    });
    expect(found).toContainEqual(
      expect.objectContaining({
        kind: "referenced_without_knowledge",
        severity: "warning",
        characterId: MARCUS,
        factId: VAULT,
      }),
    );
  });

  it("catches knowing a true fact before the story establishes it", () => {
    const timeline = new StoryTimeline(SCENES, [
      know("SCENE_0041", MARA, LETTER, "known", "witnessed"),
      t("SCENE_0044", "fact_established", LETTER, LETTER),
    ]);
    expect(checkKnowledgeViolations({ timeline, scenes, facts: FACTS })).toContainEqual(
      expect.objectContaining({ kind: "knowledge_before_fact", severity: "error" }),
    );
  });

  it("catches contradictory transitions at the same scene", () => {
    const timeline = new StoryTimeline(SCENES, [
      know("SCENE_0041", MARA, VAULT, "known", "witnessed"),
      know("SCENE_0041", MARA, VAULT, "disbelieved", "assumed"),
    ]);
    expect(checkKnowledgeViolations({ timeline, scenes, facts: FACTS })).toContainEqual(
      expect.objectContaining({ kind: "contradictory_transitions", severity: "error" }),
    );
  });

  it("notes when a source or learner is not in the scene", () => {
    const timeline = new StoryTimeline(SCENES, [
      know("SCENE_0041", MARA, VAULT, "known", "witnessed"),
      know("SCENE_0041", MARCUS, VAULT, "known", "told", { sourceEntityId: MARA }),
    ]);
    const kinds = checkKnowledgeViolations({ timeline, scenes, facts: FACTS }).map((v) => v.kind);
    expect(kinds).toContain("learner_not_present");
  });

  it("ignores proposed transitions unless asked to include them", () => {
    const timeline = new StoryTimeline(SCENES, [
      know("SCENE_0042", ELIAS, VAULT, "known", "told", {
        sourceEntityId: MARA,
        confirmationStatus: "proposed",
      }),
    ]);
    expect(checkKnowledgeViolations({ timeline, scenes, facts: FACTS })).toEqual([]);
    expect(
      checkKnowledgeViolations({
        timeline,
        scenes,
        facts: FACTS,
        view: { include: "with_proposed" },
      }).map((v) => v.kind),
    ).toContain("told_without_knowing");
  });
});

describe("validation of knowledge transitions", () => {
  const base = { sceneId: "SCENE_0001", kind: "knowledge_changed" as const, subjectId: MARA };

  it("accepts a full knowledge transition", () => {
    expect(() =>
      validateTransition({
        ...base,
        value: VAULT,
        knowledgeState: "suspected",
        sourceType: "inferred",
      }),
    ).not.toThrow();
  });

  it("rejects unknown states and sources", () => {
    expect(() =>
      validateTransition({ ...base, value: VAULT, knowledgeState: "hunch" as never }),
    ).toThrow(/not a knowledge state/);
    expect(() =>
      validateTransition({ ...base, value: VAULT, sourceType: "telepathy" as never }),
    ).toThrow(/not an acquisition source/);
  });

  it("rejects an invalid or self-referential source entity", () => {
    expect(() =>
      validateTransition({ ...base, value: VAULT, sourceEntityId: "not-an-id" }),
    ).toThrow(TransitionError);
    expect(() =>
      validateTransition({
        ...base,
        value: VAULT,
        sourceType: "told",
        sourceEntityId: MARA,
      }),
    ).toThrow(/cannot be the source of their own information/);
  });

  it("rejects knowledge fields on other transition kinds", () => {
    expect(() =>
      validateTransition({
        sceneId: "SCENE_0001",
        kind: "character_location",
        subjectId: MARA,
        value: "LOC_0001",
        knowledgeState: "known",
      }),
    ).toThrow(/does not take knowledge fields/);
  });
});

describe("format migration", () => {
  it("reads pre-Phase-11 knowledge_gained transitions as known", () => {
    const legacy = {
      id: "TRANS_0001",
      sceneId: "SCENE_0041",
      kind: "knowledge_gained",
      subjectId: MARA,
      value: VAULT,
      certainty: 1,
      howLearned: "witnessed",
      source: "author",
      confirmationStatus: "confirmed",
      createdAt: "2026-01-01T00:00:00.000Z",
    } as unknown as StateTransition;

    const record = new StoryTimeline(SCENES, [legacy]).knows(MARA, VAULT, {
      sceneId: "SCENE_0041",
      position: "after",
    });
    expect(record).toMatchObject({ state: "known", sourceType: "witnessed", certainty: 1 });
  });

  it("accepts a legacy kind on write and stores it in current terms", () => {
    const migrated = validateTransition({
      sceneId: "SCENE_0001",
      kind: "knowledge_gained" as never,
      subjectId: MARA,
      value: VAULT,
    });
    expect(migrated.kind).toBe("knowledge_changed");
  });
});

describe("deception", () => {
  const scenes = [
    scene("SCENE_0041", { pov: MARA, characterIds: [MARA] }),
    scene("SCENE_0042", { pov: MARA, characterIds: [MARA, ELIAS] }),
    scene("SCENE_0043", { pov: ELIAS, characterIds: [ELIAS, MARA] }),
    scene("SCENE_0044", { pov: MARCUS, characterIds: [MARCUS] }),
  ];

  it("lets a liar pass on what they do not hold", () => {
    // Mara deceives Elias about a false proposition she rejects herself.
    const found = checkKnowledgeViolations({ timeline: fixture(), scenes, facts: FACTS });
    expect(found.filter((v) => v.kind === "told_without_knowing")).toEqual([]);
  });

  it("still requires an honest teller to hold what they pass on", () => {
    const timeline = new StoryTimeline(SCENES, [
      know("SCENE_0042", ELIAS, VAULT, "known", "told", { sourceEntityId: MARA }),
    ]);
    expect(
      checkKnowledgeViolations({ timeline, scenes, facts: FACTS }).map((v) => v.kind),
    ).toContain("told_without_knowing");
  });
});
