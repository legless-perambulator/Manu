import { describe, expect, it } from "vitest";
import type {
  Chapter,
  Scene,
  StoryEvent,
  StoryTime,
  TemporalLink,
  TemporalRelation,
  TravelRule,
} from "@jellytind/domain";
import { ChronologyError, StoryChronology, timelineNodes } from "./chronology";
import { checkTimeline } from "./timeline-checks";
import type { StateTransition } from "./types";

const ELIAS = "CHAR_0001";
const MARA = "CHAR_0002";
const LONDON = "LOC_0001";
const EDINBURGH = "LOC_0002";
const MANOR = "LOC_0003";
const THREAD = "THREAD_0001";

// ── Fixture builders ─────────────────────────────────────────────────────────

const chapter = (id: string, order: number): Chapter =>
  ({
    id,
    title: `Chapter ${String(order + 1)}`,
    order,
    filePath: `manuscript/${id}.md`,
    status: "drafted",
  }) as unknown as Chapter;

function scene(id: string, fields: Record<string, unknown> = {}): Scene {
  return {
    id,
    title: id,
    chapterId: "CH_0001",
    characterIds: [],
    plotThreadIds: [],
    objectIds: [],
    factIds: [],
    purpose: [],
    status: "drafted",
    ...fields,
  } as unknown as Scene;
}

function event(id: string, fields: Record<string, unknown> = {}): StoryEvent {
  return {
    id,
    name: id,
    description: "",
    characterIds: [],
    ...fields,
  } as unknown as StoryEvent;
}

let linkSeq = 0;
const link = (
  fromId: string,
  relation: TemporalRelation,
  toId: string,
  extra: Partial<TemporalLink> = {},
): TemporalLink => ({
  id: `TLINK_${String(++linkSeq).padStart(4, "0")}`,
  fromId,
  toId,
  relation,
  source: "author",
  confirmationStatus: "confirmed",
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

let transSeq = 0;
const transition = (sceneId: string, subjectId: string, value: string): StateTransition => ({
  id: `TRANS_${String(++transSeq).padStart(4, "0")}`,
  sceneId,
  kind: "character_location",
  subjectId,
  value,
  source: "author",
  confirmationStatus: "confirmed",
  createdAt: "2026-01-01T00:00:00.000Z",
});

const at = (instant: string): StoryTime => ({ kind: "exact", instant });
const ids = (nodes: readonly { id: string }[]): string[] => nodes.map((n) => n.id);

/**
 * The canonical nonlinear shape: four scenes presented 01→02→03→04, where 03 is
 * a flashback to two years before the rest. Story order is 03, 01, 02, 04.
 */
function nonlinear(): StoryChronology {
  const chapters = [chapter("CH_0001", 0)];
  const scenes = [
    scene("SCENE_0001", { storyTime: at("2019-03-04T09:00:00Z"), characterIds: [ELIAS] }),
    scene("SCENE_0002", { storyTime: at("2019-03-04T18:00:00Z"), characterIds: [ELIAS] }),
    scene("SCENE_0003", { storyTime: at("2017-06-01T12:00:00Z"), characterIds: [ELIAS, MARA] }),
    scene("SCENE_0004", { storyTime: at("2019-03-05T09:00:00Z"), characterIds: [MARA] }),
  ];
  return new StoryChronology(timelineNodes({ scenes, chapters }));
}

// ── Manuscript order vs story order ──────────────────────────────────────────

describe("manuscript order and story order", () => {
  it("keeps presentation order separate from chronological order", () => {
    const chronology = nonlinear();
    expect(ids(chronology.presentationOrder())).toEqual([
      "SCENE_0001",
      "SCENE_0002",
      "SCENE_0003",
      "SCENE_0004",
    ]);
    expect(ids(chronology.chronologicalOrder())).toEqual([
      "SCENE_0003",
      "SCENE_0001",
      "SCENE_0002",
      "SCENE_0004",
    ]);
  });

  it("falls back to manuscript order when a story records no time at all", () => {
    const chapters = [chapter("CH_0001", 0), chapter("CH_0002", 1)];
    const scenes = [
      scene("SCENE_0002", { chapterId: "CH_0002" }),
      scene("SCENE_0001", { chapterId: "CH_0001" }),
    ];
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }));
    expect(ids(chronology.chronologicalOrder())).toEqual(["SCENE_0001", "SCENE_0002"]);
  });

  it("does not treat chapter order as chronological truth", () => {
    const chronology = nonlinear();
    // Presented second, happens second-to-last; presented third, happens first.
    expect(chronology.chronologicalIndexOf("SCENE_0003")).toBe(0);
    expect(chronology.chronologicalIndexOf("SCENE_0002")).toBe(2);
  });

  it("reports an unknown node rather than guessing", () => {
    expect(() => nonlinear().chronologicalIndexOf("SCENE_9999")).toThrow(ChronologyError);
  });
});

