import { describe, expect, it } from "vitest";
import type { Location, Scene } from "@jellytind/domain";
import {
  describeLocationPath,
  indexLocations,
  isWithin,
  locationDescendants,
  locationPath,
  locationsCompatible,
  locationTreeFaults,
} from "@jellytind/domain";
import { checkContinuity, type ContinuityViolation } from "./continuity";
import { StoryTimeline } from "./timeline";
import type { StateTransition, TransitionKind } from "./types";

const ELIAS = "CHAR_0001";
const MARA = "CHAR_0002";
const KEY = "OBJECT_0001";
const REVOLVER = "OBJECT_0002";

// Blackthorn Manor › West Wing › Library › Hidden Vault, plus a flat elsewhere.
const MANOR = "LOC_0001";
const WEST_WING = "LOC_0002";
const LIBRARY = "LOC_0003";
const VAULT = "LOC_0004";
const FLAT = "LOC_0005";

const SCENES = ["SCENE_0001", "SCENE_0002", "SCENE_0003", "SCENE_0004"];

// ── Fixture builders ─────────────────────────────────────────────────────────

const place = (id: string, name: string, parentLocationId?: string): Location =>
  ({
    id,
    name,
    aliases: [],
    description: "",
    notes: "",
    filePath: `locations/${id}.md`,
    ...(parentLocationId !== undefined ? { parentLocationId } : {}),
  }) as unknown as Location;

const NESTED: Location[] = [
  place(MANOR, "Blackthorn Manor"),
  place(WEST_WING, "West Wing", MANOR),
  place(LIBRARY, "Library", WEST_WING),
  place(VAULT, "Hidden Vault", LIBRARY),
  place(FLAT, "Elias's Flat"),
];

function scene(id: string, fields: Record<string, unknown> = {}): Scene {
  return {
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
  } as unknown as Scene;
}

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

function check(
  scenes: readonly Scene[],
  transitions: readonly StateTransition[],
  locations: readonly Location[] = NESTED,
): ContinuityViolation[] {
  seq = 0;
  return checkContinuity({
    timeline: new StoryTimeline(SCENES, transitions),
    scenes,
    locations,
  });
}

const kinds = (found: readonly ContinuityViolation[]): string[] => found.map((v) => v.kind);

// ── Nested locations ─────────────────────────────────────────────────────────

describe("nested locations", () => {
  const index = indexLocations(NESTED);

  it("reads a location and everything it is inside", () => {
    expect(locationPath(index, VAULT)).toEqual([VAULT, LIBRARY, WEST_WING, MANOR]);
    expect(describeLocationPath(index, VAULT)).toBe(
      "Blackthorn Manor › West Wing › Library › Hidden Vault",
    );
  });

  it("knows someone in the vault is at the manor, but not the reverse", () => {
    expect(isWithin(index, VAULT, MANOR)).toBe(true);
    expect(isWithin(index, MANOR, VAULT)).toBe(false);
  });

  it("treats a place and its container as compatible in both directions", () => {
    // Neither statement contradicts the other; only the containment direction
    // differs, which is why compatibility is symmetric and `isWithin` is not.
    expect(locationsCompatible(index, VAULT, MANOR)).toBe(true);
    expect(locationsCompatible(index, MANOR, VAULT)).toBe(true);
    expect(locationsCompatible(index, VAULT, FLAT)).toBe(false);
  });

  it("makes no claim when a location is unrecorded", () => {
    expect(locationsCompatible(index, undefined, FLAT)).toBe(true);
  });

  it("lists everything inside a place", () => {
    expect(locationDescendants(index, MANOR)).toEqual([WEST_WING, LIBRARY, VAULT].sort());
    expect(locationDescendants(index, VAULT)).toEqual([]);
  });
});

describe("invalid nested locations", () => {
  it("finds a location inside itself", () => {
    const broken = [place(MANOR, "Blackthorn Manor", MANOR)];
    expect(locationTreeFaults(indexLocations(broken))[0]?.problem).toBe("self_parent");
    const found = check([], [], broken);
    expect(found[0]?.kind).toBe("invalid_nested_location");
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.message).toContain("inside itself");
  });

  it("finds a containment loop", () => {
    const looped = [
      place(MANOR, "Blackthorn Manor", WEST_WING),
      place(WEST_WING, "West Wing", LIBRARY),
      place(LIBRARY, "Library", MANOR),
    ];
    const found = check([], [], looped);
    expect(kinds(found)).toContain("invalid_nested_location");
    expect(found.every((v) => v.kind === "invalid_nested_location")).toBe(true);
    // Every member of the loop is reported, not just the first found.
    expect(found).toHaveLength(3);
  });

  it("finds a parent the project does not have", () => {
    const orphan = [place(LIBRARY, "Library", "LOC_9999")];
    const found = check([], [], orphan);
    expect(found[0]?.message).toContain("does not exist in this project");
  });

  it("passes a well-formed tree", () => {
    expect(check([], [])).toEqual([]);
  });
});

