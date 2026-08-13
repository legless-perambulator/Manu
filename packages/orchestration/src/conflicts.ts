import type { Disagreement, ReviewNote, WorkflowArtifact } from "@jellytind/domain";
import { isReviewKind, type MergedReview } from "./artifacts";

/**
 * Finding where specialists disagree.
 *
 * Three editors reviewing the same draft will sometimes want opposite things:
 * the Character Editor wants a beat kept because it is the only place someone
 * hesitates, the Prose Editor wants it cut because it repeats the paragraph
 * above. **Both are right about their own subject.** Picking one silently — or
 * letting whichever ran last overwrite the other — throws away the most useful
 * thing the review produced (docs/ORCHESTRATION.md).
 *
 * So disagreement is detected structurally: same target, different stance.
 * That is a fact, not an interpretation, which is why review notes carry a
 * closed set of stances rather than free prose.
 */
export function detectDisagreements(
  reviews: ReadonlyArray<{ agent: string; notes: readonly ReviewNote[] }>,
): Disagreement[] {
  const byTarget = new Map<string, Array<{ agent: string; note: ReviewNote }>>();
  for (const review of reviews) {
    for (const note of review.notes) {
      const existing = byTarget.get(note.target) ?? [];
      existing.push({ agent: review.agent, note });
      byTarget.set(note.target, existing);
    }
  }

  const out: Disagreement[] = [];
  for (const [target, entries] of [...byTarget.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const stances = new Set(entries.map((entry) => entry.note.stance));
    // One stance is agreement, however many agents hold it. Two is a decision
    // the writer has to make.
    if (stances.size < 2) continue;
    out.push({
      target,
      positions: entries.map((entry) => ({
        agent: entry.agent,
        stance: entry.note.stance,
        statement: entry.note.statement,
      })),
    });
  }
  return out;
}

/**
 * Combine reviews into one artifact, keeping every note and every conflict.
 *
 * Nothing is dropped and nothing is reconciled: the merged review is the union
 * of what the reviewers said, plus an explicit list of where they pull in
 * different directions.
 */
export function mergeReviews(artifacts: readonly WorkflowArtifact[]): MergedReview {
  const reviews = artifacts
    .filter((artifact) => isReviewKind(artifact.kind))
    .map((artifact) => ({
      agent: artifact.producedBy,
      notes: ((artifact.payload as { notes?: readonly ReviewNote[] }).notes ??
        []) as readonly ReviewNote[],
    }));

  const byAgent: Record<string, number> = {};
  for (const review of reviews) byAgent[review.agent] = review.notes.length;

  return {
    notes: reviews.flatMap((review) => review.notes),
    disagreements: detectDisagreements(reviews),
    byAgent,
  };
}

/** Record the writer's decision on a disagreement, keeping both positions. */
export function resolveDisagreement(
  disagreements: readonly Disagreement[],
  target: string,
  chose: string,
  now: string,
  note?: string,
): Disagreement[] {
  return disagreements.map((item) =>
    item.target === target
      ? { ...item, resolution: { chose, ...(note === undefined ? {} : { note }), decidedAt: now } }
      : item,
  );
}

export function openDisagreements(disagreements: readonly Disagreement[]): Disagreement[] {
  return disagreements.filter((item) => item.resolution === undefined);
}

/** A disagreement in one line, for the approval prompt. */
export function describeDisagreement(item: Disagreement): string {
  const positions = item.positions
    .map((position) => `${position.agent} would ${position.stance} it`)
    .join("; ");
  return `${item.target}: ${positions}`;
}