// ── Flashbacks ───────────────────────────────────────────────────────────────

describe("flashbacks", () => {
  it("identifies a scene presented after material that happens later", () => {
    const chronology = nonlinear();
    expect(chronology.isFlashback("SCENE_0003")).toBe(true);
    expect(chronology.isFlashback("SCENE_0001")).toBe(false);
    expect(chronology.isFlashback("SCENE_0004")).toBe(false);
    expect(ids(chronology.flashbacks())).toEqual(["SCENE_0003"]);
  });

  it("finds no flashbacks in a linear story", () => {
    const chapters = [chapter("CH_0001", 0)];
    const scenes = [
      scene("SCENE_0001", { storyTime: at("2019-03-04T09:00:00Z") }),
      scene("SCENE_0002", { storyTime: at("2019-03-04T18:00:00Z") }),
    ];
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }));
    expect(chronology.flashbacks()).toEqual([]);
  });
});

// ── Relative chronology, with no dates anywhere ──────────────────────────────

describe("chronology without timestamps", () => {
  const chapters = [chapter("CH_0001", 0)];
  const scenes = [scene("SCENE_0001"), scene("SCENE_0002"), scene("SCENE_0003")];

  it("orders scenes by explicit relations alone", () => {
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }), [
      link("SCENE_0003", "before", "SCENE_0001"),
    ]);
    expect(ids(chronology.chronologicalOrder())).toEqual([
      "SCENE_0003",
      "SCENE_0001",
      "SCENE_0002",
    ]);
    // Nothing was dated, and the chronology is still correct.
    expect(chronology.intervalOf("SCENE_0003").anchored).toBe(false);
  });

  it("reads `after` as the mirror of `before`", () => {
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }), [
      link("SCENE_0001", "after", "SCENE_0003"),
    ]);
    expect(ids(chronology.chronologicalOrder())).toEqual([
      "SCENE_0003",
      "SCENE_0001",
      "SCENE_0002",
    ]);
  });

  it("places an event relative to an anchor it has no date for", () => {
    const chronology = new StoryChronology(
      timelineNodes({
        scenes,
        chapters,
        events: [
          event("EVENT_0001", {
            storyTime: { kind: "relative", anchorId: "SCENE_0002", relation: "before" },
          }),
        ],
      }),
    );
    expect(chronology.chronologicalIndexOf("EVENT_0001")).toBeLessThan(
      chronology.chronologicalIndexOf("SCENE_0002"),
    );
  });

  it("keeps undated scenes in their manuscript neighbourhood when others are dated", () => {
    const mixed = [
      scene("SCENE_0001", { storyTime: at("2019-01-01T00:00:00Z") }),
      scene("SCENE_0002"),
      scene("SCENE_0003", { storyTime: at("2016-01-01T00:00:00Z") }),
      scene("SCENE_0004"),
    ];
    const chronology = new StoryChronology(timelineNodes({ scenes: mixed, chapters }));
    // 03 moves to the front and takes its undated successor with it; 02 stays
    // with the dated scene it follows.
    expect(ids(chronology.chronologicalOrder())).toEqual([
      "SCENE_0003",
      "SCENE_0004",
      "SCENE_0001",
      "SCENE_0002",
    ]);
  });
});