// ── Object state ─────────────────────────────────────────────────────────────

describe("object state", () => {
  it("separates who owns a thing from who is holding it", () => {
    const timeline = new StoryTimeline(SCENES, [
      t("SCENE_0001", "object_owner", REVOLVER, ELIAS),
      t("SCENE_0002", "object_holder", REVOLVER, MARA),
    ]);
    const state = timeline.objectStateAfterScene(REVOLVER, "SCENE_0002");
    expect(state.ownerId).toBe(ELIAS);
    expect(state.holderId).toBe(MARA);
    expect(state.placement).toBe("held");
  });

  it("carries condition, status and visibility", () => {
    const timeline = new StoryTimeline(SCENES, [
      t("SCENE_0001", "object_condition", REVOLVER, "unloaded"),
      t("SCENE_0002", "object_visibility", REVOLVER, "concealed"),
      t("SCENE_0003", "object_status", REVOLVER, "lost"),
    ]);
    const state = timeline.objectStateAfterScene(REVOLVER, "SCENE_0003");
    expect(state.condition).toBe("unloaded");
    expect(state.visibility).toBe("concealed");
    expect(state.status).toBe("lost");
  });

  it("defaults an untouched object to existing and visible", () => {
    const state = new StoryTimeline(SCENES, []).objectStateAfterScene(KEY, "SCENE_0001");
    expect(state.status).toBe("exists");
    expect(state.visibility).toBe("visible");
    expect(state.placement).toBe("unplaced");
  });

  it("reads a legacy `intact` status as `exists`", () => {
    const timeline = new StoryTimeline(SCENES, [
      t("SCENE_0001", "object_status", KEY, "intact"),
      t("SCENE_0002", "object_status", REVOLVER, "transformed"),
    ]);
    expect(timeline.objectStateAfterScene(KEY, "SCENE_0001").status).toBe("exists");
    expect(timeline.objectStateAfterScene(REVOLVER, "SCENE_0002").status).toBe("exists");
  });

  it("lets a held object travel with whoever holds it", () => {
    const timeline = new StoryTimeline(SCENES, [
      t("SCENE_0001", "object_location", REVOLVER, FLAT),
      t("SCENE_0002", "object_holder", REVOLVER, ELIAS),
      t("SCENE_0002", "character_location", ELIAS, FLAT),
      t("SCENE_0003", "character_location", ELIAS, MANOR),
    ]);
    expect(timeline.objectLocationAt(REVOLVER, { sceneId: "SCENE_0003", position: "after" })).toBe(
      MANOR,
    );
  });

  it("leaves a put-down object where it was put", () => {
    const timeline = new StoryTimeline(SCENES, [
      t("SCENE_0001", "object_holder", REVOLVER, ELIAS),
      t("SCENE_0002", "object_location", REVOLVER, FLAT),
      t("SCENE_0003", "character_location", ELIAS, MANOR),
    ]);
    const state = timeline.objectStateAfterScene(REVOLVER, "SCENE_0003");
    expect(state.placement).toBe("placed");
    expect(state.holderId).toBeUndefined();
    expect(timeline.objectLocationAt(REVOLVER, { sceneId: "SCENE_0003", position: "after" })).toBe(
      FLAT,
    );
  });

  it("counts what a character carries, not merely what they own", () => {
    const timeline = new StoryTimeline(SCENES, [
      t("SCENE_0001", "object_owner", REVOLVER, ELIAS),
      t("SCENE_0002", "object_holder", REVOLVER, MARA),
    ]);
    expect(timeline.characterStateAfterScene(ELIAS, "SCENE_0002").inventory).toEqual([]);
    expect(timeline.characterStateAfterScene(MARA, "SCENE_0002").inventory).toEqual([REVOLVER]);
    // Ownership is untouched: the revolver is still Elias's, it is in Mara's hand.
    expect(timeline.objectStateAfterScene(REVOLVER, "SCENE_0002").ownerId).toBe(ELIAS);
  });

  it("still treats an owner as a carrier when no holder is ever recorded", () => {
    const timeline = new StoryTimeline(SCENES, [t("SCENE_0001", "object_owner", KEY, MARA)]);
    expect(timeline.characterStateAfterScene(MARA, "SCENE_0001").inventory).toEqual([KEY]);
  });
});

