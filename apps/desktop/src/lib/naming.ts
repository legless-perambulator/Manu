/**
 * How the machine's names become the writer's names.
 *
 * Manu stores a novel as plain files, and that is a promise worth keeping: it
 * is what makes the project portable, diffable, greppable and yours. It is not
 * an interface. `manuscript/CHAPTER_0007.md` is a storage detail; **Chapter
 * Seven** is what the writer called it.
 *
 * Everything here is a pure presentation function over data the repository
 * already holds. Nothing in this file renames, moves or rewrites a file — the
 * filesystem is untouched and stays exactly as portable as it was. The single
 * rule is that no writer-facing surface may print a path, an extension or an
 * internal ID as its primary label; the raw value survives as a tooltip and in
 * the advanced Project files view (docs/UX.md).
 */

/**
 * Chapter numbers as an author writes them.
 *
 * Spelled out to twenty, which covers the chapter count of most novels; beyond
 * that "Chapter 34" reads better than "Chapter Thirty-Four" and takes less
 * width in a sidebar.
 */
const ORDINAL_WORDS: readonly string[] = [
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
  "Twenty",
];

/** `1` → `"One"`, `21` → `"21"`. Anything below one is left as its numeral. */
export function numberWord(n: number): string {
  if (!Number.isInteger(n) || n < 1) return String(n);
  return ORDINAL_WORDS[n - 1] ?? String(n);
}

/**
 * What a chapter is called in the sidebar.
 *
 * `order` is 0-based in the record and 1-based to a human, which is exactly the
 * kind of translation this file exists to do.
 */
export function chapterNumberLabel(order: number): string {
  return `Chapter ${numberWord(order + 1)}`;
}

/** Strip the directory and the extension: `manuscript/CHAPTER_0007.md` → `CHAPTER_0007`. */
export function fileStem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * A readable name for a document that carries no title of its own.
 *
 * Notes and research are files the writer made, so their filename _is_ their
 * name — it just should not arrive wearing an extension and an underscore.
 * `notes/cellar_door-ideas.md` → `Cellar door ideas`.
 */
export function documentName(path: string): string {
  const stem = fileStem(path);
  const words = stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (words === "") return stem;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Paths that are Manu's own bookkeeping rather than the writer's work.
 *
 * These never appear in normal navigation at all — not renamed, not tidied,
 * simply not there. They remain visible in the advanced Project files view,
 * because "a folder of files you own" includes the parts Manu wrote.
 */
export function isMachinePath(path: string): boolean {
  return path === "project.json" || path === ".writer" || path.startsWith(".writer/");
}

/** Prose the editor should set as prose rather than as data. */
export function isProsePath(path: string): boolean {
  return (
    path.startsWith("manuscript/") || path.startsWith("notes/") || path.startsWith("research/")
  );
}

/**
 * The one place that decides how an open document is titled.
 *
 * Preference order is deliberate: the writer's own title beats the record's
 * title, which beats a tidied filename. An extension never wins.
 */
export function documentTitle(path: string, frontMatterTitle?: string | null): string {
  const title = frontMatterTitle?.trim() ?? "";
  if (title !== "") return title;
  return documentName(path);
}

/**
 * Where a document sits, said the way a writer thinks of it.
 *
 * Used as the quiet second line beside a title. `manuscript/` is where the book
 * is, so it says "Manuscript", not a path fragment.
 */
const AREA_NAMES: Readonly<Record<string, string>> = {
  manuscript: "Manuscript",
  scenes: "Scenes",
  characters: "Characters",
  world: "World",
  "world/locations": "Locations",
  "world/objects": "Objects",
  "world/factions": "Factions",
  "world/history": "History",
  "world/glossary": "Glossary",
  plot: "Plot",
  story: "Story",
  style: "Style",
  notes: "Notes",
  research: "Research",
};

export function areaName(path: string): string {
  const cut = path.lastIndexOf("/");
  const dir = cut === -1 ? "" : path.slice(0, cut);
  return AREA_NAMES[dir] ?? AREA_NAMES[dir.split("/")[0] ?? ""] ?? "Project";
}

/**
 * Entity IDs are for the machine and for bug reports, never for a label.
 *
 * Kept as a predicate rather than a regex scattered through components so the
 * rule can be asserted once: a writer-facing string that matches this is a bug.
 */
const ID_SHAPE = /^[A-Z]{2,12}_[A-Za-z0-9]+$/;

export function looksLikeEntityId(text: string): boolean {
  return ID_SHAPE.test(text.trim());
}

/** Anything in a sentence that looks like a project file path. */
const PATH_IN_TEXT = /\b[\w][\w.\-/]*\.(?:md|json|ya?ml|txt|csv)\b/g;

/**
 * Rewrite a recorded summary into something a writer reads.
 *
 * History records what actually happened, and what actually happened is
 * `Edit manuscript/CHAPTER_0002.md` — that is the truth, it is what the diff
 * addresses, and the repository is right to store it that way. It is not what
 * a writer should be shown, so the path is swapped for the document's title at
 * the moment of display. The record is untouched; only the sentence changes.
 *
 * `titles` maps a project path to what the writer calls it. A path with no
 * title falls back to a tidied filename, which is still better than an
 * extension.
 */
export function humaniseSummary(summary: string, titles: ReadonlyMap<string, string>): string {
  return summary.replace(PATH_IN_TEXT, (path) => titles.get(path) ?? documentName(path));
}

/**
 * Whether a string is safe to show a writer as a primary label.
 *
 * Asserted in the tests over every label the navigation produces, which is the
 * only way "no backend leakage" stays true after the next panel is added.
 */
export function isWriterFacing(label: string): boolean {
  if (looksLikeEntityId(label)) return false;
  if (/\.(md|json|ya?ml|txt|csv|db|sqlite)\b/i.test(label)) return false;
  if (label.includes("/")) return false;
  return true;
}
