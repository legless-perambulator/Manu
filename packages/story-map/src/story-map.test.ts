import { describe, expect, it } from "vitest";
import type {
  Chapter,
  Character,
  Dependency,
  Fact,
  Location,
  PlotThread,
  Relationship,
  Scene,
  StoryEvent,
  StoryTest,
} from "@jellytind/domain";
import { orderScenes } from "@jellytind/domain";
import {
  StoryChronology,
  StoryTimeline,
  timelineNodes,
  type StateTransition,
  type TransitionKind,
} from "@jellytind/story-state";
import type { Diagnostic } from "@jellytind/story-compiler";
import { diagnosticOverlay, searchStrip, storyTestOverlay } from "./overlays";
import { describeStoryPoint, resolveStoryPoint, storyPointStops } from "./point";
import {
  blastRadiusView,
  causalityView,
  characterArcView,
  characterKnowledgeView,
  factKnowledgeView,
  relationshipView,
  threadView,
  timelineView,
} from "./views";
import type { StoryMapContext } from "./types";

/**
 * Phase 38 §21 — the acceptance scenario: a complex fixture novel explored
 * through every view of one coherent story-intelligence system.
 *
 * 10 chapters, 6 characters, 4 locations, 4 plot threads, 15 facts,
 * knowledge transitions, relationships and causality — all at the same
 * stable IDs every other subsystem uses (§3).
 */

const CH = (n: number): string => `CHAPTER_${String(n).padStart(4, "0")}`;
const SC = (n: number): string => `SCENE_${String(n).padStart(4, "0")}`;
const MARA = "CHAR_0001";
const ELIAS = "CHAR_0002";
const MARCUS = "CHAR_0003";
const WREN = "CHAR_0004";
const IRIS = "CHAR_0005";
const DORAN = "CHAR_0006";
const CHARACTER_NAMES: Readonly<Record<string, string>> = {
  [MARA]: "Mara",
  [ELIAS]: "Elias",
  [MARCUS]: "Marcus",
  [WREN]: "Wren",
  [IRIS]: "Iris",
  [DORAN]: "Doran",
};
const MANOR = "LOC_0001";
const VAULT = "LOC_0002";
const FLAT = "LOC_0003";
const STATION = "LOC_0004";
const THREADS = ["THREAD_0001", "THREAD_0002", "THREAD_0003", "THREAD_0004"] as const;
const PHOTOGRAPH = THREADS[0];
const FACT = (n: number): string => `FACT_${String(n).padStart(4, "0")}`;
const VAULT_EXISTS = FACT(1);
const REL_ELIAS_MARA = "REL_0001";
const EVENT_FIRE = "EVENT_0001";
const EVENT_HEIST = "EVENT_0002";

let transitionSeq = 0;
const transition = (
  sceneId: string,
  kind: TransitionKind,
  subjectId: string,
  value: string,
  extra: Partial<StateTransition> = {},
): StateTransition =>
  ({
    id: `TRANS_${String(++transitionSeq).padStart(4, "0")}`,
    sceneId,
    kind,
    subjectId,
    value,
    source: "author",
    confirmationStatus: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  }) as StateTransition;