// ── Object history and transfers ─────────────────────────────────────────────

describe("object history", () => {
  const timeline = new StoryTimeline(SCENES, [
    t("SCENE_0001", "object_location", KEY, LIBRARY, { note: "in the drawer" }),
    t("SCENE_0002", "object_holder", KEY, MARA, { note: "Mara takes the key" }),
    t("SCENE_0003", "object_holder", KEY, ELIAS, { note: "given to Elias" }),
    t("SCENE_0004", "object_condition", KEY, "bent"),
  ]);

  it("reads as a trail of changes, each with what it changed from", () => {
    const history = timeline.objectHistory(KEY);
    expect(history.map((c) => [c.sceneId, c.kind, c.from, c.to])).toEqual([
      ["SCENE_0001", "location", undefined, LIBRARY],
      ["SCENE_0002", "holder", undefined, MARA],
      ["SCENE_0003", "holder", MARA, ELIAS],
      ["SCENE_0004", "condition", undefined, "bent"],
    ]);
    expect(history[1]?.reason).toBe("Mara takes the key");
  });

  it("derives transfers from the same transitions the state comes from", () => {
    const transfers = timeline.objectTransfers(KEY);
    expect(transfers).toEqual([
      { objectId: KEY, sceneId: "SCENE_0001", toLocationId: LIBRARY, reason: "in the drawer" },
      // Taken *from* the library — where it was picked up is worth recording.
      {
        objectId: KEY,
        sceneId: "SCENE_0002",
        fromLocationId: LIBRARY,
        toCharacterId: MARA,
        reason: "Mara takes the key",
      },
      {
        objectId: KEY,
        sceneId: "SCENE_0003",
        fromCharacterId: MARA,
        toCharacterId: ELIAS,
        reason: "given to Elias",
      },
    ]);
  });

  it("folds a holder and a location change at one scene into one transfer", () => {
    const moved = new StoryTimeline(SCENES, [
      t("SCENE_0001", "object_holder", KEY, MARA),
      t("SCENE_0002", "object_location", KEY, VAULT, { note: "Mara hides it" }),
    ]);
    const second = moved.objectTransfers(KEY)[1];
    expect(second?.fromCharacterId).toBe(MARA);
    expect(second?.toLocationId).toBe(VAULT);
  });

  it("lists every object with a recorded change", () => {
    expect(timeline.knownObjectIds()).toEqual([KEY]);
  });
});

// ── Character location ───────────────────────────────────────────────────────

describe("character location", () => {
  it("records arrival, departure, travel and deliberate unknowns", () => {
    const timeline = new StoryTimeline(SCENES, [
      t("SCENE_0001", "character_location", ELIAS, FLAT),
      t("SCENE_0002", "character_location", ELIAS, MANOR, { movement: "travel" }),
      t("SCENE_0003", "character_location", ELIAS, MANOR),
      t("SCENE_0004", "character_location", ELIAS, MANOR, { movement: "departure" }),
    ]);

    expect(timeline.characterStateAfterScene(ELIAS, "SCENE_0001")).toMatchObject({
      locationId: FLAT,
      presence: "present",
    });
    expect(timeline.characterStateAfterScene(ELIAS, "SCENE_0002")).toMatchObject({
      presence: "travelling",
      travellingTo: MANOR,
    });
    expect(timeline.characterStateAfterScene(ELIAS, "SCENE_0002").locationId).toBeUndefined();
    expect(timeline.characterStateAfterScene(ELIAS, "SCENE_0003").locationId).toBe(MANOR);

    const departed = timeline.characterStateAfterScene(ELIAS, "SCENE_0004");
    expect(departed.presence).toBe("departed");
    expect(departed.locationId).toBeUndefined();
    // Where they were last seen survives the departure.
    expect(departed.lastKnownLocationId).toBe(MANOR);
  });

  it("reads a transition with no movement as an arrival", () => {
    const timeline = new StoryTimeline(SCENES, [
      t("SCENE_0001", "character_location", ELIAS, FLAT),
    ]);
    expect(timeline.characterStateAfterScene(ELIAS, "SCENE_0001").presence).toBe("present");
  });

  it("says whereabouts are unknown rather than guessing", () => {
    const timeline = new StoryTimeline(SCENES, [
      t("SCENE_0001", "character_location", ELIAS, FLAT),
      t("SCENE_0002", "character_location", ELIAS, "", { movement: "unknown" }),
    ]);
    const state = timeline.characterStateAfterScene(ELIAS, "SCENE_0002");
    expect(state.presence).toBe("unknown");
    expect(state.locationId).toBeUndefined();
    expect(state.lastKnownLocationId).toBe(FLAT);
  });
});