// ── Relative offsets and durations ───────────────────────────────────────────

describe("relative story time with a known offset", () => {
  it("resolves an instant three days after its anchor", () => {
    const chapters = [chapter("CH_0001", 0)];
    const scenes = [scene("SCENE_0001", { storyTime: at("2019-03-01T12:00:00Z") })];
    const events = [
      event("EVENT_0001", {
        storyTime: {
          kind: "relative",
          anchorId: "SCENE_0001",
          relation: "after",
          offset: { days: 3 },
        },
      }),
    ];
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters, events }));
    const resolved = chronology.intervalOf("EVENT_0001");
    expect(resolved.anchored).toBe(true);
    expect(resolved.inferred).toBe(true);
    expect(new Date(resolved.start.earliest as number).toISOString()).toBe(
      "2019-03-04T12:00:00.000Z",
    );
  });

  it("gives an unquantified `after` a lower bound and no upper bound", () => {
    const chapters = [chapter("CH_0001", 0)];
    const scenes = [scene("SCENE_0001", { storyTime: at("2019-03-01T12:00:00Z") })];
    const events = [
      event("EVENT_0001", {
        storyTime: { kind: "relative", anchorId: "SCENE_0001", relation: "after" },
      }),
    ];
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters, events }));
    const resolved = chronology.intervalOf("EVENT_0001");
    expect(resolved.start.earliest).toBeDefined();
    expect(resolved.start.latest).toBeUndefined();
  });

  it("carries a duration into the node's end bound", () => {
    const chapters = [chapter("CH_0001", 0)];
    const scenes = [
      scene("SCENE_0001", { storyTime: at("2019-03-01T12:00:00Z"), duration: { hours: 2 } }),
    ];
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }));
    const resolved = chronology.intervalOf("SCENE_0001");
    expect(new Date(resolved.end.earliest as number).toISOString()).toBe(
      "2019-03-01T14:00:00.000Z",
    );
  });
});

// ── Parallel and overlapping material ────────────────────────────────────────

describe("parallel events", () => {
  it("finds scenes that occupy the same story moment", () => {
    const chapters = [chapter("CH_0001", 0)];
    const scenes = [
      scene("SCENE_0001", {
        storyTime: at("2019-03-04T14:00:00Z"),
        duration: { hours: 1 },
        characterIds: [ELIAS],
      }),
      scene("SCENE_0002", {
        storyTime: at("2019-03-04T14:30:00Z"),
        characterIds: [MARA],
      }),
      scene("SCENE_0003", { storyTime: at("2019-03-05T14:00:00Z") }),
    ];
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }));
    expect(ids(chronology.simultaneousWith("SCENE_0001"))).toEqual(["SCENE_0002"]);
  });

  it("honours a declared `same_time` between two undated scenes", () => {
    const chapters = [chapter("CH_0001", 0)];
    const scenes = [scene("SCENE_0001"), scene("SCENE_0002"), scene("SCENE_0003")];
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }), [
      link("SCENE_0001", "same_time", "SCENE_0003"),
    ]);
    expect(ids(chronology.simultaneousWith("SCENE_0001"))).toEqual(["SCENE_0003"]);
  });

  it("treats `overlaps` as simultaneity without requiring dates", () => {
    const chapters = [chapter("CH_0001", 0)];
    const scenes = [scene("SCENE_0001"), scene("SCENE_0002")];
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }), [
      link("SCENE_0001", "overlaps", "SCENE_0002"),
    ]);
    expect(ids(chronology.simultaneousWith("SCENE_0002"))).toEqual(["SCENE_0001"]);
  });

  it("does not call two scenes on the same undated day simultaneous", () => {
    const chapters = [chapter("CH_0001", 0)];
    const scenes = [scene("SCENE_0001"), scene("SCENE_0002")];
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }));
    expect(chronology.simultaneousWith("SCENE_0001")).toEqual([]);
  });
});

