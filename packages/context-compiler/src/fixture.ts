import type {
  Chapter,
  Character,
  Fact,
  Location,
  PlotThread,
  Project,
  Relationship,
  Scene,
  StoryEvent,
  TemporalLink,
  WorldRule,
} from "@jellytind/domain";
import type { SearchHit, SearchQuery } from "@jellytind/search";
import type { StateTransition } from "@jellytind/story-state";
import type { ProjectReader } from "./reader";

/**
 * A fixed, hand-built project for testing context selection.
 *
 * Exported from the package (not the test file) so the desktop app can render a
 * worked example in the context inspector without needing a real project open —
 * and so the documented example in docs/CONTEXT_COMPILER.md is backed by data
 * that actually compiles.
 *
 * Two chapters, four scenes, three characters, four locations (two of them
 * nested, so containment is exercised), one tracked object, three plot threads
 * (one resolved, so "active threads" filtering is exercised) and two world rules
 * of differing severity.
 */

/** Loose fields, cast once at the boundary — fixtures use plain ID strings. */
const scene = (
  id: string,
  title: string,
  chapterId: string,
  fields: Record<string, unknown> = {},
): Scene =>
  ({
    id,
    title,
    chapterId,
    characterIds: [],
    plotThreadIds: [],
    objectIds: [],
    factIds: [],
    purpose: [],
    status: "drafted",
    ...fields,
  }) as unknown as Scene;

export const FIXTURE_CHAPTERS = [
  {
    id: "CHAPTER_0001",
    title: "Openings",
    order: 0,
    filePath: "manuscript/CHAPTER_0001.md",
    status: "drafted",
  },
  {
    id: "CHAPTER_0002",
    title: "The Rift",
    order: 1,
    filePath: "manuscript/CHAPTER_0002.md",
    status: "drafting",
  },
] as unknown as Chapter[];

/**
 * Story times make the fixture nonlinear on purpose: SCENE_0003 is presented
 * third and happens first, two years before the rest. Anything that treats
 * chapter order as chronology gets this project wrong (docs/TIMELINE.md).
 */
export const FIXTURE_SCENES: Scene[] = [
  scene("SCENE_0001", "Arrival", "CHAPTER_0001", {
    pov: "CHAR_0001",
    locationId: "LOC_0001",
    characterIds: ["CHAR_0001"],
    plotThreadIds: ["THREAD_0001"],
    purpose: ["establish the manor"],
    storyTime: { kind: "exact", instant: "2019-03-04T09:00:00Z" },
    duration: { hours: 2 },
  }),
  scene("SCENE_0002", "The Argument", "CHAPTER_0001", {
    pov: "CHAR_0001",
    locationId: "LOC_0001",
    characterIds: ["CHAR_0001", "CHAR_0002"],
    plotThreadIds: ["THREAD_0001", "THREAD_0002"],
    purpose: ["Mara refuses Elias's help"],
    objectIds: ["OBJECT_0001"],
    storyTime: { kind: "exact", instant: "2019-03-04T18:00:00Z" },
  }),
  scene("SCENE_0003", "Aftermath", "CHAPTER_0001", {
    pov: "CHAR_0002",
    locationId: "LOC_0002",
    characterIds: ["CHAR_0002", "CHAR_0003"],
    plotThreadIds: ["THREAD_0003"],
    storyTime: { kind: "exact", instant: "2017-06-01T12:00:00Z" },
  }),
  scene("SCENE_0004", "The Vault", "CHAPTER_0002", {
    pov: "CHAR_0001",
    characterIds: ["CHAR_0001"],
    plotThreadIds: ["THREAD_0002"],
    storyTime: { kind: "exact", instant: "2019-03-05T09:00:00Z" },
  }),
];

/** One event before the manuscript opens, one off-page between scenes. */
export const FIXTURE_EVENTS = [
  {
    id: "EVENT_0001",
    name: "The fire at the manor",
    description: "The east wing burned.",
    storyTime: { kind: "exact", instant: "1997-08-14T22:00:00Z" },
    locationId: "LOC_0001",
    characterIds: ["CHAR_0002"],
    plotThreadIds: ["THREAD_0001"],
  },
  {
    id: "EVENT_0002",
    name: "The letter arrives",
    description: "Delivered while no one is watching.",
    storyTime: { kind: "exact", instant: "2019-03-04T21:00:00Z" },
    characterIds: ["CHAR_0002"],
  },
] as unknown as StoryEvent[];