// ── Continuity failures, by design ───────────────────────────────────────────

/**
 * Each fixture below is a small story built to break in exactly one way. That is
 * the point of the phase: these failures must be findable from recorded state
 * alone, with no model and no re-reading.
 */
describe("impossible object appearance", () => {
  it("catches the revolver left in the flat and fired at the manor", () => {
    const scenes = [
      scene("SCENE_0001", { locationId: FLAT, characterIds: [ELIAS], objectIds: [REVOLVER] }),
      scene("SCENE_0002", { locationId: MANOR, characterIds: [ELIAS], objectIds: [REVOLVER] }),
    ];
    const found = check(scenes, [t("SCENE_0001", "object_location", REVOLVER, FLAT)]);
    const violation = found.find((v) => v.kind === "impossible_object_appearance");
    expect(violation?.severity).toBe("error");
    expect(violation?.sceneId).toBe("SCENE_0002");
    expect(violation?.objectId).toBe(REVOLVER);
    expect(violation?.message).toContain("nothing moves it");
  });

  it("accepts an object in a room inside the place it was left", () => {
    const scenes = [
      scene("SCENE_0001", { locationId: MANOR, objectIds: [KEY] }),
      scene("SCENE_0002", { locationId: VAULT, objectIds: [KEY] }),
    ];
    const found = check(scenes, [t("SCENE_0001", "object_location", KEY, MANOR)]);
    expect(kinds(found)).not.toContain("impossible_object_appearance");
  });

  it("accepts an object a transition brings into the scene", () => {
    const scenes = [
      scene("SCENE_0001", { locationId: FLAT, objectIds: [REVOLVER] }),
      scene("SCENE_0002", { locationId: MANOR, objectIds: [REVOLVER] }),
    ];
    const found = check(scenes, [
      t("SCENE_0001", "object_location", REVOLVER, FLAT),
      t("SCENE_0002", "object_location", REVOLVER, MANOR),
    ]);
    expect(kinds(found)).not.toContain("impossible_object_appearance");
  });

  it("accepts an object carried in by someone present", () => {
    const scenes = [
      scene("SCENE_0001", { locationId: FLAT, characterIds: [ELIAS], objectIds: [REVOLVER] }),
      scene("SCENE_0002", { locationId: MANOR, characterIds: [ELIAS], objectIds: [REVOLVER] }),
    ];
    const found = check(scenes, [
      t("SCENE_0001", "object_location", REVOLVER, FLAT),
      t("SCENE_0001", "object_holder", REVOLVER, ELIAS),
      t("SCENE_0002", "character_location", ELIAS, MANOR),
    ]);
    expect(kinds(found)).not.toContain("impossible_object_appearance");
  });

  it("warns when the only person holding it is not in the scene", () => {
    const scenes = [
      scene("SCENE_0001", { locationId: FLAT, characterIds: [MARA], objectIds: [KEY] }),
      scene("SCENE_0002", { locationId: MANOR, characterIds: [ELIAS], objectIds: [KEY] }),
    ];
    const found = check(scenes, [t("SCENE_0001", "object_holder", KEY, MARA)]);
    const violation = found.find((v) => v.kind === "impossible_object_appearance");
    expect(violation?.severity).toBe("warning");
    expect(violation?.characterId).toBe(MARA);
  });

  it("says nothing about an object whose position was never recorded", () => {
    const scenes = [scene("SCENE_0001", { locationId: MANOR, objectIds: [KEY] })];
    expect(check(scenes, [])).toEqual([]);
  });
});

