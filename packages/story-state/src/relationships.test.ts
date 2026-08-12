import { describe, expect, it } from "vitest";
import { StoryTimeline } from "./timeline";
import {
  describeDimensionChange,
  describeRelationship,
  qualitativeOf,
  RELATIONSHIP_EVENT_KINDS,
} from "./relationships";
import { validateTransition } from "./validate";
import type { StateTransition, TransitionKind } from "./types";

const ELIAS = "CHAR_0001";
const MARA = "CHAR_0002";
const REL = "REL_0012";

const SCENES = ["SCENE_0001", "SCENE_0005", "SCENE_0012", "SCENE_0017", "SCENE_0023"];

const IDENTITY = {
  id: REL,
  characterAId: ELIAS,
  characterBId: MARA,
  type: "allies",
  status: "warm",
  description: "Thrown together by the same investigation.",
};

let seq = 0;
const t = (
  sceneId: string,
  kind: TransitionKind,
  value: string,
  extra: Partial<StateTransition> = {},
): StateTransition => ({
  id: `TRANS_${String(++seq).padStart(4, "0")}`,
  sceneId,
  kind,
  subjectId: REL,
  value,
  source: "author",
  confirmationStatus: "confirmed",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

/**
 * A relationship that actually moves: warm allies who meet, grow close, sour
 * after a lie, fracture, and end hostile — recorded partly qualitatively and
 * partly numerically, because writers do both.
 */
function fixture(): StoryTimeline {
  seq = 0;
  return new StoryTimeline(SCENES, [
    t("SCENE_0001", "relationship_event", "first_meeting"),
    t("SCENE_0001", "relationship_dimension", "", {
      dimension: "trust",
      level: "moderate",
      magnitude: 0.48,
    }),
    t("SCENE_0005", "relationship_status", "close"),
    t("SCENE_0005", "relationship_dimension", "", {
      dimension: "trust",
      level: "high",
      magnitude: 0.72,
    }),
    t("SCENE_0012", "relationship_dimension", "", {
      dimension: "trust",
      level: "low",
      magnitude: 0.31,
      note: "Mara lies about the vault.",
    }),
    t("SCENE_0012", "relationship_dimension", "", {
      dimension: "suspicion",
      level: "moderate",
      magnitude: 0.51,
      note: "Mara lies about the vault.",
    }),
    t("SCENE_0012", "relationship_status", "suspicious"),
    t("SCENE_0017", "relationship_event", "betrayal", { note: "She takes the key and runs." }),
    t("SCENE_0017", "relationship_status", "fractured"),
    t("SCENE_0023", "relationship_type", "enemies"),
    t("SCENE_0023", "relationship_status", "hostile"),
  ]);
}

describe("historical reconstruction", () => {
  it("answers what the relationship was at a specific point, not what it became", () => {
    const timeline = fixture();
    // The acceptance criterion: "allies" is insufficient; the moment matters.
    expect(timeline.relationshipAfterScene(IDENTITY, "SCENE_0005")).toMatchObject({
      type: "allies",
      status: "close",
    });
    expect(timeline.relationshipAfterScene(IDENTITY, "SCENE_0017").status).toBe("fractured");
    expect(timeline.relationshipAfterScene(IDENTITY, "SCENE_0023")).toMatchObject({
      type: "enemies",
      status: "hostile",
    });
  });

  it("never leaks later state into an earlier boundary", () => {
    const timeline = fixture();
    const early = timeline.relationshipBeforeScene(IDENTITY, "SCENE_0005");
    expect(early.status).toBe("warm");
    expect(early.type).toBe("allies");
    expect(early.dimensions.trust?.magnitude).toBe(0.48);
    expect(early.dimensions.suspicion).toBeUndefined();
    expect(early.events.map((e) => e.kind)).toEqual(["first_meeting"]);
  });

  it("keeps identity stable across every change of type and status", () => {
    const timeline = fixture();
    for (const sceneId of SCENES) {
      const state = timeline.relationshipAfterScene(IDENTITY, sceneId);
      expect(state.relationshipId).toBe(REL);
      expect(state.characterAId).toBe(ELIAS);
      expect(state.characterBId).toBe(MARA);
    }
  });

  it("starts from the entity's own values when nothing has been recorded", () => {
    const bare = new StoryTimeline(SCENES, []);
    expect(bare.relationshipAfterScene(IDENTITY, "SCENE_0023")).toMatchObject({
      type: "allies",
      status: "warm",
      dimensions: {},
      events: [],
    });
  });
});

describe("dimensions are optional", () => {
  it("works fully with no numbers at all", () => {
    const timeline = new StoryTimeline(SCENES, [
      t("SCENE_0005", "relationship_status", "strained"),
      t("SCENE_0005", "relationship_dimension", "", { dimension: "trust", level: "low" }),
    ]);
    const state = timeline.relationshipAfterScene(IDENTITY, "SCENE_0005");
    expect(state.status).toBe("strained");
    expect(state.dimensions.trust).toMatchObject({ level: "low" });
    expect(state.dimensions.trust?.magnitude).toBeUndefined();
  });

  it("works with numbers alone", () => {
    const timeline = new StoryTimeline(SCENES, [
      t("SCENE_0005", "relationship_dimension", "", { dimension: "respect", magnitude: 0.9 }),
    ]);
    const value = timeline.relationshipAfterScene(IDENTITY, "SCENE_0005").dimensions.respect;
    expect(value).toMatchObject({ magnitude: 0.9 });
    expect(value?.level).toBeUndefined();
  });

  it("records the previous value so a change reads as a movement", () => {
    const trust = fixture().relationshipAfterScene(IDENTITY, "SCENE_0012").dimensions.trust;
    expect(trust).toMatchObject({
      magnitude: 0.31,
      level: "low",
      previous: { magnitude: 0.72, level: "high" },
      reason: "Mara lies about the vault.",
    });
    expect(describeDimensionChange(trust!)).toBe("trust: high (0.72) → low (0.31)");
  });

  it("describes a magnitude qualitatively without inventing the reverse", () => {
    expect(qualitativeOf(0)).toBe("none");
    expect(qualitativeOf(0.31)).toBe("low");
    expect(qualitativeOf(0.48)).toBe("moderate");
    expect(qualitativeOf(0.95)).toBe("very_high");
    // A level carries no number: analysis knows only the band.
    const level = new StoryTimeline(SCENES, [
      t("SCENE_0001", "relationship_dimension", "", { dimension: "trust", level: "low" }),
    ]).relationshipAfterScene(IDENTITY, "SCENE_0001").dimensions.trust;
    expect(level?.magnitude).toBeUndefined();
  });
});

describe("relationship events", () => {
  it("accumulates milestones in story order", () => {
    expect(
      fixture()
        .relationshipAfterScene(IDENTITY, "SCENE_0023")
        .events.map((e) => `${e.sceneId}:${e.kind}`),
    ).toEqual(["SCENE_0001:first_meeting", "SCENE_0017:betrayal"]);
  });

  it("covers more than romance", () => {
    for (const kind of ["alliance", "betrayal", "oath_sworn", "debt_incurred", "rescue"]) {
      expect(RELATIONSHIP_EVENT_KINDS).toContain(kind);
    }
  });

  it("carries the reason a milestone happened", () => {
    const events = fixture().relationshipAfterScene(IDENTITY, "SCENE_0017").events;
    expect(events.at(-1)).toMatchObject({
      kind: "betrayal",
      reason: "She takes the key and runs.",
    });
  });
});

describe("history and change queries", () => {
  it("gives the whole arc as movements", () => {
    expect(
      fixture()
        .relationshipHistory(REL)
        .map((c) => `${c.sceneId}:${c.label}:${c.from ?? "—"}→${c.to}`),
    ).toEqual([
      "SCENE_0001:first_meeting:—→first_meeting",
      "SCENE_0001:trust:—→moderate (0.48)",
      "SCENE_0005:status:—→close",
      "SCENE_0005:trust:moderate (0.48)→high (0.72)",
      // Within one scene, changes replay in the order they were recorded.
      "SCENE_0012:trust:high (0.72)→low (0.31)",
      "SCENE_0012:suspicion:—→moderate (0.51)",
      "SCENE_0012:status:close→suspicious",
      "SCENE_0017:betrayal:—→betrayal",
      "SCENE_0017:status:suspicious→fractured",
      "SCENE_0023:type:—→enemies",
      "SCENE_0023:status:fractured→hostile",
    ]);
  });

  it("reports the changes inside a set of scenes, with correct prior values", () => {
    const changes = fixture().relationshipChangesInScenes(["SCENE_0012"]);
    expect(changes.map((c) => c.label).sort()).toEqual(["status", "suspicion", "trust"]);
    // The `from` reflects everything before the chapter, not only within it.
    expect(changes.find((c) => c.label === "trust")?.from).toBe("high (0.72)");
    expect(changes.find((c) => c.label === "trust")?.reason).toBe("Mara lies about the vault.");
  });

  it("lists relationships with any recorded change", () => {
    expect(fixture().knownRelationshipIds()).toEqual([REL]);
  });

  it("excludes proposed changes from canon but can preview them", () => {
    const timeline = new StoryTimeline(SCENES, [
      t("SCENE_0005", "relationship_status", "estranged", {
        confirmationStatus: "proposed",
        source: "agent",
      }),
    ]);
    expect(timeline.relationshipAfterScene(IDENTITY, "SCENE_0005").status).toBe("warm");
    expect(
      timeline.relationshipAfterScene(IDENTITY, "SCENE_0005", { include: "with_proposed" }).status,
    ).toBe("estranged");
  });
});

describe("scene ordering", () => {
  it("replays in narrative order, not the order transitions were written", () => {
    const forward = fixture();
    const shuffled = new StoryTimeline(
      SCENES,
      [...SCENES].reverse().flatMap((sceneId) => forward.transitionsAtScene(sceneId)),
    );
    expect(JSON.stringify(shuffled.relationshipAfterScene(IDENTITY, "SCENE_0017"))).toBe(
      JSON.stringify(forward.relationshipAfterScene(IDENTITY, "SCENE_0017")),
    );
  });

  it("ignores changes anchored to scenes that no longer exist", () => {
    const timeline = new StoryTimeline(SCENES, [
      t("SCENE_9999", "relationship_status", "hostile"),
      t("SCENE_0005", "relationship_status", "close"),
    ]);
    expect(timeline.relationshipAfterScene(IDENTITY, "SCENE_0023").status).toBe("close");
  });
});

describe("validation", () => {
  const draft = (kind: TransitionKind, value: string, extra = {}) => ({
    sceneId: "SCENE_0001",
    kind,
    subjectId: REL,
    value,
    ...extra,
  });

  it("accepts well-formed relationship changes", () => {
    expect(() => validateTransition(draft("relationship_type", "enemies"))).not.toThrow();
    expect(() => validateTransition(draft("relationship_status", "strained"))).not.toThrow();
    expect(() => validateTransition(draft("relationship_event", "betrayal"))).not.toThrow();
    expect(() =>
      validateTransition(draft("relationship_dimension", "", { dimension: "trust", level: "low" })),
    ).not.toThrow();
  });

  it("requires a relationship subject", () => {
    expect(() =>
      validateTransition({ ...draft("relationship_status", "strained"), subjectId: ELIAS }),
    ).toThrow(/needs a relationship subject/);
  });

  it("rejects unknown dimensions, levels and events", () => {
    expect(() =>
      validateTransition(draft("relationship_dimension", "", { dimension: "vibes", level: "low" })),
    ).toThrow(/not a relationship dimension/);
    expect(() =>
      validateTransition(
        draft("relationship_dimension", "", { dimension: "trust", level: "quite a lot" }),
      ),
    ).toThrow(/not a qualitative level/);
    expect(() => validateTransition(draft("relationship_event", "brunch"))).toThrow(
      /not a relationship event/,
    );
  });

  it("requires a dimension change to say something", () => {
    expect(() =>
      validateTransition(draft("relationship_dimension", "", { dimension: "trust" })),
    ).toThrow(/needs a level, a magnitude, or both/);
    expect(() =>
      validateTransition(
        draft("relationship_dimension", "", { dimension: "trust", magnitude: 1.4 }),
      ),
    ).toThrow(/between 0 and 1/);
  });

  it("rejects empty types and statuses", () => {
    expect(() => validateTransition(draft("relationship_status", "  "))).toThrow(
      /needs a non-empty value/,
    );
  });

  it("rejects relationship fields on other transition kinds", () => {
    expect(() =>
      validateTransition({
        sceneId: "SCENE_0001",
        kind: "character_location",
        subjectId: ELIAS,
        value: "LOC_0001",
        dimension: "trust",
      }),
    ).toThrow(/does not take relationship dimension fields/);
  });
});

describe("rendering", () => {
  it("summarises a relationship for context and the inspector", () => {
    expect(describeRelationship(fixture().relationshipAfterScene(IDENTITY, "SCENE_0012"))).toBe(
      "CHAR_0001 ↔ CHAR_0002: allies (suspicious); trust low (0.31), suspicion moderate (0.51)",
    );
  });
});