// ── Events off the page ──────────────────────────────────────────────────────

describe("events", () => {
  const chapters = [chapter("CH_0001", 0)];
  const scenes = [
    scene("SCENE_0001", { storyTime: at("2019-03-04T09:00:00Z"), characterIds: [ELIAS] }),
    scene("SCENE_0002", { storyTime: at("2019-03-06T09:00:00Z"), characterIds: [ELIAS] }),
  ];
  const events = [
    // Predates the manuscript entirely.
    event("EVENT_0001", {
      name: "The fire",
      storyTime: at("1997-08-14T22:00:00Z"),
      characterIds: [ELIAS],
      locationId: MANOR,
      plotThreadIds: [THREAD],
    }),
    // Happens between two scenes, off the page.
    event("EVENT_0002", {
      name: "The letter arrives",
      storyTime: at("2019-03-05T09:00:00Z"),
      characterIds: [MARA],
    }),
    // Dramatised inside a scene.
    event("EVENT_0003", {
      name: "The confrontation",
      storyTime: at("2019-03-06T09:30:00Z"),
      sceneId: "SCENE_0002",
      characterIds: [ELIAS],
    }),
  ];
  const chronology = new StoryChronology(timelineNodes({ scenes, chapters, events }));

  it("orders events and scenes on one timeline", () => {
    expect(ids(chronology.chronologicalOrder())).toEqual([
      "EVENT_0001",
      "SCENE_0001",
      "EVENT_0002",
      "SCENE_0002",
      "EVENT_0003",
    ]);
  });

  it("gives off-page events no presentation position", () => {
    expect(chronology.node("EVENT_0002").presentationIndex).toBeUndefined();
    expect(chronology.node("EVENT_0003").presentationIndex).toBe(1);
  });

  it("returns a character's events in the order they happened", () => {
    expect(ids(chronology.getEventsForCharacter(ELIAS))).toEqual(["EVENT_0001", "EVENT_0003"]);
    expect(ids(chronology.getEventsForCharacter(MARA))).toEqual(["EVENT_0002"]);
  });

  it("filters by location and by plot thread", () => {
    expect(ids(chronology.nodesAtLocation(MANOR))).toEqual(["EVENT_0001"]);
    expect(ids(chronology.nodesForPlotThread(THREAD))).toEqual(["EVENT_0001"]);
  });
});

// ── Character timelines ──────────────────────────────────────────────────────

