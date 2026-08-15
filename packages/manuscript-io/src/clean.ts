import type { ExportChapter, ExportManuscript } from "./types";

/**
 * The leak boundary (§33).
 *
 * Every manuscript export — DOCX, EPUB, PDF, Markdown, plain text — passes its
 * prose through here first, so internal Manu data cannot reach a submitted
 * document: no YAML front matter, no scene markers, no HTML comments, no
 * stable IDs. The tests assert the absence, not just the intention.
 */
export function cleanChapterMarkdown(raw: string): string {
  return (
    raw
      // YAML front matter at the top of the file is project metadata.
      .replace(/^---\n[\s\S]*?\n---\n?/, "")
      // Scene markers, agent notes and any other HTML comment are internal.
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Patterns that must never appear in an export. Shared with the tests. */
export const INTERNAL_PATTERNS: readonly RegExp[] = [
  /\b(?:SCENE|CHAR|CHAPTER|FACT|THREAD|LOC|OBJ|EVENT|REL|SETUP|DEP|DECISION)_\d{4}\b/,
  /<!--/,
  /^---$/m,
];

export function leaksInternalData(text: string): boolean {
  return INTERNAL_PATTERNS.some((pattern) => pattern.test(text));
}

/** Assemble a clean export manuscript from raw chapter files. */
export function toExportManuscript(
  title: string,
  author: string,
  chapters: ReadonlyArray<{ title: string; raw: string }>,
): ExportManuscript {
  const cleaned: ExportChapter[] = chapters.map((chapter) => ({
    title: chapter.title,
    markdown: cleanChapterMarkdown(chapter.raw),
  }));
  return { title, author, chapters: cleaned };
}
