import type { MappingConfidence, MappingSourceChapter } from "./types";

/**
 * The model's door into mapping.
 *
 * Semantic steps hand the analyst one bounded excerpt at a time — never the
 * whole manuscript (§43) — plus a briefing describing what to look for. The
 * desktop implements this port over the model router; tests implement it as a
 * mock. No analyst configured means semantic steps are skipped with a stated
 * reason, never silently.
 */

export type SemanticMappingKind =
  | "facts"
  | "timeline"
  | "knowledge"
  | "relationships"
  | "threads"
  | "setup_payoff"
  | "causality"
  | "voice"
  | "character_voice"
  | "summaries";

/** The hard ceiling on what one analyst call may be shown. */
export const MAX_EXCERPT_CHARS = 24_000;

export interface MappingExcerpt {
  readonly chapterIndex: number;
  readonly chapterTitle: string;
  readonly text: string;
  /** Which slice of the chapter this is, when a chapter needed splitting. */
  readonly part: number;
  readonly parts: number;
}

export interface SemanticMappingFinding {
  readonly summary: string;
  readonly confidence: MappingConfidence;
  readonly quote?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface MappingAnalyst {
  analyse(
    kind: SemanticMappingKind,
    excerpt: MappingExcerpt,
    briefing: string,
  ): Promise<readonly SemanticMappingFinding[]>;
}

/** Split a chapter into excerpts the analyst may see, at paragraph edges. */
export function excerptsOf(
  chapter: MappingSourceChapter,
  maxChars: number = MAX_EXCERPT_CHARS,
): MappingExcerpt[] {
  if (chapter.text.length <= maxChars) {
    return [
      {
        chapterIndex: chapter.index,
        chapterTitle: chapter.title,
        text: chapter.text,
        part: 1,
        parts: 1,
      },
    ];
  }
  const paragraphs = chapter.text.split(/\n{2,}/);
  const slices: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current.length + paragraph.length + 2 > maxChars && current !== "") {
      slices.push(current);
      current = "";
    }
    current = current === "" ? paragraph : `${current}\n\n${paragraph}`;
    // A single paragraph longer than the ceiling is split mid-text.
    while (current.length > maxChars) {
      slices.push(current.slice(0, maxChars));
      current = current.slice(maxChars);
    }
  }
  if (current !== "") slices.push(current);
  return slices.map((text, index) => ({
    chapterIndex: chapter.index,
    chapterTitle: chapter.title,
    text,
    part: index + 1,
    parts: slices.length,
  }));
}