describe("character timelines", () => {
  it("walks a character's story in the order they lived it", () => {
    const chronology = nonlinear();
    const timeline = chronology.getCharacterTimeline(ELIAS);
    expect(timeline.map((entry) => entry.nodeId)).toEqual([
      "SCENE_0003",
      "SCENE_0001",
      "SCENE_0002",
    ]);
    expect(timeline[0]?.isFlashback).toBe(true);
    expect(timeline[0]?.presentationIndex).toBe(2);
    expect(timeline[0]?.chronologicalIndex).toBe(0);
  });

  it("reconstructs where a character was at a story-world instant", () => {
    const chapters = [chapter("CH_0001", 0)];
    const scenes = [
      scene("SCENE_0001", { storyTime: at("2019-03-04T09:00:00Z"), characterIds: [ELIAS] }),
      scene("SCENE_0002", { storyTime: at("2019-03-06T09:00:00Z"), characterIds: [ELIAS] }),
      // Presented last, happens first: the flashback that breaks naive replay.
      scene("SCENE_0003", { storyTime: at("2017-06-01T12:00:00Z"), characterIds: [ELIAS] }),
    ];
    const transitions = [
      transition("SCENE_0003", ELIAS, MANOR),
      transition("SCENE_0001", ELIAS, LONDON),
      transition("SCENE_0002", ELIAS, EDINBURGH),
    ];
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }));

    expect(
      chronology.getCharacterLocationAtTime(
        ELIAS,
        { kind: "instant", instant: "2018-01-01T00:00:00Z" },
        transitions,
      ),
    ).toBe(MANOR);
    expect(
      chronology.getCharacterLocationAtTime(
        ELIAS,
        { kind: "instant", instant: "2019-03-05T00:00:00Z" },
        transitions,
      ),
    ).toBe(LONDON);
    expect(
      chronology.getCharacterLocationAtTime(
        ELIAS,
        { kind: "instant", instant: "2019-03-07T00:00:00Z" },
        transitions,
      ),
    ).toBe(EDINBURGH);
  });

  it("returns nothing for a moment before the story world begins", () => {
    const chronology = nonlinear();
    expect(
      chronology.getCharacterLocationAtTime(
        ELIAS,
        { kind: "instant", instant: "1900-01-01T00:00:00Z" },
        [],
      ),
    ).toBeUndefined();
  });

  it("replays state in chronological order, not manuscript order", () => {
    const chapters = [chapter("CH_0001", 0)];
    const scenes = [
      scene("SCENE_0001", { storyTime: at("2019-03-04T09:00:00Z") }),
      scene("SCENE_0002", { storyTime: at("2017-01-01T09:00:00Z") }),
    ];
    const transitions = [
      transition("SCENE_0001", ELIAS, LONDON),
      transition("SCENE_0002", ELIAS, MANOR),
    ];
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }));

    // Manuscript replay ends on the flashback's location; chronological replay
    // ends where the character actually is latest in story time.
    expect(chronology.chronologicalSceneOrder()).toEqual(["SCENE_0002", "SCENE_0001"]);
    expect(
      chronology.stateTimeline(transitions).characterStateAfterScene(ELIAS, "SCENE_0001")
        .locationId,
    ).toBe(LONDON);
    expect(
      chronology.stateTimeline(transitions).characterStateBeforeScene(ELIAS, "SCENE_0001")
        .locationId,
    ).toBe(MANOR);
  });
});

// ── Validation ───────────────────────────────────────────────────────────────

