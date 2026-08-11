import type { Chapter, Scene } from "./entities";

/**
 * Deterministic story order.
 *
 * Domain knowledge, not a concern of any one consumer: the Context Compiler,
 * the story-state timeline and the Story Compiler must all agree on what
 * "the scene before this one" means, so the answer lives here.
 *
 * Scenes carry no explicit ordinal, so "previous" and "next" have to be derived.
 * The narrative order is: chapters by `order` (ties broken by ID), then scenes
 * in the order the project stores them within each chapter, then any unassigned
 * scenes last. Deriving it in one place means every recipe agrees on adjacency,
 * and the result is reproducible for a given project state.
 */

export function orderChapters(chapters: readonly Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Every scene in narrative order. */
export function orderScenes(scenes: readonly Scene[], chapters: readonly Chapter[]): Scene[] {
  const rank = new Map(orderChapters(chapters).map((chapter, i) => [chapter.id as string, i]));
  const unassigned = rank.size;
  return [...scenes]
    .map((scene, index) => ({ scene, index }))
    .sort((a, b) => {
      const ra = rank.get(a.scene.chapterId ?? "") ?? unassigned;
      const rb = rank.get(b.scene.chapterId ?? "") ?? unassigned;
      return ra - rb || a.index - b.index;
    })
    .map(({ scene }) => scene);
}

export interface Neighbours<T> {
  readonly previous?: T;
  readonly next?: T;
}

function neighboursOf<T extends { id: string }>(ordered: readonly T[], id: string): Neighbours<T> {
  const at = ordered.findIndex((item) => item.id === id);
  if (at === -1) return {};
  return {
    ...(at > 0 ? { previous: ordered[at - 1] as T } : {}),
    ...(at < ordered.length - 1 ? { next: ordered[at + 1] as T } : {}),
  };
}

/** The scenes immediately before and after `sceneId` in narrative order. */
export function adjacentScenes(
  scenes: readonly Scene[],
  chapters: readonly Chapter[],
  sceneId: string,
): Neighbours<Scene> {
  return neighboursOf(orderScenes(scenes, chapters), sceneId);
}

/** The chapters immediately before and after `chapterId`. */
export function adjacentChapters(
  chapters: readonly Chapter[],
  chapterId: string,
): Neighbours<Chapter> {
  return neighboursOf(orderChapters(chapters), chapterId);
}

/** The scenes assigned to a chapter, in project order. */
export function scenesOfChapter(scenes: readonly Scene[], chapterId: string): Scene[] {
  return scenes.filter((scene) => scene.chapterId === chapterId);
}
