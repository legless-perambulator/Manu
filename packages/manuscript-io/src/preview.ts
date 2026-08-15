import type { ImportedManuscript, ImportPreview } from "./types";

/** What the writer sees, and can correct, before anything is created (§3). */
export function previewOf(imported: ImportedManuscript): ImportPreview {
  return {
    title: imported.title,
    author: imported.author,
    chapterCount: imported.chapters.length,
    chapters: imported.chapters.map((chapter) => ({
      title: chapter.title,
      words: chapter.words,
      boundary: chapter.boundary,
    })),
    words: imported.words,
    formatting: imported.formatting,
    problems: imported.problems,
  };
}