describe("timeline validation", () => {
  const chapters = [chapter("CH_0001", 0)];

  it("finds nothing wrong with a consistent timeline", () => {
    expect(checkTimeline({ chronology: nonlinear() })).toEqual([]);
  });

  it("catches relations that contradict each other", () => {
    const scenes = [scene("SCENE_0001"), scene("SCENE_0002")];
    const links = [
      link("SCENE_0001", "before", "SCENE_0002"),
      link("SCENE_0002", "before", "SCENE_0001"),
    ];
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }), links);
    const found = checkTimeline({ chronology, links });
    expect(found.map((v) => v.kind)).toContain("contradictory_relations");
    // The timeline is still usable: every node is still ordered somewhere.
    expect(chronology.chronologicalOrder()).toHaveLength(2);
  });

  it("catches a relation the recorded times refute", () => {
    const scenes = [
      scene("SCENE_0001", { storyTime: at("2019-03-04T09:00:00Z") }),
      scene("SCENE_0002", { storyTime: at("2019-03-01T09:00:00Z") }),
    ];
    const links = [link("SCENE_0001", "before", "SCENE_0002")];
    const found = checkTimeline({
      chronology: new StoryChronology(timelineNodes({ scenes, chapters }), links),
      links,
    });
    const violation = found.find((v) => v.kind === "relation_contradicts_time");
    expect(violation?.severity).toBe("error");
    expect(violation?.nodeIds).toEqual(["SCENE_0001", "SCENE_0002"]);
  });

  it("grades a refuted soft relation as a warning, not an error", () => {
    const scenes = [
      scene("SCENE_0001", { storyTime: at("2019-03-04T09:00:00Z") }),
      scene("SCENE_0002", { storyTime: at("2019-03-01T09:00:00Z") }),
    ];
    const links = [link("SCENE_0001", "approximately_before", "SCENE_0002")];
    const found = checkTimeline({
      chronology: new StoryChronology(timelineNodes({ scenes, chapters }), links),
      links,
    });
    expect(found.find((v) => v.kind === "relation_contradicts_time")?.severity).toBe("warning");
  });

  it("catches one character in two places at one instant", () => {
    const scenes = [
      scene("SCENE_0001", {
        storyTime: at("2019-03-04T14:00:00Z"),
        locationId: LONDON,
        characterIds: [ELIAS],
      }),
      scene("SCENE_0002", {
        storyTime: at("2019-03-04T14:00:00Z"),
        locationId: EDINBURGH,
        characterIds: [ELIAS],
      }),
    ];
    const found = checkTimeline({
      chronology: new StoryChronology(timelineNodes({ scenes, chapters })),
    });
    const violation = found.find((v) => v.kind === "character_bilocation");
    expect(violation?.severity).toBe("error");
    expect(violation?.characterId).toBe(ELIAS);
  });

  it("does not call two scenes on the same day a bilocation", () => {
    const scenes = [
      scene("SCENE_0001", {
        storyTime: { kind: "date", date: "2019-03-04" },
        locationId: LONDON,
        characterIds: [ELIAS],
      }),
      scene("SCENE_0002", {
        storyTime: { kind: "date", date: "2019-03-04" },
        locationId: EDINBURGH,
        characterIds: [ELIAS],
      }),
    ];
    const found = checkTimeline({
      chronology: new StoryChronology(timelineNodes({ scenes, chapters })),
    });
    expect(found.map((v) => v.kind)).not.toContain("character_bilocation");
  });

  /**
   * The London-to-Edinburgh case from the specification — and the reason it
   * needs a declaration. Without one the system has no business claiming five
   * minutes is too short: the story may be set anywhere, in any century.
   */
  describe("impossible travel", () => {
    const scenes = [
      scene("SCENE_0001", {
        storyTime: at("2019-03-04T14:00:00Z"),
        locationId: LONDON,
        characterIds: [ELIAS],
      }),
      scene("SCENE_0002", {
        storyTime: at("2019-03-04T14:05:00Z"),
        locationId: EDINBURGH,
        characterIds: [ELIAS],
      }),
    ];
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }));
    const travel: TravelRule[] = [
      {
        id: "TRAVEL_0001",
        fromLocationId: LONDON,
        toLocationId: EDINBURGH,
        minimum: { hours: 4 },
      },
    ];

    it("reports nothing when no travel time has been declared", () => {
      expect(checkTimeline({ chronology }).map((v) => v.kind)).not.toContain("impossible_travel");
    });

    it("reports the journey once the writer declares how long it takes", () => {
      const violation = checkTimeline({ chronology, travel }).find(
        (v) => v.kind === "impossible_travel",
      );
      expect(violation?.severity).toBe("error");
      expect(violation?.characterId).toBe(ELIAS);
      expect(violation?.locationIds).toEqual([LONDON, EDINBURGH]);
    });

    it("accepts the same journey when the story allows time for it", () => {
      const roomy = [
        scenes[0] as Scene,
        scene("SCENE_0002", {
          storyTime: at("2019-03-04T20:00:00Z"),
          locationId: EDINBURGH,
          characterIds: [ELIAS],
        }),
      ];
      const found = checkTimeline({
        chronology: new StoryChronology(timelineNodes({ scenes: roomy, chapters })),
        travel,
      });
      expect(found.map((v) => v.kind)).not.toContain("impossible_travel");
    });
  });

  it("catches constraints that leave a node no possible moment", () => {
    const scenes = [
      scene("SCENE_0001", { storyTime: at("2019-03-04T09:00:00Z") }),
      scene("SCENE_0002", { storyTime: at("2019-03-06T09:00:00Z") }),
      scene("SCENE_0003"),
    ];
    // Squeezed both after a later scene and before an earlier one.
    const links = [
      link("SCENE_0002", "before", "SCENE_0003"),
      link("SCENE_0003", "before", "SCENE_0001"),
    ];
    const found = checkTimeline({
      chronology: new StoryChronology(timelineNodes({ scenes, chapters }), links),
      links,
    });
    expect(found.map((v) => v.kind)).toContain("impossible_interval");
  });

  it("reports a relation pointing at something not on the timeline", () => {
    const scenes = [scene("SCENE_0001")];
    const links = [link("SCENE_0001", "before", "SCENE_9999")];
    const found = checkTimeline({
      chronology: new StoryChronology(timelineNodes({ scenes, chapters }), links),
      links,
    });
    expect(found.find((v) => v.kind === "dangling_relation")?.severity).toBe("warning");
  });

  it("notices an event placed in a scene whose story time excludes it", () => {
    const scenes = [scene("SCENE_0001", { storyTime: at("2019-03-04T09:00:00Z") })];
    const events = [
      event("EVENT_0001", { storyTime: at("2019-03-09T09:00:00Z"), sceneId: "SCENE_0001" }),
    ];
    const found = checkTimeline({
      chronology: new StoryChronology(timelineNodes({ scenes, chapters, events })),
    });
    expect(found.find((v) => v.kind === "event_outside_scene")?.severity).toBe("warning");
  });
});

