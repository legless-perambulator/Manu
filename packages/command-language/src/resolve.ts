import type { CatalogEntry, ChapterRef, Resolution } from "./types";

/**
 * Human names to stable IDs (§3).
 *
 * A writer types `/inspect Mara`, not `/inspect CHAR_0019`. The resolver takes
 * whatever was typed and matches it against the project's own entities — and
 * when two Maras exist, it says so with both candidates rather than guessing,
 * because a command that guessed would sometimes be about the wrong character.
 */

/** Lowercase, and treat underscores and hyphens as spaces: `vault_exists` ≈ "Vault Exists". */
function fold(text: string): string {
  return text.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

export function resolveEntity(
  query: string,
  catalog: readonly CatalogEntry[],
  kinds?: readonly string[],
): Resolution {
  const pool =
    kinds === undefined || kinds.length === 0
      ? catalog
      : catalog.filter((entry) => kinds.includes(entry.kind));

  // A stable ID is already resolved — this is what makes re-running an
  // ambiguous command with the chosen candidate's ID deterministic.
  const byId = pool.find((entry) => entry.id === query.trim());
  if (byId !== undefined) return { kind: "resolved", entry: byId };

  const needle = fold(query);
  if (needle === "") return { kind: "unknown", query };

  const exact = pool.filter((entry) => fold(entry.name) === needle);
  if (exact.length === 1) return { kind: "resolved", entry: exact[0] as CatalogEntry };
  if (exact.length > 1) return { kind: "ambiguous", candidates: exact };

  // "Mara" matches "Mara Ellison" by word; "photog" matches by prefix.
  const partial = pool.filter((entry) => {
    const name = fold(entry.name);
    return name.startsWith(needle) || name.split(" ").some((word) => word.startsWith(needle));
  });
  if (partial.length === 1) return { kind: "resolved", entry: partial[0] as CatalogEntry };
  if (partial.length > 1) return { kind: "ambiguous", candidates: partial };

  return { kind: "unknown", query };
}

/**
 * A chapter by the number the writer uses, by title, or by ID.
 *
 * `17` means the seventeenth chapter of the manuscript — `order` 16 — because
 * nobody counts their own book from zero.
 */
export function resolveChapter(query: string, chapters: readonly ChapterRef[]): Resolution {
  const trimmed = query.trim();
  const byId = chapters.find((chapter) => chapter.id === trimmed);
  if (byId !== undefined) return { kind: "resolved", entry: chapterEntry(byId) };

  if (/^\d+$/.test(trimmed)) {
    const wanted = Number.parseInt(trimmed, 10) - 1;
    const byOrder = chapters.find((chapter) => chapter.order === wanted);
    if (byOrder !== undefined) return { kind: "resolved", entry: chapterEntry(byOrder) };
    return { kind: "unknown", query };
  }

  const needle = fold(trimmed);
  const matches = chapters.filter((chapter) => {
    const title = fold(chapter.title ?? "");
    return (
      title !== "" &&
      (title === needle ||
        title.startsWith(needle) ||
        title.split(" ").some((word) => word.startsWith(needle)))
    );
  });
  if (matches.length === 1)
    return { kind: "resolved", entry: chapterEntry(matches[0] as ChapterRef) };
  if (matches.length > 1) return { kind: "ambiguous", candidates: matches.map(chapterEntry) };
  return { kind: "unknown", query };
}

function chapterEntry(chapter: ChapterRef): CatalogEntry {
  return {
    id: chapter.id,
    kind: "chapter",
    name: chapter.title ?? `Chapter ${chapter.order + 1}`,
  };
}
