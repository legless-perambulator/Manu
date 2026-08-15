import type { ImportedChapter, ImportedManuscript } from "./types";

/** Words as a writer counts them: whitespace-separated tokens with substance. */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** `* * *`, `***`, `# # #`, `~~~`, or a centred `#` — the common break marks. */
const SCENE_BREAK = /^\s*(?:\*\s*\*\s*\*[\s*]*|#\s*#\s*#|~{3,}|—\s*—\s*—)\s*$/;

export function isSceneBreak(line: string): boolean {
  return SCENE_BREAK.test(line);
}

/**
 * A line that reads as a chapter heading in plain prose: "Chapter Seven",
 * "CHAPTER 12", "Prologue", "Part Two", "XII." — deterministic patterns first,
 * exactly as §4 orders them.
 */
const CHAPTER_PATTERN =
  /^\s*(?:chapter|part)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:-\w+)?|thirty(?:-\w+)?|forty(?:-\w+)?|fifty(?:-\w+)?)\b.*$|^\s*(?:prologue|epilogue|interlude)\b.*$/i;

export function isChapterHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  if (CHAPTER_PATTERN.test(trimmed)) return true;
  // A short line in full capitals, standing alone, is how many typescripts
  // mark chapters. Require letters so "* * *" and "12." do not qualify.
  return (
    trimmed.length <= 48 &&
    /[A-Z]/.test(trimmed) &&
    trimmed === trimmed.toUpperCase() &&
    !/[.!?]$/.test(trimmed) &&
    trimmed.split(/\s+/).length <= 8
  );
}

interface RawChapter {
  title: string;
  lines: string[];
  boundary: ImportedChapter["boundary"];
}

function finish(raw: RawChapter, index: number): ImportedChapter {
  const markdown = raw.lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    title: raw.title.trim() === "" ? `Chapter ${index + 1}` : raw.title.trim(),
    markdown,
    words: countWords(markdown),
    boundary: raw.boundary,
  };
}

export function chaptersFromLines(
  lines: readonly string[],
  isHeading: (line: string) => boolean,
  boundary: ImportedChapter["boundary"],
): ImportedChapter[] {
  const raws: RawChapter[] = [];
  let current: RawChapter | null = null;
  for (const line of lines) {
    if (isHeading(line)) {
      if (current !== null) raws.push(current);
      current = { title: line.replace(/^#+\s*/, "").trim(), lines: [], boundary };
      continue;
    }
    if (current === null) {
      // Prose before any heading: front matter or an unheaded opening.
      current = { title: "", lines: [], boundary: "single" };
    }
    current.lines.push(isSceneBreak(line) ? "* * *" : line);
  }
  if (current !== null) raws.push(current);

  // Drop empty shells (a heading directly followed by another heading).
  const kept = raws.filter((raw) => raw.lines.join("").trim() !== "" || raws.length === 1);
  return kept.map((raw, index) => finish(raw, index));
}

function problemsFor(chapters: readonly ImportedChapter[]): string[] {
  const problems: string[] = [];
  if (chapters.length === 1) {
    problems.push(
      "No chapter boundaries were detected — the whole text imports as one chapter. You can split it after import, or add headings first.",
    );
  }
  const empty = chapters.filter((chapter) => chapter.words === 0);
  if (empty.length > 0) {
    problems.push(`${empty.length} detected chapter(s) contain no prose.`);
  }
  const huge = chapters.filter((chapter) => chapter.words > 20000);
  if (huge.length > 0) {
    problems.push(
      `${huge.length} chapter(s) exceed 20,000 words — a heading may have been missed.`,
    );
  }
  return problems;
}

export function assembleManuscript(
  format: ImportedManuscript["format"],
  title: string | null,
  author: string | null,
  chapters: readonly ImportedChapter[],
  formatting: readonly string[],
  extraProblems: readonly string[] = [],
): ImportedManuscript {
  return {
    format,
    title,
    author,
    chapters,
    words: chapters.reduce((sum, chapter) => sum + chapter.words, 0),
    formatting,
    problems: [...extraProblems, ...problemsFor(chapters)],
  };
}

/** Markdown import: headings are structure, everything else is prose (§1). */
export function importMarkdown(source: string): ImportedManuscript {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  // Title: a single leading `#` heading before the first chapter heading.
  let title: string | null = null;
  const headingLevels = lines
    .filter((line) => /^#{1,3}\s/.test(line))
    .map((line) => (/^#\s/.test(line) ? 1 : /^##\s/.test(line) ? 2 : 3));
  const h1Count = headingLevels.filter((level) => level === 1).length;
  const chapterLevel = h1Count > 1 ? 1 : headingLevels.some((level) => level === 2) ? 2 : 1;
  if (h1Count === 1 && chapterLevel === 2) {
    title = (lines.find((line) => /^#\s/.test(line)) ?? "").replace(/^#\s*/, "").trim() || null;
  }
  const headingPattern = new RegExp(`^#{${chapterLevel}}\\s+`);
  const body = title === null ? lines : lines.filter((line) => !/^#\s/.test(line));
  const chapters = chaptersFromLines(body, (line) => headingPattern.test(line), "heading");
  return assembleManuscript("markdown", title, null, chapters, [
    "headings",
    "emphasis",
    "scene breaks",
  ]);
}

/** Plain text import: textual patterns are all there is (§4). */
export function importPlainText(source: string): ImportedManuscript {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const chapters = chaptersFromLines(lines, isChapterHeading, "pattern");
  return assembleManuscript("text", null, null, chapters, ["paragraphs", "scene breaks"]);
}
