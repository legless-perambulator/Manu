import type {
  Scene,
  Chapter,
  StoryEvent,
  CharacterId,
  LocationId,
  ObjectId,
  PlotThreadId,
  ChapterId,
} from "@jellytind/domain";

/**
 * Deterministic structured queries over the entity graph. Pure functions of the
 * already-loaded entity lists, so they are trivially testable and answer many
 * project questions with no LLM (MASTER_BUILD.md §40).
 */

export function scenesByCharacter(scenes: readonly Scene[], id: CharacterId): Scene[] {
  return scenes.filter((s) => s.pov === id || s.characterIds.includes(id));
}

export function scenesByPov(scenes: readonly Scene[], id: CharacterId): Scene[] {
  return scenes.filter((s) => s.pov === id);
}

export function scenesByLocation(scenes: readonly Scene[], id: LocationId): Scene[] {
  return scenes.filter((s) => s.locationId === id);
}

export function scenesByObject(scenes: readonly Scene[], id: ObjectId): Scene[] {
  return scenes.filter((s) => s.objectIds.includes(id));
}

/** Scenes linked to a plot thread — both directions of the link. */
export function scenesByPlotThread(
  scenes: readonly Scene[],
  threadId: PlotThreadId,
  threadScenes: readonly string[] = [],
): Scene[] {
  const linked = new Set<string>(threadScenes);
  return scenes.filter((s) => s.plotThreadIds.includes(threadId) || linked.has(s.id));
}

/** Scenes whose chapter's order falls within [start, end] (inclusive). */
export function scenesBetweenChapters(
  scenes: readonly Scene[],
  chapters: readonly Chapter[],
  startChapterId: ChapterId,
  endChapterId: ChapterId,
): Scene[] {
  const orderOf = new Map(chapters.map((c) => [c.id, c.order] as const));
  const startOrder = orderOf.get(startChapterId);
  const endOrder = orderOf.get(endChapterId);
  if (startOrder === undefined || endOrder === undefined) return [];
  const lo = Math.min(startOrder, endOrder);
  const hi = Math.max(startOrder, endOrder);
  return scenes.filter((s) => {
    if (s.chapterId === undefined) return false;
    const order = orderOf.get(s.chapterId);
    return order !== undefined && order >= lo && order <= hi;
  });
}

/** Where a character appears: scenes (POV or participant) and events. */
export function characterAppearances(
  scenes: readonly Scene[],
  events: readonly StoryEvent[],
  id: CharacterId,
): { scenes: Scene[]; events: StoryEvent[] } {
  return {
    scenes: scenesByCharacter(scenes, id),
    events: events.filter((e) => e.characterIds.includes(id)),
  };
}
