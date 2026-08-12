import {
  orderScenes,
  type Chapter,
  type Character,
  type Decision,
  type Dependency,
  type Fact,
  type Location,
  type PlotThread,
  type Relationship,
  type Scene,
  type StoryTest,
  type Setup,
  type StoryObject,
  type WorldRule,
} from "@jellytind/domain";
import {
  StoryChronology,
  StoryTimeline,
  timelineNodes,
  type StateTransition,
  type TransitionKind,
} from "@jellytind/story-state";
import type { BuildContext, DanglingReference } from "./types";

/**
 * A deliberately broken novel.
 *
 * Every fixture here is built to fail in known ways, because the only useful
 * test of a compiler is a project whose diagnostics you can name in advance.
 * Exported from the package so the tests and any future worked example share
 * one story rather than drifting apart.
 */

export const ELIAS = "CHAR_0001";
export const MARA = "CHAR_0002";
export const WREN = "CHAR_0003";
export const MANOR = "LOC_0001";
export const FLAT = "LOC_0002";
export const VAULT = "LOC_0003";
export const REVOLVER = "OBJECT_0001";
export const KEY = "OBJECT_0002";
export const PHOTO_THREAD = "THREAD_0001";
export const VAULT_THREAD = "THREAD_0002";
export const VAULT_FACT = "FACT_0001";
export const SETUP_KEY = "SETUP_0001";
export const RULE_NO_RESURRECTION = "RULE_0001";

const chapter = (id: string, order: number, title: string): Chapter =>
  ({ id, title, order, filePath: `manuscript/${id}.md`, status: "drafted" }) as unknown as Chapter;

const character = (id: string, name: string): Character =>
  ({
    id,
    name,
    aliases: [],
    description: "",
    role: "",
    notes: "",
    status: "active",
    filePath: `characters/${id}.md`,
  }) as unknown as Character;

const place = (id: string, name: string, parentLocationId?: string): Location =>
  ({
    id,
    name,
    aliases: [],
    description: "",
    notes: "",
    filePath: `world/locations/${id}.md`,
    ...(parentLocationId !== undefined ? { parentLocationId } : {}),
  }) as unknown as Location;

const object = (id: string, name: string): StoryObject =>
  ({
    id,
    name,
    aliases: [],
    description: "",
    status: "exists",
    filePath: `world/objects/${id}.md`,
  }) as unknown as StoryObject;

export function scene(id: string, chapterId: string, fields: Record<string, unknown> = {}): Scene {
  return {
    id,
    title: id,
    chapterId,
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
export function transition(
  sceneId: string,
  kind: TransitionKind,
  subjectId: string,
  value: string,
  extra: Partial<StateTransition> = {},
): StateTransition {
  return {
    id: `TRANS_${String(++seq).padStart(4, "0")}`,
    sceneId,
    kind,
    subjectId,
    value,
    source: "author",
    confirmationStatus: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  };
}

export interface FixtureOverrides {
  readonly scenes?: readonly Scene[];
  readonly transitions?: readonly StateTransition[];
  readonly setups?: readonly Setup[];
  readonly threads?: readonly PlotThread[];
  readonly worldRules?: readonly WorldRule[];
  readonly relationships?: readonly Relationship[];
  readonly storyTests?: readonly StoryTest[];
  readonly dependencies?: readonly Dependency[];
  readonly decisions?: readonly Decision[];
  readonly danglingReferences?: readonly DanglingReference[];
}

/**
 * Build a context from parts.
 *
 * Everything a rule reads is assembled here exactly as the repository assembles
 * it, so a rule tested against a fixture is the same rule that runs against a
 * real project.
 */
export function buildContext(overrides: FixtureOverrides = {}): Omit<BuildContext, "config"> {
  seq = 0;
  const chapters = [
    chapter("CHAPTER_0001", 0, "Openings"),
    chapter("CHAPTER_0002", 1, "The Middle"),
    chapter("CHAPTER_0003", 2, "The Cellar"),
  ];

  const scenes =
    overrides.scenes ??
    ([
      scene("SCENE_0001", "CHAPTER_0001"),
      scene("SCENE_0002", "CHAPTER_0001"),
      scene("SCENE_0003", "CHAPTER_0002"),
      scene("SCENE_0004", "CHAPTER_0003"),
    ] as Scene[]);

  const characters = [character(ELIAS, "Elias"), character(MARA, "Mara"), character(WREN, "Wren")];
  const locations = [
    place(MANOR, "Blackthorn Manor"),
    place(FLAT, "Elias's Flat"),
    place(VAULT, "Hidden Vault", MANOR),
  ];
  const objects = [object(REVOLVER, "Revolver"), object(KEY, "Brass Key")];

  const threads =
    overrides.threads ??
    ([
      {
        id: PHOTO_THREAD,
        name: "The missing photograph",
        description: "",
        status: "planned",
        relatedSceneIds: [],
      },
      {
        id: VAULT_THREAD,
        name: "The sealed vault",
        description: "",
        status: "planned",
        relatedSceneIds: [],
      },
    ] as unknown as PlotThread[]);

  const facts = [
    {
      id: VAULT_FACT,
      statement: "A vault lies beneath the manor.",
      status: "canonical",
      objectiveTruth: true,
    },
  ] as unknown as Fact[];

  const transitions = overrides.transitions ?? [];
  const ordered = orderScenes(scenes, chapters).map((s) => s.id as string);
  const timeline = new StoryTimeline(ordered, transitions);

  return {
    scenes,
    chapters,
    characters,
    locations,
    objects,
    threads,
    dependencies: overrides.dependencies ?? [],
    decisions: overrides.decisions ?? [],
    facts,
    worldRules: overrides.worldRules ?? [],
    events: [],
    setups: overrides.setups ?? [],
    relationships: overrides.relationships ?? [],
    storyTests: overrides.storyTests ?? [],
    transitions,
    temporalLinks: [],
    travelRules: [],
    timeline,
    chronology: new StoryChronology(timelineNodes({ scenes, chapters, events: [] })),
    metrics: {
      chapterBySceneId: new Map(scenes.map((s) => [s.id as string, (s.chapterId ?? "") as string])),
      wordsBySceneId: new Map(scenes.map((s) => [s.id as string, 1000])),
    },
    danglingReferences: overrides.danglingReferences ?? [],
  };
}