// ── Canon boundary ───────────────────────────────────────────────────────────

describe("proposed relations", () => {
  const chapters = [chapter("CH_0001", 0)];
  const scenes = [scene("SCENE_0001"), scene("SCENE_0002")];
  const proposed = [
    link("SCENE_0002", "before", "SCENE_0001", { confirmationStatus: "proposed", source: "agent" }),
  ];

  it("ignores a proposed relation by default", () => {
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }), proposed);
    expect(ids(chronology.chronologicalOrder())).toEqual(["SCENE_0001", "SCENE_0002"]);
  });

  it("previews it under `with_proposed` without changing canon", () => {
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }), proposed, {
      view: { include: "with_proposed" },
    });
    expect(ids(chronology.chronologicalOrder())).toEqual(["SCENE_0002", "SCENE_0001"]);
  });

  it("never honours a rejected relation", () => {
    const rejected = [
      link("SCENE_0002", "before", "SCENE_0001", { confirmationStatus: "rejected" }),
    ];
    const chronology = new StoryChronology(timelineNodes({ scenes, chapters }), rejected, {
      view: { include: "with_proposed" },
    });
    expect(ids(chronology.chronologicalOrder())).toEqual(["SCENE_0001", "SCENE_0002"]);
  });
});

// ── Determinism ──────────────────────────────────────────────────────────────

describe("determinism", () => {
  it("yields the same order however the input is shuffled", () => {
    const chapters = [chapter("CH_0001", 0)];
    const scenes = [
      scene("SCENE_0001", { storyTime: at("2019-03-04T09:00:00Z") }),
      scene("SCENE_0002"),
      scene("SCENE_0003", { storyTime: at("2017-06-01T12:00:00Z") }),
      scene("SCENE_0004", { storyTime: at("2019-03-05T09:00:00Z") }),
    ];
    const forwards = new StoryChronology(timelineNodes({ scenes, chapters }));
    const backwards = new StoryChronology(
      timelineNodes({ scenes: [...scenes].reverse(), chapters }),
    );
    // Reversing the project's storage order reverses presentation order too, so
    // the undated scene moves with its neighbourhood — the dated ones do not.
    expect(ids(forwards.chronologicalOrder()).filter((id) => id !== "SCENE_0002")).toEqual(
      ids(backwards.chronologicalOrder()).filter((id) => id !== "SCENE_0002"),
    );
    expect(ids(forwards.chronologicalOrder())).toEqual(
      ids(new StoryChronology(timelineNodes({ scenes, chapters })).chronologicalOrder()),
    );
  });
});
