import type { DebugScope, EvidenceItem, EvidenceSystem, Measurement, ProseExcerpt } from "./types";

/**
 * Collects what a trace found.
 *
 * Evidence IDs are assigned in the order the trace retrieves things, which
 * makes them stable for a given project and request — the same debug run twice
 * cites the same `E7`. A diagnosis is required to cite these IDs, so they have
 * to mean something.
 */
export class EvidenceCollector {
  private readonly items: EvidenceItem[] = [];
  private readonly measures: Measurement[] = [];
  private readonly prose: ProseExcerpt[] = [];
  private readonly systemsUsed = new Set<EvidenceSystem>();
  private readonly scenes = new Set<string>();
  private readonly chapters = new Set<string>();
  private readonly entityIds = new Set<string>();
  private readonly gaps: string[] = [];

  /** Record one retrieved thing. Returns its evidence ID. */
  add(input: {
    system: EvidenceSystem;
    statement: string;
    detail?: string;
    sceneId?: string;
    chapterId?: string;
    entities?: readonly string[];
  }): string {
    const id = `E${String(this.items.length + 1)}`;
    const entities = [...new Set(input.entities ?? [])];
    this.items.push({
      id,
      system: input.system,
      statement: input.statement,
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
      ...(input.sceneId !== undefined ? { sceneId: input.sceneId } : {}),
      ...(input.chapterId !== undefined ? { chapterId: input.chapterId } : {}),
      entities,
    });
    this.systemsUsed.add(input.system);
    if (input.sceneId !== undefined) this.scenes.add(input.sceneId);
    if (input.chapterId !== undefined) this.chapters.add(input.chapterId);
    for (const entity of entities) this.entityIds.add(entity);
    return id;
  }

  measure(measurement: Measurement): void {
    this.measures.push(measurement);
    for (const entity of measurement.entities) this.entityIds.add(entity);
  }

  excerpt(excerpt: ProseExcerpt): void {
    this.prose.push(excerpt);
    this.systemsUsed.add("prose");
    if (excerpt.sceneId !== undefined) this.scenes.add(excerpt.sceneId);
    if (excerpt.chapterId !== undefined) this.chapters.add(excerpt.chapterId);
  }

  /** Something a reader might assume was checked and was not, and why. */
  didNotInspect(reason: string): void {
    if (!this.gaps.includes(reason)) this.gaps.push(reason);
  }

  /** Bring a scene or entity into scope without asserting anything about it. */
  note(ids: readonly string[]): void {
    for (const id of ids) {
      if (id.startsWith("SCENE_")) this.scenes.add(id);
      else if (id.startsWith("CHAPTER_")) this.chapters.add(id);
      else this.entityIds.add(id);
    }
  }

  get evidence(): readonly EvidenceItem[] {
    return this.items;
  }

  get measurements(): readonly Measurement[] {
    return this.measures;
  }

  get excerpts(): readonly ProseExcerpt[] {
    return this.prose;
  }

  scope(summary: string): DebugScope {
    return {
      summary,
      sceneIds: [...this.scenes],
      chapterIds: [...this.chapters],
      entityIds: [...this.entityIds],
      systems: [...this.systemsUsed],
      notInspected: [...this.gaps],
    };
  }
}

/** Every entity a finished trace touches, deduplicated and ordered. */
export function tracedEntities(
  evidence: readonly EvidenceItem[],
  scope: DebugScope,
): readonly string[] {
  const seen = new Set<string>(scope.entityIds);
  for (const item of evidence) for (const id of item.entities) seen.add(id);
  return [...seen].sort();
}
