import { orderScenes, type Chapter, type Scene } from "@jellytind/domain";
import type { StoryMapFilters, StoryPoint, StoryPointStop } from "./types";

/**
 * Story Points (§4): the scrubber's vocabulary.
 *
 * A point is a scene boundary. The scrubber's stops are the scenes in
 * presentation order; "before chapter 10" and "Act II midpoint" both resolve
 * to one of them, so every reconstruction query in story-state answers at
 * exactly the moment the writer picked.
 */

/** The scrubber's stops: every scene in presentation order, labelled. */
export function storyPointStops(
  scenes: readonly Scene[],
  chapters: readonly Chapter[],
): StoryPointStop[] {
  const titles = new Map(chapters.map((chapter) => [chapter.id as string, chapter.title]));
  return orderScenes(scenes, chapters).map((scene, index) => ({
    sceneId: scene.id as string,
    sceneTitle: scene.title,
    ...(scene.chapterId !== undefined ? { chapterId: scene.chapterId as string } : {}),
    ...(scene.chapterId !== undefined && titles.get(scene.chapterId as string) !== undefined
      ? { chapterTitle: titles.get(scene.chapterId as string) as string }
      : {}),
    index,
  }));
}

/** Where a writer's anchor lands, as a precise scene boundary. */
export function resolveStoryPoint(
  anchor:
    | { readonly kind: "scene"; readonly sceneId: string; readonly edge: "before" | "after" }
    | { readonly kind: "chapter"; readonly chapterId: string; readonly edge: "before" | "after" }
    | { readonly kind: "end" },
  scenes: readonly Scene[],
  chapters: readonly Chapter[],
): StoryPoint | null {
  const ordered = orderScenes(scenes, chapters);
  if (ordered.length === 0) return null;
  switch (anchor.kind) {
    case "end": {
      const last = ordered.at(-1);
      return last === undefined ? null : { sceneId: last.id as string, position: "after" };
    }
    case "scene":
      return ordered.some((scene) => scene.id === anchor.sceneId)
        ? { sceneId: anchor.sceneId, position: anchor.edge }
        : null;
    case "chapter": {
      // "Before chapter 10" means before it begins; "after" means after its
      // last scene — the same resolution Story Tests use.
      const inChapter = ordered.filter((scene) => scene.chapterId === anchor.chapterId);
      const pick = anchor.edge === "before" ? inChapter[0] : inChapter.at(-1);
      return pick === undefined ? null : { sceneId: pick.id as string, position: anchor.edge };
    }
  }
}

/** A point as a sentence: "after 'The Vault' (Chapter Four)". */
export function describeStoryPoint(point: StoryPoint, stops: readonly StoryPointStop[]): string {
  const stop = stops.find((held) => held.sceneId === point.sceneId);
  if (stop === undefined) return `${point.position} ${point.sceneId}`;
  const chapter = stop.chapterTitle !== undefined ? ` (${stop.chapterTitle})` : "";
  return `${point.position} “${stop.sceneTitle}”${chapter}`;
}

/** Whether a stop is at or before the point — what "so far" means. */
export function isReachedAt(
  stopIndex: number,
  point: StoryPoint,
  stops: readonly StoryPointStop[],
): boolean {
  const at = stops.find((held) => held.sceneId === point.sceneId);
  if (at === undefined) return true;
  return point.position === "after" ? stopIndex <= at.index : stopIndex < at.index;
}

/** The scenes a filter keeps, in presentation order (§11, §18). */
export function filteredScenes(
  scenes: readonly Scene[],
  chapters: readonly Chapter[],
  filters: StoryMapFilters = {},
): Scene[] {
  return orderScenes(scenes, chapters).filter((scene, index) => {
    if (filters.range !== undefined && (index < filters.range.from || index > filters.range.to)) {
      return false;
    }
    if (
      filters.chapterIds !== undefined &&
      !filters.chapterIds.includes((scene.chapterId ?? "") as string)
    ) {
      return false;
    }
    if (
      filters.characterIds !== undefined &&
      !filters.characterIds.some((id) => (scene.characterIds as readonly string[]).includes(id))
    ) {
      return false;
    }
    if (
      filters.locationIds !== undefined &&
      !filters.locationIds.includes((scene.locationId ?? "") as string)
    ) {
      return false;
    }
    if (
      filters.threadIds !== undefined &&
      !filters.threadIds.some((id) =>
        ((scene.plotThreadIds ?? []) as readonly string[]).includes(id),
      )
    ) {
      return false;
    }
    return true;
  });
}