describe("destroyed object reused", () => {
  it("catches a destroyed object appearing later", () => {
    const scenes = [
      scene("SCENE_0001", { locationId: MANOR, objectIds: [KEY] }),
      scene("SCENE_0003", { locationId: MANOR, objectIds: [KEY] }),
    ];
    const found = check(scenes, [t("SCENE_0001", "object_status", KEY, "destroyed")]);
    const violation = found.find((v) => v.kind === "destroyed_object_reused");
    expect(violation?.severity).toBe("error");
    expect(violation?.sceneId).toBe("SCENE_0003");
    expect(violation?.message).toContain("uses it");
  });

  it("catches a destroyed object being moved", () => {
    const found = check(
      [scene("SCENE_0001"), scene("SCENE_0002")],
      [
        t("SCENE_0001", "object_status", KEY, "destroyed"),
        t("SCENE_0002", "object_location", KEY, VAULT),
      ],
    );
    expect(found.find((v) => v.kind === "destroyed_object_reused")?.message).toContain(
      "changes it",
    );
  });

  it("allows a scene that explicitly restores it", () => {
    const scenes = [
      scene("SCENE_0001", { objectIds: [KEY] }),
      scene("SCENE_0002", { objectIds: [KEY] }),
    ];
    const found = check(scenes, [
      t("SCENE_0001", "object_status", KEY, "destroyed"),
      t("SCENE_0002", "object_status", KEY, "exists"),
    ]);
    expect(kinds(found)).not.toContain("destroyed_object_reused");
  });

  it("does not object to a merely lost or hidden thing turning up", () => {
    const scenes = [
      scene("SCENE_0001", { objectIds: [KEY] }),
      scene("SCENE_0002", { objectIds: [KEY] }),
    ];
    const lost = check(scenes, [t("SCENE_0001", "object_status", KEY, "lost")]);
    const hidden = check(scenes, [t("SCENE_0001", "object_status", KEY, "hidden")]);
    expect(kinds(lost)).not.toContain("destroyed_object_reused");
    expect(kinds(hidden)).not.toContain("destroyed_object_reused");
  });
});

describe("conflicting object ownership", () => {
  it("catches one scene giving an object two owners", () => {
    const found = check(
      [scene("SCENE_0001")],
      [t("SCENE_0001", "object_owner", KEY, ELIAS), t("SCENE_0001", "object_owner", KEY, MARA)],
    );
    const violation = found.find((v) => v.kind === "conflicting_object_ownership");
    expect(violation?.severity).toBe("error");
    expect(violation?.objectId).toBe(KEY);
  });

  it("catches one scene giving an object two holders", () => {
    const found = check(
      [scene("SCENE_0001")],
      [t("SCENE_0001", "object_holder", KEY, ELIAS), t("SCENE_0001", "object_holder", KEY, MARA)],
    );
    expect(kinds(found)).toContain("conflicting_object_ownership");
  });

  /** The distinction the model exists for: a stolen thing still has an owner. */
  it("does not flag an owner and a different holder", () => {
    const found = check(
      [scene("SCENE_0001")],
      [t("SCENE_0001", "object_owner", KEY, ELIAS), t("SCENE_0001", "object_holder", KEY, MARA)],
    );
    expect(kinds(found)).not.toContain("conflicting_object_ownership");
  });

  it("does not flag ownership changing across scenes", () => {
    const found = check(
      [scene("SCENE_0001"), scene("SCENE_0002")],
      [t("SCENE_0001", "object_owner", KEY, ELIAS), t("SCENE_0002", "object_owner", KEY, MARA)],
    );
    expect(kinds(found)).not.toContain("conflicting_object_ownership");
  });
});

describe("unexplained object relocation", () => {
  it("warns when a put-down object moves with nobody carrying it", () => {
    const found = check(
      [scene("SCENE_0001"), scene("SCENE_0003")],
      [
        t("SCENE_0001", "object_location", KEY, FLAT),
        t("SCENE_0003", "object_location", KEY, VAULT),
      ],
    );
    const violation = found.find((v) => v.kind === "unexplained_object_relocation");
    expect(violation?.severity).toBe("warning");
    expect(violation?.sceneId).toBe("SCENE_0003");
    expect(violation?.locationIds).toEqual([FLAT, VAULT]);
  });

  it("says nothing when somebody picked it up in between", () => {
    const found = check(
      [scene("SCENE_0001"), scene("SCENE_0002"), scene("SCENE_0003")],
      [
        t("SCENE_0001", "object_location", KEY, FLAT),
        t("SCENE_0002", "object_holder", KEY, MARA),
        t("SCENE_0003", "object_location", KEY, VAULT),
      ],
    );
    expect(kinds(found)).not.toContain("unexplained_object_relocation");
  });

  it("says nothing about a move deeper into the same place", () => {
    const found = check(
      [scene("SCENE_0001"), scene("SCENE_0002")],
      [
        t("SCENE_0001", "object_location", KEY, MANOR),
        t("SCENE_0002", "object_location", KEY, VAULT),
      ],
    );
    expect(kinds(found)).not.toContain("unexplained_object_relocation");
  });
});

