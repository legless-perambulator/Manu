import type { Universe } from "./store";
import type { ChronologyRow } from "./types";

/**
 * The cross-book timeline (§6): books in story chronology with historical and
 * inter-book events interleaved. Both orders are first-class — reading order
 * lives on each book row, story order is the sequence of the list — and a
 * prequel simply carries a `storyOrder` earlier than its `readingOrder`.
 */
export async function universeChronology(universe: Universe): Promise<ChronologyRow[]> {
  const rows: ChronologyRow[] = [];
  for (const book of universe.getManifest().books) {
    rows.push({
      kind: "book",
      label: book.title,
      bookId: book.bookId,
      readingOrder: book.readingOrder,
      storyPosition: (book.storyOrder ?? book.readingOrder) * 10,
    });
  }
  for (const event of await universe.listEvents()) {
    rows.push({
      kind: "event",
      label: event.name,
      eventId: event.id,
      // `afterStoryOrder: 1` lands between book 1 (10) and book 2 (20).
      storyPosition: event.afterStoryOrder * 10 + 5,
      ...(event.year !== undefined ? { year: event.year } : {}),
    });
  }
  return rows.sort((a, b) => a.storyPosition - b.storyPosition);
}

/**
 * Derived age where the story states enough to derive it (§8): a birth year
 * on the canon character and a story year on the moment. Anything less
 * returns null — an age is never fabricated.
 */
export function derivedAge(
  birthYear: number | undefined,
  storyYear: number | undefined,
): number | null {
  if (birthYear === undefined || storyYear === undefined) return null;
  const age = storyYear - birthYear;
  return age < 0 ? null : age;
}
