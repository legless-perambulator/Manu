/**
 * Locating a scene's prose inside its chapter file.
 *
 * A chapter file is the authoritative, human-readable text; scenes are
 * structured records that reference it. To edit *one scene* rather than a whole
 * chapter, the prose needs a boundary — so a chapter may mark scene starts with
 * an HTML comment:
 *
 * ```markdown
 * <!-- scene: SCENE_0001 -->
 * The hall was colder than Mara remembered.
 *
 * <!-- scene: SCENE_0002 -->
 * Elias was already waiting.
 * ```
 *
 * The marker is invisible in rendered Markdown, survives round-tripping through
 * any editor, and keeps the file portable — no sidecar index, no proprietary
 * format (docs/STORY_REPOSITORY.md).
 *
 * Markers are **optional**. Where a chapter has none, two deterministic
 * fallbacks apply, both of which are unambiguous: a chapter with exactly one
 * scene *is* that scene, and a continuation of a chapter's last scene appends at
 * the end of the file. Anything else requires a marker rather than a guess.
 */

const MARKER_PATTERN = /^[ \t]*<!--[ \t]*scene:[ \t]*(SCENE_\d+)[ \t]*-->[ \t]*$/gm;

/** The marker line that opens a scene's prose. */
export function sceneMarker(sceneId: string): string {
  return `<!-- scene: ${sceneId} -->`;
}

export interface SceneSpan {
  readonly sceneId: string;
  /** Offset of the marker line itself. */
  readonly markerStart: number;
  /** Offset where the scene's prose begins (after the marker line). */
  readonly start: number;
  /** Offset where the prose ends (at the next marker, or end of file). */
  readonly end: number;
}

/** Every marked scene in a chapter file, in document order. */
export function listSceneSpans(text: string): SceneSpan[] {
  const marks: Array<{ sceneId: string; markerStart: number; proseStart: number }> = [];
  MARKER_PATTERN.lastIndex = 0;
  for (let m = MARKER_PATTERN.exec(text); m !== null; m = MARKER_PATTERN.exec(text)) {
    const proseStart = m.index + m[0].length + (text[m.index + m[0].length] === "\n" ? 1 : 0);
    marks.push({ sceneId: m[1] as string, markerStart: m.index, proseStart });
  }
  return marks.map((mark, i) => ({
    sceneId: mark.sceneId,
    markerStart: mark.markerStart,
    start: mark.proseStart,
    end: i + 1 < marks.length ? (marks[i + 1] as { markerStart: number }).markerStart : text.length,
  }));
}

export function findSceneSpan(text: string, sceneId: string): SceneSpan | null {
  return listSceneSpans(text).find((span) => span.sceneId === sceneId) ?? null;
}

export type SpanResolution =
  | { readonly ok: true; readonly start: number; readonly end: number; readonly marked: boolean }
  | { readonly ok: false; readonly reason: string };

export interface ResolveOptions {
  /** IDs of every scene assigned to this chapter, in project order. */
  readonly chapterSceneIds: readonly string[];
  /** `append` resolves an empty span at the insertion point for a continuation. */
  readonly mode: "replace" | "append";
}

/**
 * Resolve the character range a scene-level edit should operate on, or explain
 * why it cannot be determined. Never guesses.
 */
export function resolveSceneRange(
  text: string,
  sceneId: string,
  options: ResolveOptions,
): SpanResolution {
  const span = findSceneSpan(text, sceneId);
  if (span !== null) {
    return options.mode === "append"
      ? { ok: true, start: span.end, end: span.end, marked: true }
      : { ok: true, start: span.start, end: span.end, marked: true };
  }

  const { chapterSceneIds, mode } = options;
  if (!chapterSceneIds.includes(sceneId)) {
    return { ok: false, reason: `${sceneId} is not assigned to this chapter.` };
  }

  // A chapter with a single scene: the body is unambiguously that scene.
  if (chapterSceneIds.length === 1) {
    const bodyStart = bodyOffset(text);
    return mode === "append"
      ? { ok: true, start: text.length, end: text.length, marked: false }
      : { ok: true, start: bodyStart, end: text.length, marked: false };
  }

  // Appending after the chapter's last scene is unambiguous even unmarked.
  if (mode === "append" && chapterSceneIds[chapterSceneIds.length - 1] === sceneId) {
    return { ok: true, start: text.length, end: text.length, marked: false };
  }

  return {
    ok: false,
    reason:
      `${sceneId} shares its chapter with other scenes and its prose is not marked. ` +
      `Add a "${sceneMarker(sceneId)}" line above the scene's text, or select the passage and rewrite the selection instead.`,
  };
}

/** Offset just past a file's YAML front-matter, so edits never clobber it. */
export function bodyOffset(text: string): number {
  if (!text.startsWith("---\n")) return 0;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return 0;
  let at = end + 4;
  while (text[at] === "\n") at += 1;
  return at;
}
