import { orderScenes } from "@jellytind/domain";
import type { Chapter } from "@jellytind/domain";
import { PRIORITY, type Candidate } from "../candidate";
import { CompileError } from "../errors";
import type { ProjectReader } from "../reader";
import { excerptProse } from "../render";
import { proseCandidate, provenance, readSnapshot, type ProjectSnapshot } from "./shared";

/**
 * **Reader sequential** — the manuscript as a reader has met it, and nothing else.
 *
 * This recipe exists for one guarantee: a reader at chapter ten must not be
 * handed a single word from chapter eleven. Everything else about it follows
 * from that.
 *
 * So it is **subtractive rather than additive**. Where every other recipe asks
 * "what would help here?", this one asks "what could this person possibly have
 * seen?" and refuses the rest:
 *
 * - **Prose only, up to and including the target chapter.** Later chapters are
 *   not summarised, not mentioned, not counted.
 * - **No entity records at all.** A character sheet, a plot-thread status, a
 *   world rule, a fact's objective truth — these are what the *author* knows.
 *   Handing a reader the story bible would make every answer worthless: of
 *   course they suspect the right person, they were told.
 * - **No story state.** Who knows what, where the revolver is, how the
 *   relationship stands — all reconstructed from records the reader has not
 *   read.
 *
 * What a reader carries instead is their own accumulated state, which the
 * simulator supplies. This recipe supplies the pages.
 */
export async function gatherReaderSequential(
  reader: ProjectReader,
  chapterId: string,
  snapshot?: ProjectSnapshot,
): Promise<{ candidates: Candidate[]; snapshot: ProjectSnapshot; chapter: Chapter }> {
  const project = snapshot ?? (await readSnapshot(reader));
  const ordered = [...project.chapters].sort((a, b) => a.order - b.order);
  const at = ordered.findIndex((entry) => (entry.id as string) === chapterId);
  if (at === -1) {
    throw new CompileError("unknown_target", `No chapter with id ${chapterId}.`, {
      details: { chapterId },
    });
  }

  const target = ordered[at] as Chapter;
  const candidates: Candidate[] = [];

  // The chapter being read, in full. Required: a reader who was given an
  // excerpt of the chapter they are reading is not reading it.
  const current = await proseCandidate(
    reader,
    target,
    provenance("chapter_being_read", "the chapter this reader is reading now"),
  );
  if (current !== null) {
    candidates.push({ ...current, required: true, priority: PRIORITY.essential });
  }

  // What they have already read, nearest first — the most recent chapters are
  // the ones a reader actually has in mind.
  for (let index = at - 1; index >= 0; index -= 1) {
    const earlier = ordered[index];
    /* istanbul ignore next — index is bounded by `at`. */
    if (earlier === undefined) continue;
    const distance = at - index;
    const prose = await proseCandidate(
      reader,
      earlier,
      provenance(
        "already_read",
        `read ${String(distance)} chapter(s) ago, at position ${String(index + 1)}`,
      ),
    );
    if (prose === null) continue;
    candidates.push({
      ...prose,
      section: "adjacentScenes",
      // Recency decides what survives budget pressure: under a tight budget a
      // reader forgets the middle of the book before the last chapter.
      priority: PRIORITY.adjacent + distance,
      summary: excerptProse(prose.full, 1_200),
    });
  }

  return { candidates, snapshot: project, chapter: target };
}

/**
 * The scenes a reader has been shown by the end of a chapter.
 *
 * Exported for the simulator's deterministic half. It is the same boundary the
 * recipe applies, computed once so the two cannot drift apart.
 */
export function scenesReadBy(project: ProjectSnapshot, chapterId: string): string[] {
  const ordered = [...project.chapters].sort((a, b) => a.order - b.order);
  const at = ordered.findIndex((entry) => (entry.id as string) === chapterId);
  if (at === -1) return [];
  const seen = new Set(ordered.slice(0, at + 1).map((chapter) => chapter.id as string));
  return orderScenes(project.scenes, project.chapters)
    .filter((scene) => scene.chapterId !== undefined && seen.has(scene.chapterId as string))
    .map((scene) => scene.id as string);
}
