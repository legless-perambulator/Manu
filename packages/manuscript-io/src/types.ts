/**
 * The shared shapes of manuscript import and export.
 *
 * Every importer — DOCX, Markdown, plain text, EPUB — lands on the same
 * `ImportedManuscript`, and every exporter starts from the same
 * `ExportManuscript`, so the rest of Manu never knows or cares which format a
 * book arrived in (docs/IMPORT_EXPORT.md).
 */

export type ImportFormat = "docx" | "markdown" | "text" | "epub";

/** One paragraph of imported prose, already normalised to Manu's Markdown. */
export interface ImportedChapter {
  readonly title: string;
  /** Markdown: `*italic*`, `**bold**`, `* * *` scene breaks, `>` quotes. */
  readonly markdown: string;
  readonly words: number;
  /** How the chapter boundary was found, shown in the preview. */
  readonly boundary: "heading" | "style" | "pattern" | "section" | "single";
}

export interface ImportedManuscript {
  readonly format: ImportFormat;
  readonly title: string | null;
  readonly author: string | null;
  readonly chapters: readonly ImportedChapter[];
  readonly words: number;
  /** Formatting the importer recognised and preserved. */
  readonly formatting: readonly string[];
  /** Anything the writer should look at before committing the import. */
  readonly problems: readonly string[];
}

/** What the writer sees before anything is created (§3). */
export interface ImportPreview {
  readonly title: string | null;
  readonly author: string | null;
  readonly chapterCount: number;
  readonly chapters: ReadonlyArray<{ title: string; words: number; boundary: string }>;
  readonly words: number;
  readonly formatting: readonly string[];
  readonly problems: readonly string[];
}

/** Where an imported project came from — kept, never rewritten (§2). */
export interface ImportProvenance {
  readonly fileName: string;
  readonly format: ImportFormat;
  readonly importedAt: string;
  readonly words: number;
  readonly chapterCount: number;
}

// ── Export ─────────────────────────────────────────────────────────────────

export interface ExportChapter {
  readonly title: string;
  /** Clean Markdown prose — internal markers already stripped. */
  readonly markdown: string;
}

export interface ExportManuscript {
  readonly title: string;
  readonly author: string;
  readonly chapters: readonly ExportChapter[];
}

/**
 * The Standard Manuscript preset (§32): recognisably traditional submission
 * formatting with the details configurable, because no one publisher's rules
 * are universal.
 */
export interface ManuscriptFormatOptions {
  /** `courier` reads as a typewriter; `serif` as a book. */
  readonly font: "courier" | "serif";
  readonly fontSize: number;
  readonly doubleSpaced: boolean;
  /** Start every chapter on a fresh page. */
  readonly chapterOnNewPage: boolean;
  readonly includeTitlePage: boolean;
  readonly pageNumbers: boolean;
  /** Shown in the running header alongside the page number. */
  readonly headerText: string | null;
}

export const STANDARD_MANUSCRIPT: ManuscriptFormatOptions = {
  font: "courier",
  fontSize: 12,
  doubleSpaced: true,
  chapterOnNewPage: true,
  includeTitlePage: true,
  pageNumbers: true,
  headerText: null,
};