describe("conflicting character location", () => {
  it("catches one scene putting a character in two incompatible places", () => {
    const found = check(
      [scene("SCENE_0001")],
      [
        t("SCENE_0001", "character_location", ELIAS, FLAT),
        t("SCENE_0001", "character_location", ELIAS, MANOR),
      ],
    );
    const violation = found.find((v) => v.kind === "conflicting_character_location");
    expect(violation?.severity).toBe("error");
    expect(violation?.characterId).toBe(ELIAS);
  });

  it("accepts moving deeper into the same place within a scene", () => {
    const found = check(
      [scene("SCENE_0001")],
      [
        t("SCENE_0001", "character_location", ELIAS, MANOR),
        t("SCENE_0001", "character_location", ELIAS, VAULT),
      ],
    );
    expect(kinds(found)).not.toContain("conflicting_character_location");
  });

  it("warns when a scene is set somewhere the character was not", () => {
    const scenes = [
      scene("SCENE_0001", { locationId: FLAT, characterIds: [ELIAS] }),
      scene("SCENE_0002", { locationId: MANOR, characterIds: [ELIAS] }),
    ];
    const found = check(scenes, [t("SCENE_0001", "character_location", ELIAS, FLAT)]);
    const violation = found.find((v) => v.kind === "conflicting_character_location");
    expect(violation?.severity).toBe("warning");
    expect(violation?.sceneId).toBe("SCENE_0002");
  });

  it("says nothing when the character is explicitly travelling", () => {
    const scenes = [
      scene("SCENE_0001", { locationId: FLAT, characterIds: [ELIAS] }),
      scene("SCENE_0002", { locationId: MANOR, characterIds: [ELIAS] }),
    ];
    const found = check(scenes, [
      t("SCENE_0001", "character_location", ELIAS, FLAT),
      t("SCENE_0001", "character_location", ELIAS, MANOR, { movement: "travel" }),
    ]);
    expect(kinds(found)).not.toContain("conflicting_character_location");
  });

  it("says nothing when the scene itself moves them", () => {
    const scenes = [
      scene("SCENE_0001", { locationId: FLAT, characterIds: [ELIAS] }),
      scene("SCENE_0002", { locationId: MANOR, characterIds: [ELIAS] }),
    ];
    const found = check(scenes, [
      t("SCENE_0001", "character_location", ELIAS, FLAT),
      t("SCENE_0002", "character_location", ELIAS, MANOR),
    ]);
    expect(kinds(found)).not.toContain("conflicting_character_location");
  });

  it("says nothing about a character whose position was never recorded", () => {
    const scenes = [scene("SCENE_0001", { locationId: MANOR, characterIds: [MARA] })];
    expect(check(scenes, [])).toEqual([]);
  });
});

// ── Canon boundary ───────────────────────────────────────────────────────────

describe("proposed state", () => {
  it("ignores rejected transitions entirely", () => {
    const scenes = [
      scene("SCENE_0001", { locationId: FLAT, objectIds: [REVOLVER] }),
      scene("SCENE_0002", { locationId: MANOR, objectIds: [REVOLVER] }),
    ];
    const found = check(scenes, [
      t("SCENE_0001", "object_location", REVOLVER, FLAT, { confirmationStatus: "rejected" }),
    ]);
    expect(found).toEqual([]);
  });

  it("checks canon only, unless asked to preview proposals", () => {
    const scenes = [
      scene("SCENE_0001", { locationId: FLAT, objectIds: [REVOLVER] }),
      scene("SCENE_0002", { locationId: MANOR, objectIds: [REVOLVER] }),
    ];
    const transitions = [
      t("SCENE_0001", "object_location", REVOLVER, FLAT, { confirmationStatus: "proposed" }),
    ];
    const timeline = new StoryTimeline(SCENES, transitions);

    expect(checkContinuity({ timeline, scenes, locations: NESTED })).toEqual([]);
    expect(
      checkContinuity({
        timeline,
        scenes,
        locations: NESTED,
        view: { include: "with_proposed" },
      }).map((v) => v.kind),
    ).toContain("impossible_object_appearance");
  });
});
