import type { PlotThreadStatus, ThreadInteraction } from "@jellytind/domain";
import type { StateBoundary } from "./types";

/**
 * Plot threads as tracked state.
 *
 * A thread is a promise the story is in the middle of keeping, and its shape —
 * introduced here, pushed forward there, quiet for eleven chapters, resolved at
 * the end — is invisible in the prose and obvious as data. Recording it means
 * the system understands narrative threads explicitly, rather than asking a
 * model to infer them from 150,000 words every time (docs/NARRATIVE_THREADS.md).
 */

/** Statuses in which a thread is still live and owed to the reader. */
export const OPEN_STATUSES: readonly PlotThreadStatus[] = [
  "planned",
  "introduced",
  "active",
  "escalating",
  "dormant",
];

/** Statuses in which a thread is carrying the story forward right now. */
export const RUNNING_STATUSES: readonly PlotThreadStatus[] = ["introduced", "active", "escalating"];

/** Whether the story still owes the reader something on this thread. */
export function isOpen(status: PlotThreadStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/** Whether the thread is doing work, as opposed to waiting or finished. */
export function isRunning(status: PlotThreadStatus): boolean {
  return RUNNING_STATUSES.includes(status);
}

/** One recorded step in a thread's life. */
export interface ThreadStep {
  readonly threadId: string;
  readonly sceneId: string;
  /** How the scene touched the thread, when the step records an appearance. */
  readonly interaction?: ThreadInteraction;
  /** The status after this step. */
  readonly status: PlotThreadStatus;
  /** The status before it, when it changed. */
  readonly previousStatus?: PlotThreadStatus;
  /** Whether the status came from an explicit change or from the interaction. */
  readonly statusSource: "explicit" | "implied" | "unchanged";
  readonly reason?: string;
}

/**
 * How long a thread has been off the page.
 *
 * Reported as measurements, never as a verdict. A thread quiet for eleven
 * chapters may be a structural problem or may be exactly the shape the book
 * needs; the system's job is to make the number visible, not to grade it
 * (docs/NARRATIVE_THREADS.md).
 */
export interface ThreadDormancy {
  readonly threadId: string;
  /** The last scene that touched the thread at all, if any. */
  readonly lastAppearanceSceneId?: string;
  readonly lastInteraction?: ThreadInteraction;
  /** Scenes between the last appearance and the boundary asked about. */
  readonly scenesSinceAppearance?: number;
  /** Chapters between them. Absent when scenes have no chapters. */
  readonly chaptersSinceAppearance?: number;
  /**
   * Words of manuscript between them, when the project's prose is available.
   * Word distance is the measure a writer actually feels.
   */
  readonly wordsSinceAppearance?: number;
  /** Whether the thread has never appeared at all. */
  readonly neverAppeared: boolean;
  readonly asOf: StateBoundary;
}

/** A thread's reconstructed state at a boundary. */
export interface ThreadState {
  readonly threadId: string;
  readonly name: string;
  readonly status: PlotThreadStatus;
  /** Where it was introduced, if it has been. */
  readonly introducedSceneId?: string;
  /** Where it was resolved, if it has been. */
  readonly resolvedSceneId?: string;
  /** Every scene that has touched it, in story order. */
  readonly appearanceSceneIds: readonly string[];
  readonly lastInteraction?: ThreadInteraction;
  readonly asOf: StateBoundary;
}

/** Past tense, for a history a writer reads. */
export const INTERACTION_VERBS: Readonly<Record<ThreadInteraction, string>> = {
  introduces: "introduced",
  advances: "advanced",
  complicates: "complicated",
  references: "referenced",
  escalates: "escalated",
  resolves: "resolved",
};

/** A thread's dormancy in a sentence, with no judgement attached. */
export function describeDormancy(dormancy: ThreadDormancy): string {
  if (dormancy.neverAppeared) return "has not appeared yet";
  const parts: string[] = [];
  if (dormancy.scenesSinceAppearance !== undefined) {
    parts.push(`${String(dormancy.scenesSinceAppearance)} scene(s)`);
  }
  if (dormancy.chaptersSinceAppearance !== undefined) {
    parts.push(`${String(dormancy.chaptersSinceAppearance)} chapter(s)`);
  }
  if (dormancy.wordsSinceAppearance !== undefined) {
    parts.push(`${dormancy.wordsSinceAppearance.toLocaleString("en-GB")} words`);
  }
  if (parts.length === 0) return `last seen in ${String(dormancy.lastAppearanceSceneId)}`;
  return `${parts.join(", ")} since ${String(dormancy.lastAppearanceSceneId)}`;
}