export const FIXTURE_TEMPORAL_LINKS: TemporalLink[] = [
  {
    id: "TLINK_0001",
    fromId: "EVENT_0002",
    toId: "SCENE_0004",
    relation: "before",
    note: "The letter is waiting when they reach the vault.",
    source: "author",
    confirmationStatus: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export const FIXTURE_CHARACTERS = [
  {
    id: "CHAR_0001",
    name: "Mara",
    aliases: ["The Watcher"],
    description: "A quiet observer.",
    role: "protagonist",
    notes: "Speaks in short, clipped sentences.",
    status: "active",
    filePath: "characters/CHAR_0001.md",
  },
  {
    id: "CHAR_0002",
    name: "Elias",
    aliases: [],
    description: "A restless archivist.",
    role: "foil",
    notes: "Over-explains when nervous.",
    status: "active",
    filePath: "characters/CHAR_0002.md",
  },
  {
    id: "CHAR_0003",
    name: "Wren",
    aliases: [],
    description: "The groundskeeper.",
    role: "minor",
    notes: "",
    status: "active",
    filePath: "characters/CHAR_0003.md",
  },
] as unknown as Character[];

export const FIXTURE_LOCATIONS = [
  {
    id: "LOC_0001",
    name: "Blackthorn Manor",
    aliases: [],
    description: "A cold house above a sealed vault.",
    notes: "",
    filePath: "world/locations/LOC_0001.md",
  },
  {
    id: "LOC_0002",
    name: "The Orchard",
    aliases: [],
    description: "Overgrown, east of the manor.",
    notes: "",
    filePath: "world/locations/LOC_0002.md",
  },
  // Nested, so containment is exercised: the vault is inside the manor.
  {
    id: "LOC_0003",
    name: "West Wing",
    aliases: [],
    description: "Shut up since the fire.",
    notes: "",
    parentLocationId: "LOC_0001",
    filePath: "world/locations/LOC_0003.md",
  },
  {
    id: "LOC_0004",
    name: "Hidden Vault",
    aliases: [],
    description: "Beneath the library floor.",
    notes: "",
    parentLocationId: "LOC_0003",
    filePath: "world/locations/LOC_0004.md",
  },
] as unknown as Location[];

export const FIXTURE_THREADS = [
  {
    id: "THREAD_0001",
    name: "The missing photograph",
    description: "Someone removed a photograph from the hall.",
    status: "active",
    introducedSceneId: "SCENE_0001",
    relatedSceneIds: ["SCENE_0002"],
  },
  {
    id: "THREAD_0002",
    name: "The sealed vault",
    description: "What is beneath the manor.",
    status: "escalating",
    relatedSceneIds: ["SCENE_0002", "SCENE_0004"],
  },
  {
    id: "THREAD_0003",
    name: "Wren's debt",
    description: "Settled early.",
    status: "resolved",
    resolvedSceneId: "SCENE_0003",
    relatedSceneIds: ["SCENE_0003"],
  },
] as unknown as PlotThread[];

export const FIXTURE_WORLD_RULES = [
  {
    id: "RULE_0001",
    name: "No resurrection",
    description: "The dead stay dead.",
    severity: "hard",
    scope: "global",
  },
  {
    id: "RULE_0002",
    name: "Prefer restraint",
    description: "Emotion is shown through action.",
    severity: "style",
    scope: "prose",
  },
] as unknown as WorldRule[];

export const FIXTURE_RELATIONSHIPS = [
  {
    id: "REL_0001",
    characterAId: "CHAR_0001",
    characterBId: "CHAR_0002",
    type: "rival",
    status: "wary",
    description: "Wary allies.",
  },
] as unknown as Relationship[];

export const FIXTURE_FACTS = [
  {
    id: "FACT_0001",
    statement: "A vault lies beneath the manor.",
    status: "canonical",
    objectiveTruth: true,
  },
] as unknown as Fact[];

/** A small timeline: Mara is at the manor and learns of the vault in SCENE_0001. */
export const FIXTURE_TRANSITIONS: StateTransition[] = [
  {
    id: "TRANS_0001",
    sceneId: "SCENE_0001",
    kind: "character_location",
    subjectId: "CHAR_0001",
    value: "LOC_0001",
    source: "author",
    confirmationStatus: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "TRANS_0002",
    sceneId: "SCENE_0001",
    kind: "fact_established",
    subjectId: "FACT_0001",
    value: "FACT_0001",
    source: "author",
    confirmationStatus: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "TRANS_0003",
    sceneId: "SCENE_0001",
    kind: "knowledge_changed",
    subjectId: "CHAR_0001",
    value: "FACT_0001",
    certainty: 1,
    knowledgeState: "known",
    sourceType: "witnessed",
    source: "author",
    confirmationStatus: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  // The relationship sours only in SCENE_0003 — later than SCENE_0002, so a
  // recipe targeting SCENE_0002 must not see it.
  // The brass key: put down in the west wing, then carried by Mara.
  {
    id: "TRANS_0006",
    sceneId: "SCENE_0001",
    kind: "object_location",
    subjectId: "OBJECT_0001",
    value: "LOC_0003",
    note: "left in the west wing",
    source: "author",
    confirmationStatus: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "TRANS_0007",
    sceneId: "SCENE_0002",
    kind: "object_holder",
    subjectId: "OBJECT_0001",
    value: "CHAR_0001",
    note: "Mara takes the key",
    source: "author",
    confirmationStatus: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "TRANS_0008",
    sceneId: "SCENE_0002",
    kind: "object_condition",
    subjectId: "OBJECT_0001",
    value: "bent",
    source: "author",
    confirmationStatus: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "TRANS_0004",
    sceneId: "SCENE_0002",
    kind: "relationship_dimension",
    subjectId: "REL_0001",
    value: "",
    dimension: "trust",
    level: "moderate",
    magnitude: 0.5,
    source: "author",
    confirmationStatus: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "TRANS_0005",
    sceneId: "SCENE_0003",
    kind: "relationship_status",
    subjectId: "REL_0001",
    value: "hostile",
    source: "author",
    confirmationStatus: "confirmed",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

export const FIXTURE_FILES: Readonly<Record<string, string>> = {
  "manuscript/CHAPTER_0001.md":
    "---\nid: CHAPTER_0001\ntitle: Openings\n---\n\nThe hall was colder than Mara remembered.\nElias was already waiting.\n",
  "manuscript/CHAPTER_0002.md":
    "---\nid: CHAPTER_0002\ntitle: The Rift\n---\n\nThe vault door had no handle.\n",
  "style/voice.md": "Prefer concrete nouns. Avoid adverbs in dialogue tags.\n",
  "style/pacing.md": "Scenes end on a turn, not a summary.\n",
  "style/examples/CHAR_0001-dialogue.md": '"No," Mara said. "Not tonight."\n',
  "style/examples/elias-monologue.md": "Elias talked until the silence gave way.\n",
  "notes/ideas.md": "Unused note that no recipe should pull in.\n",
};

/** A {@link ProjectReader} over the fixture. Deterministic and offline. */
export function fixtureReader(overrides: Partial<ProjectReader> = {}): ProjectReader {
  const base: ProjectReader = {
    project: {
      id: "PROJ_fixture",
      title: "Blackthorn",
      rootPath: "/fixture",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
    } as unknown as Project,
    listChapters: () => Promise.resolve([...FIXTURE_CHAPTERS]),
    listScenes: () => Promise.resolve([...FIXTURE_SCENES]),
    listCharacters: () => Promise.resolve([...FIXTURE_CHARACTERS]),
    listLocations: () => Promise.resolve([...FIXTURE_LOCATIONS]),
    listPlotThreads: () => Promise.resolve([...FIXTURE_THREADS]),
    listWorldRules: () => Promise.resolve([...FIXTURE_WORLD_RULES]),
    listFacts: () => Promise.resolve([...FIXTURE_FACTS]),
    listStateTransitions: () => Promise.resolve([...FIXTURE_TRANSITIONS]),
    listRelationships: () => Promise.resolve([...FIXTURE_RELATIONSHIPS]),
    listEvents: () => Promise.resolve([...FIXTURE_EVENTS]),
    listTemporalLinks: () => Promise.resolve([...FIXTURE_TEMPORAL_LINKS]),
    listProjectFiles: (prefix) =>
      Promise.resolve(
        Object.keys(FIXTURE_FILES)
          .filter((path) => prefix === undefined || path.startsWith(prefix))
          .sort(),
      ),
    readProjectFile: (path) => Promise.resolve(FIXTURE_FILES[path] ?? null),
    searchText: (_query: SearchQuery) => Promise.resolve([] as SearchHit[]),
  };
  return { ...base, ...overrides };
}