function fixture(): StoryMapContext {
  const chapters: Chapter[] = Array.from({ length: 10 }, (_, i) => ({
    id: CH(i + 1),
    title: `Chapter ${String(i + 1)}`,
    order: i + 1,
    filePath: `manuscript/${CH(i + 1)}.md`,
    status: "drafted",
  })) as unknown as Chapter[];

  // Two scenes per chapter; every scene names its cast, location and threads.
  const cast: Record<number, string[]> = {
    1: [MARA, ELIAS],
    2: [MARA, MARCUS],
    3: [ELIAS, WREN],
    4: [MARA, ELIAS, IRIS],
    5: [MARCUS, DORAN],
    6: [MARA, ELIAS],
    7: [ELIAS, MARA],
    8: [WREN, IRIS],
    9: [MARA, ELIAS, MARCUS],
    10: [MARA, ELIAS],
  };
  const scenes: Scene[] = [];
  for (let chapter = 1; chapter <= 10; chapter += 1) {
    for (let inChapter = 0; inChapter < 2; inChapter += 1) {
      const n = (chapter - 1) * 2 + inChapter + 1;
      scenes.push({
        id: SC(n),
        title: `Scene ${String(n)}`,
        chapterId: CH(chapter),
        order: n,
        pov: cast[chapter]?.[0],
        characterIds: cast[chapter] ?? [MARA],
        locationId: [MANOR, VAULT, FLAT, STATION][(chapter - 1) % 4],
        purpose: [`beat ${String(n)}`],
        // The photograph thread: touched in chapters 2 and 3, dormant through
        // 4–8, resolved in chapter 9 (§8).
        plotThreadIds:
          (chapter === 2 || chapter === 3 || chapter === 9) && inChapter === 0
            ? [PHOTOGRAPH]
            : chapter === 5 && inChapter === 1
              ? [THREADS[1]]
              : [],
      } as unknown as Scene);
    }
  }

  const characters = Object.entries(CHARACTER_NAMES).map(
    ([id, name]) =>
      ({
        id,
        name,
        aliases: [],
        description: "",
        goals: id === MARA ? ["Open the vault"] : [],
      }) as unknown as Character,
  );
  const locations = [
    { id: MANOR, name: "Blackthorn Manor" },
    { id: VAULT, name: "The Vault" },
    { id: FLAT, name: "Mara's Flat" },
    { id: STATION, name: "King's Cross" },
  ] as unknown as Location[];
  const threads = THREADS.map(
    (id, index) =>
      ({
        id,
        name: ["Missing Photograph", "The Debt", "Wren's Secret", "The Fire"][index],
      }) as unknown as PlotThread,
  );
  const facts: Fact[] = Array.from({ length: 15 }, (_, i) => ({
    id: FACT(i + 1),
    statement: i === 0 ? "The vault exists" : `Fact ${String(i + 1)}`,
  })) as unknown as Fact[];

  const relationships = [
    {
      id: REL_ELIAS_MARA,
      characterAId: ELIAS,
      characterBId: MARA,
      type: "allies",
      status: "friendly",
      description: "",
    },
    {
      id: "REL_0002",
      characterAId: MARA,
      characterBId: MARCUS,
      type: "rivals",
      status: "wary",
      description: "",
    },
    {
      id: "REL_0003",
      characterAId: WREN,
      characterBId: IRIS,
      type: "friends",
      status: "close",
      description: "",
    },
  ] as unknown as Relationship[];

  const transitions: StateTransition[] = [
    // §5: Mara learns the vault exists in scene 7 (chapter 4); Elias comes to
    // believe it in scene 8, from Mara; Marcus never hears of it.
    transition(SC(7), "knowledge_changed", MARA, VAULT_EXISTS, {
      knowledgeState: "known",
      sourceType: "witnessed",
    } as Partial<StateTransition>),
    transition(SC(8), "knowledge_changed", ELIAS, VAULT_EXISTS, {
      knowledgeState: "believed",
      sourceType: "told",
      sourceEntityId: MARA,
    } as Partial<StateTransition>),
    // A later acquisition the backward scrub must make disappear (§21.5).
    transition(SC(15), "knowledge_changed", MARA, FACT(9), {
      knowledgeState: "known",
      sourceType: "inferred",
    } as Partial<StateTransition>),
    // Arc material (§9): status and location changes for Elias.
    transition(SC(5), "character_location", ELIAS, MANOR),
    transition(SC(13), "character_status", ELIAS, "missing"),
    // §6: the Elias↔Mara relationship strains across three scenes.
    transition(SC(3), "relationship_event", REL_ELIAS_MARA, "trust_broken"),
    transition(SC(11), "relationship_event", REL_ELIAS_MARA, "reconciled"),
    transition(SC(17), "relationship_status", REL_ELIAS_MARA, "strained"),
    transition(SC(17), "relationship_dimension", REL_ELIAS_MARA, "trust", {
      dimension: "trust",
      level: "low",
    } as Partial<StateTransition>),
  ];

  // §7: Vault Discovery → Elias Confronts Mara → Mara Lies → Trust Collapse.
  const dep = (id: string, fromId: string, toId: string, kind: string): Dependency =>
    ({
      id,
      kind,
      fromId,
      toId,
      status: "confirmed",
      source: "author",
      createdAt: "2026-01-01T00:00:00.000Z",
    }) as unknown as Dependency;
  const dependencies = [
    dep("DEP_0001", SC(8), SC(7), "requires"),
    dep("DEP_0002", SC(11), SC(8), "requires"),
    dep("DEP_0003", SC(17), SC(11), "requires"),
    dep("DEP_0004", SC(19), SC(17), "requires"),
  ];

  const events = [
    {
      id: EVENT_FIRE,
      name: "The Manor Fire",
      description: "",
      characterIds: [],
      storyTime: { kind: "instant", iso: "1990-06-01T00:00:00Z" },
    },
    {
      id: EVENT_HEIST,
      name: "The Heist",
      description: "",
      characterIds: [MARA, ELIAS],
      sceneId: SC(18),
    },
  ] as unknown as StoryEvent[];

  const storyTests: StoryTest[] = [
    {
      id: "TEST_0001",
      name: "Marcus never learns of the vault",
      description: "Marcus must not know the vault exists before chapter 10",
      type: "deterministic",
      scope: { kind: "before", anchorId: CH(10) },
      enabled: true,
      severity: "error",
      assertion: {
        kind: "character_does_not_know_fact",
        characterId: MARCUS,
        factId: VAULT_EXISTS,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    } as unknown as StoryTest,
  ];

  const ordered = orderScenes(scenes, chapters).map((scene) => scene.id as string);
  return {
    scenes,
    chapters,
    characters,
    locations,
    events,
    threads,
    facts,
    relationships,
    dependencies,
    decisions: [],
    storyTests,
    transitions,
    timeline: new StoryTimeline(ordered, transitions),
    chronology: new StoryChronology(timelineNodes({ scenes, chapters, events }), []),
  };
}

describe("§21 — exploring a complex novel through one system", () => {
  const context = fixture();
  const stops = storyPointStops(context.scenes, context.chapters);
  const end = resolveStoryPoint({ kind: "end" }, context.scenes, context.chapters);

  it("1–2: the Story Map opens on a timeline of the whole telling", () => {
    const view = timelineView(context);
    expect(view.scenes).toHaveLength(20);
    expect(view.scenes[0]?.presentationIndex).toBe(0);
    // §3: the elements ARE the canonical entities — same stable IDs.
    expect(view.scenes[0]?.sceneId).toBe(SC(1));
    expect(view.scenes[0]?.characterIds).toContain(MARA);
    expect(view.lanes.some((lane) => lane.characterId === ELIAS)).toBe(true);
    // §10: an off-page dated event is historical; an on-page one has a scene.
    expect(view.events.find((event) => event.eventId === EVENT_HEIST)?.sceneId).toBe(SC(18));
  });

  it("3: the Knowledge view answers who stands where on one fact", () => {
    expect(end).not.toBeNull();
    const view = factKnowledgeView(context, VAULT_EXISTS, end as NonNullable<typeof end>);
    const byId = new Map(view.rows.map((row) => [row.characterId, row]));
    expect(byId.get(MARA)?.state).toBe("known");
    expect(byId.get(MARA)?.acquiredAtSceneId).toBe(SC(7));
    expect(byId.get(ELIAS)?.state).toBe("believed");
    expect(byId.get(ELIAS)?.sourceEntityId).toBe(MARA);
    expect(byId.get(MARCUS)?.state).toBe("unknown");
  });

  it("4–5: scrubbing the story point backwards makes future knowledge disappear", () => {
    const late = resolveStoryPoint(
      { kind: "chapter", chapterId: CH(9), edge: "after" },
      context.scenes,
      context.chapters,
    );
    const early = resolveStoryPoint(
      { kind: "chapter", chapterId: CH(3), edge: "after" },
      context.scenes,
      context.chapters,
    );
    expect(late).not.toBeNull();
    expect(early).not.toBeNull();
    const lateWorld = characterKnowledgeView(context, MARA, late as NonNullable<typeof late>);
    const earlyWorld = characterKnowledgeView(context, MARA, early as NonNullable<typeof early>);
    expect(lateWorld.holdings.some((held) => held.factId === VAULT_EXISTS)).toBe(true);
    expect(lateWorld.holdings.some((held) => held.factId === FACT(9))).toBe(true);
    // Before chapter 4 Mara has learned nothing yet: the future is gone.
    expect(earlyWorld.holdings).toHaveLength(0);
    expect(describeStoryPoint(early as NonNullable<typeof early>, stops)).toContain("after");
  });

  it("6: a relationship edge carries qualitative state and its key changes", () => {
    const view = relationshipView(context, end as NonNullable<typeof end>);
    const edge = view.edges.find((held) => held.relationshipId === REL_ELIAS_MARA);
    expect(edge?.status).toBe("strained");
    expect(edge?.dimensions).toContainEqual({ dimension: "trust", value: "low" });
    // Key changes: the scenes where something happened, in order (§6).
    expect(edge?.keyChangeSceneIds).toEqual(expect.arrayContaining([SC(3), SC(11)]));
    // The nodes are the same Characters used everywhere else (§3).
    expect(view.nodes.find((node) => node.characterId === ELIAS)?.name).toBe("Elias");
  });

  it("7: a plot thread reads as introduced, advanced, dormant and resolved", () => {
    const view = threadView(context, PHOTOGRAPH);
    expect(view.name).toBe("Missing Photograph");
    const touched = view.chapters.filter((chapter) => chapter.touchSceneIds.length > 0);
    expect(touched.map((chapter) => chapter.chapterId)).toEqual([CH(2), CH(3), CH(9)]);
    // Chapters 4–8: dormant between the chapter-3 touch and the chapter-9 one.
    expect(view.dormantSpans).toHaveLength(1);
    expect(view.dormantSpans[0]?.fromChapterId).toBe(CH(4));
    expect(view.dormantSpans[0]?.toChapterId).toBe(CH(8));
    expect(view.dormantSpans[0]?.chapters).toBe(5);
  });

  it("8: causality traces the chain and expands prerequisites and consequences", () => {
    const view = causalityView(context, SC(11), { upDepth: 2, downDepth: 2 });
    const ids = view.nodes.map((node) => node.id);
    // Up: the confrontation rests on the discovery; down: the collapse follows.
    expect(ids).toEqual(expect.arrayContaining([SC(7), SC(8), SC(11), SC(17), SC(19)]));
    const up = view.nodes.find((node) => node.id === SC(7));
    const down = view.nodes.find((node) => node.id === SC(19));
    expect((up?.distance ?? 0) < 0).toBe(true);
    expect((down?.distance ?? 0) > 0).toBe(true);
    expect(view.edges.length).toBeGreaterThanOrEqual(4);
  });

  it("9: every visual element opens the real thing — stable scene references", () => {
    const view = causalityView(context, SC(11));
    for (const node of view.nodes) {
      if (node.kind === "scene") {
        expect(context.scenes.some((scene) => scene.id === node.id)).toBe(true);
      }
    }
    // A search result strip arranges scenes chronologically for the map (§12).
    const strip = searchStrip(context, [SC(15), SC(3), SC(9)]);
    expect(strip.map((entry) => entry.sceneId)).toEqual([SC(3), SC(9), SC(15)]);
  });

  it("10: compiler diagnostics overlay onto the elements they are about", () => {
    const diagnostic: Diagnostic = {
      id: "DIAG_1",
      ruleId: "knowledge_continuity",
      severity: "error",
      message: "Marcus references the vault without learning of it",
      entities: [MARCUS, VAULT_EXISTS],
      sceneId: SC(9),
      evidence: "No knowledge transition gives Marcus a position on it.",
    };
    const overlay = diagnosticOverlay([diagnostic]);
    expect(overlay.byScene[SC(9)]?.[0]?.ruleId).toBe("knowledge_continuity");
    expect(overlay.byEntity[MARCUS]).toHaveLength(1);
    expect(overlay.total).toBe(1);

    // §16: the story test overlay shows the span it guards.
    const tests = storyTestOverlay(context, [{ testId: "TEST_0001", sceneIds: [SC(9)] }]);
    expect(tests[0]?.scopeSceneIds).toHaveLength(18); // before chapter 10
    expect(tests[0]?.failSceneIds).toEqual([SC(9)]);
  });

  it("11: the Refactor impact visualisation is the blast radius, labelled", () => {
    const impact = blastRadiusView(context, SC(7));
    expect(impact.total).toBe(4);
    expect(impact.affected.map((entry) => entry.id)).toEqual([SC(8), SC(11), SC(17), SC(19)]);
    expect(impact.affected[0]?.direct).toBe(true);
    expect(impact.affected[0]?.label).toBe("Scene 8");
    // Every path is drawable: real edges between real scenes.
    expect(impact.edges.length).toBeGreaterThanOrEqual(4);
  });
});

describe("the scrubber and filters", () => {
  const context = fixture();

  it("resolves chapter anchors to precise scene boundaries (§4)", () => {
    const before = resolveStoryPoint(
      { kind: "chapter", chapterId: CH(10), edge: "before" },
      context.scenes,
      context.chapters,
    );
    expect(before).toEqual({ sceneId: SC(19), position: "before" });
    const after = resolveStoryPoint(
      { kind: "chapter", chapterId: CH(2), edge: "after" },
      context.scenes,
      context.chapters,
    );
    expect(after).toEqual({ sceneId: SC(4), position: "after" });
  });

  it("filters keep defaults clean and cut the timeline down (§11, §18)", () => {
    const all = timelineView(fixture());
    const filtered = timelineView(fixture(), {
      characterIds: [MARCUS],
      range: { from: 0, to: 9 },
    });
    expect(filtered.scenes.length).toBeLessThan(all.scenes.length);
    expect(filtered.scenes.every((scene) => scene.characterIds.includes(MARCUS))).toBe(true);
    // Lanes follow the filter: Marcus only, not the whole cast (§18).
    expect(filtered.lanes.map((lane) => lane.characterId)).toEqual([MARCUS]);
  });

  it("the character arc is qualitative milestones, not a numeric chart (§9)", () => {
    const arc = characterArcView(fixture(), ELIAS);
    const kinds = new Set(arc.milestones.map((milestone) => milestone.kind));
    expect(kinds.has("status")).toBe(true);
    expect(kinds.has("knowledge")).toBe(true);
    expect(kinds.has("relationship")).toBe(true);
    const status = arc.milestones.find((milestone) => milestone.kind === "status");
    expect(status?.label).toBe("Becomes missing");
    expect(status?.sceneId).toBe(SC(13));
    // Ordered along the telling, ready to draw.
    const indexes = arc.milestones.map((milestone) => milestone.presentationIndex);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
  });
});
