import { orderScenes } from "@jellytind/domain";
import { resolveScope, type Diagnostic } from "@jellytind/story-compiler";
import { labelOf } from "./views";
import type { StoryMapContext } from "./types";

/**
 * Overlays (§12, §15–§16): optional layers over the views. Off by default —
 * a map flooded with diagnostics is a map nobody reads — and each maps back
 * to the same stable IDs the views draw, so a marker lands on the element it
 * is about.
 */

export interface DiagnosticOverlay {
  /** Diagnostics per scene the views can mark. */
  readonly byScene: Readonly<Record<string, readonly Diagnostic[]>>;
  /** Diagnostics per entity (characters, threads, facts…). */
  readonly byEntity: Readonly<Record<string, readonly Diagnostic[]>>;
  readonly total: number;
}

/** Compiler diagnostics, indexed to map elements (§15). */
export function diagnosticOverlay(diagnostics: readonly Diagnostic[]): DiagnosticOverlay {
  const byScene: Record<string, Diagnostic[]> = {};
  const byEntity: Record<string, Diagnostic[]> = {};
  for (const diagnostic of diagnostics) {
    if (diagnostic.sceneId !== undefined) {
      (byScene[diagnostic.sceneId] ??= []).push(diagnostic);
    }
    for (const entityId of diagnostic.entities) {
      (byEntity[entityId] ??= []).push(diagnostic);
    }
  }
  return { byScene, byEntity, total: diagnostics.length };
}

export interface TestOverlayEntry {
  readonly testId: string;
  readonly name: string;
  readonly statement: string;
  /** The scenes the test's scope covers — the span it draws across. */
  readonly scopeSceneIds: readonly string[];
  /** Scenes where the latest run found it failing — the X marks (§16). */
  readonly failSceneIds: readonly string[];
}

/**
 * Where Story Tests apply and where they fail (§16). Failure scenes come from
 * the latest build's results, passed in by the caller; with none, the overlay
 * still shows each test's span.
 */
export function storyTestOverlay(
  context: StoryMapContext,
  failures: ReadonlyArray<{ readonly testId: string; readonly sceneIds: readonly string[] }> = [],
): TestOverlayEntry[] {
  const failed = new Map(failures.map((entry) => [entry.testId, entry.sceneIds]));
  return context.storyTests
    .filter((test) => test.enabled)
    .map((test) => {
      let scopeSceneIds: string[] = [];
      try {
        scopeSceneIds = resolveScope(test.scope, {
          scenes: context.scenes,
          chapters: context.chapters,
        });
      } catch {
        scopeSceneIds = [];
      }
      return {
        testId: test.id as string,
        name: test.name,
        statement: test.description !== "" ? test.description : test.name,
        scopeSceneIds,
        failSceneIds: [...(failed.get(test.id as string) ?? [])],
      };
    });
}

export interface SearchStripEntry {
  readonly sceneId: string;
  readonly title: string;
  readonly chapterTitle?: string;
  readonly presentationIndex: number;
}

/**
 * Search → map (§12): a set of scenes — typically project-search results —
 * arranged chronologically along the telling, ready to draw as one strip.
 */
export function searchStrip(
  context: StoryMapContext,
  sceneIds: readonly string[],
): SearchStripEntry[] {
  const wanted = new Set(sceneIds);
  const titles = new Map(context.chapters.map((chapter) => [chapter.id as string, chapter.title]));
  return orderScenes(context.scenes, context.chapters)
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => wanted.has(scene.id as string))
    .map(({ scene, index }) => ({
      sceneId: scene.id as string,
      title: scene.title,
      ...(scene.chapterId !== undefined && titles.get(scene.chapterId as string) !== undefined
        ? { chapterTitle: titles.get(scene.chapterId as string) as string }
        : {}),
      presentationIndex: index,
    }));
}

/** A short label for anything an overlay names, sharing the views' lookup. */
export { labelOf };
