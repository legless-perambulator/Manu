import { orderScenes, type Chapter, type Scene } from "@jellytind/domain";
import { StoryTimeline } from "@jellytind/story-state";
import type { DebugReader } from "./reader";

/**
 * The project material every tracer needs, gathered once.
 *
 * A debug run touches most of the project, so the tracers share one snapshot
 * rather than each re-reading it: the same run must give the same answer, and
 * four independent reads of a moving project would not guarantee that.
 */
export interface ProjectSnapshot {
  readonly scenes: readonly Scene[];
  readonly chapters: readonly Chapter[];
  /** Scenes in story order — the axis every "before"/"after" is measured on. */
  readonly ordered: readonly Scene[];
  readonly timeline: StoryTimeline;
  readonly reader: DebugReader;
  /** Display name for any entity ID, falling back to the ID itself. */
  label(id: string): string;
  positionOf(sceneId: string): number;
  sceneById(id: string): Scene | undefined;
  chapterById(id: string): Chapter | undefined;
  chapterOf(sceneId: string): Chapter | undefined;
}

export async function snapshot(reader: DebugReader): Promise<ProjectSnapshot> {
  const [scenes, chapters, characters, locations, objects, threads, facts, transitions] =
    await Promise.all([
      reader.listScenes(),
      reader.listChapters(),
      reader.listCharacters(),
      reader.listLocations(),
      reader.listObjects(),
      reader.listPlotThreads(),
      reader.listFacts(),
      reader.listStateTransitions(),
    ]);

  const ordered = orderScenes(scenes, chapters);
  const timeline = new StoryTimeline(
    ordered.map((s) => s.id as string),
    transitions,
  );

  const names = new Map<string, string>();
  for (const scene of scenes) names.set(scene.id as string, scene.title);
  for (const chapter of chapters) names.set(chapter.id as string, chapter.title);
  for (const character of characters) names.set(character.id as string, character.name);
  for (const location of locations) names.set(location.id as string, location.name);
  for (const object of objects) names.set(object.id as string, object.name);
  for (const thread of threads) names.set(thread.id as string, thread.name);
  for (const fact of facts) names.set(fact.id as string, fact.statement);

  const sceneIndex = new Map(ordered.map((s, i) => [s.id as string, i]));
  const sceneMap = new Map(scenes.map((s) => [s.id as string, s]));
  const chapterMap = new Map(chapters.map((c) => [c.id as string, c]));

  return {
    scenes,
    chapters,
    ordered,
    timeline,
    reader,
    label: (id) => names.get(id) ?? id,
    positionOf: (sceneId) => sceneIndex.get(sceneId) ?? -1,
    sceneById: (id) => sceneMap.get(id),
    chapterById: (id) => chapterMap.get(id),
    chapterOf: (sceneId) => {
      const chapterId = sceneMap.get(sceneId)?.chapterId;
      return chapterId === undefined ? undefined : chapterMap.get(chapterId as string);
    },
  };
}

/** Words in a run of text, counted the same way the manuscript metrics count. */
export function countWords(text: string): number {
  const stripped = text
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  return stripped === "" ? 0 : stripped.split(/\s+/).length;
}

const EXCERPT_WORDS = 180;

/**
 * An opening excerpt of a scene's prose, with the omission stated.
 *
 * The debugger hands prose to a model only when the mode needs it, and never
 * silently truncates: a model told it has a whole scene when it has a third of
 * one will reason confidently about material it cannot see.
 */
export function excerpt(text: string, words = EXCERPT_WORDS): string {
  const body = text
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/<!--\s*scene:[^>]*-->/g, "")
    .trim();
  const parts = body.split(/\s+/);
  if (parts.length <= words) return body;
  return `${parts.slice(0, words).join(" ")}\n[… ${String(parts.length - words)} further words not shown]`;
}

/** The scenes immediately before one, in story order, nearest last. */
export function precedingScenes(
  project: ProjectSnapshot,
  sceneId: string,
  count: number,
): readonly Scene[] {
  const at = project.positionOf(sceneId);
  if (at < 0) return [];
  return project.ordered.slice(Math.max(0, at - count), at);
}
