import type { PlotThread, Scene, Setup } from "@jellytind/domain";
import { isOpen, type ThreadDormancy } from "./threads";
import type { ManuscriptMetrics, StoryTimeline } from "./timeline";
import type { TimelineView } from "./types";

/**
 * Deterministic narrative-promise checks.
 *
 * Every finding here is decidable from recorded structure: a setup with nothing
 * on the other end, a payoff the reader meets before its planting, a thread
 * marked abandoned. **Nothing here judges craft.** Whether a piece of
 * foreshadowing is too obvious, or a dormancy is a pacing failure, is a semantic
 * question that belongs to a model working from the prose — and answering it
 * here with a number would be worse than not answering it at all
 * (docs/NARRATIVE_THREADS.md).
 */
export type NarrativeFindingKind =
  /** A promise is planted with nothing recorded to keep it. */
  | "setup_without_payoff"
  /** The payoff is presented before the setup that plants it. */
  | "payoff_before_setup"
  /** A setup's thread has finished, but the setup never paid off. */
  | "unresolved_setup"
  /** A setup or payoff names a scene the project does not have. */
  | "dangling_setup_reference"
  /** A thread was abandoned; anything it was carrying is abandoned with it. */
  | "abandoned_thread"
  /** A thread has been off the page for longer than the caller asked about. */
  | "dormant_thread";

/**
 * How confident the finding is.
 *
 * An `error` is a structural contradiction — a payoff before its setup, a
 * reference to a scene that does not exist. Everything else is a `warning`,
 * because an unfinished book is *supposed* to be full of open promises and long
 * silences, and calling those mistakes would make the check useless while
 * drafting.
 */
export type NarrativeSeverity = "error" | "warning";

export interface NarrativeFinding {
  readonly kind: NarrativeFindingKind;
  readonly severity: NarrativeSeverity;
  readonly setupId?: string;
  readonly threadId?: string;
  readonly sceneIds?: readonly string[];
  /** The dormancy measurements behind a `dormant_thread`, never a verdict. */
  readonly dormancy?: ThreadDormancy;
  readonly message: string;
}

export interface NarrativeCheckInput {
  readonly timeline: StoryTimeline;
  readonly scenes: readonly Scene[];
  readonly threads: readonly PlotThread[];
  readonly setups: readonly Setup[];
  /** For dormancy measurement. Optional; absent measures are simply not reported. */
  readonly metrics?: ManuscriptMetrics;
  /**
   * Report threads quiet for at least this many scenes.
   *
   * There is no default worth having — the right number for a thriller is wrong
   * for a family saga — so dormancy is reported **only** when a caller names a
   * threshold. The system does not decide what "too long" means.
   */
  readonly dormantAfterScenes?: number;
  readonly view?: TimelineView;
}

/** Check the project's narrative promises. Deterministic; no model involved. */
export function checkNarrative(input: NarrativeCheckInput): NarrativeFinding[] {
  const view = input.view ?? {};
  const out: NarrativeFinding[] = [];
  const sceneIds = new Set(input.scenes.map((s) => s.id as string));
  const { timeline } = input;

  const rank = (sceneId: string): number | undefined => {
    try {
      return timeline.positionOf(sceneId);
    } catch {
      return undefined;
    }
  };

  // ── Setups ──────────────────────────────────────────────────────────────
  for (const setup of input.setups) {
    const id = setup.id as string;
    const plantings = setup.setupSceneIds as readonly string[];
    const payoffs = setup.payoffSceneIds as readonly string[];

    const missing = [...plantings, ...payoffs].filter((s) => !sceneIds.has(s));
    if (missing.length > 0) {
      out.push({
        kind: "dangling_setup_reference",
        severity: "error",
        setupId: id,
        sceneIds: missing,
        message: `${id} names ${missing.join(", ")}, which the project does not have.`,
      });
    }

    if (setup.abandoned === true) continue;

    if (payoffs.length === 0) {
      out.push({
        kind: "setup_without_payoff",
        severity: "warning",
        setupId: id,
        sceneIds: plantings,
        message: `${id} ("${setup.description}") is planted in ${
          plantings.length === 0 ? "no scene" : plantings.join(", ")
        } and has no payoff recorded.`,
      });
      continue;
    }

    // A payoff the reader reaches before any planting of it: the answer arrives
    // before the question. Only checkable where both ends are on the timeline.
    const firstPlanting = Math.min(
      ...plantings.map((s) => rank(s) ?? Number.POSITIVE_INFINITY),
      Number.POSITIVE_INFINITY,
    );
    for (const payoffSceneId of payoffs) {
      const at = rank(payoffSceneId);
      if (at === undefined || !Number.isFinite(firstPlanting)) continue;
      if (at >= firstPlanting) continue;
      out.push({
        kind: "payoff_before_setup",
        severity: "error",
        setupId: id,
        sceneIds: [payoffSceneId, ...plantings],
        message: `${id} pays off in ${payoffSceneId}, which the reader reaches before it is planted.`,
      });
    }

    // A promise attached to a thread that has finished without it landing.
    const thread =
      setup.targetThreadId === undefined
        ? undefined
        : input.threads.find((t) => t.id === setup.targetThreadId);
    if (thread === undefined) continue;

    const lastScene = timeline.sceneOrder.at(-1);
    if (lastScene === undefined) continue;
    const threadState = timeline.threadStateAt(
      { id: thread.id as string, name: thread.name, status: thread.status },
      { sceneId: lastScene, position: "after" },
      view,
    );
    if (isOpen(threadState.status)) continue;

    const paidWithinThread = payoffs.some((s) => rank(s) !== undefined);
    const resolvedAt = threadState.resolvedSceneId;
    const paidBeforeResolution =
      resolvedAt === undefined
        ? paidWithinThread
        : payoffs.some((s) => {
            const at = rank(s);
            const end = rank(resolvedAt);
            return at !== undefined && end !== undefined && at <= end;
          });

    if (!paidBeforeResolution) {
      out.push({
        kind: "unresolved_setup",
        severity: "warning",
        setupId: id,
        threadId: thread.id as string,
        message: `${id} points at ${String(thread.id)}, which is ${threadState.status}, but its payoff does not land before the thread finishes.`,
      });
    }
  }

  // ── Threads ─────────────────────────────────────────────────────────────
  const lastScene = timeline.sceneOrder.at(-1);
  for (const thread of input.threads) {
    if (lastScene === undefined) break;
    const threadId = thread.id as string;
    const asOf = { sceneId: lastScene, position: "after" } as const;
    const state = timeline.threadStateAt(
      { id: threadId, name: thread.name, status: thread.status },
      asOf,
      view,
    );

    if (state.status === "abandoned") {
      const orphaned = input.setups.filter(
        (s) => s.targetThreadId === thread.id && s.abandoned !== true,
      );
      out.push({
        kind: "abandoned_thread",
        severity: "warning",
        threadId,
        message:
          orphaned.length === 0
            ? `${threadId} ("${thread.name}") is abandoned.`
            : `${threadId} ("${thread.name}") is abandoned, and ${String(orphaned.length)} setup(s) still point at it: ${orphaned.map((s) => s.id as string).join(", ")}.`,
      });
      continue;
    }

    if (input.dormantAfterScenes === undefined || !isOpen(state.status)) continue;

    const dormancy = timeline.threadDormancy(threadId, asOf, input.metrics ?? {}, view);
    if (
      dormancy.neverAppeared ||
      (dormancy.scenesSinceAppearance ?? 0) < input.dormantAfterScenes
    ) {
      continue;
    }

    out.push({
      kind: "dormant_thread",
      severity: "warning",
      threadId,
      dormancy,
      // Deliberately a measurement, not a verdict: a long silence may be exactly
      // the shape the book needs.
      message: `${threadId} ("${thread.name}") is ${state.status} and has not appeared for ${String(dormancy.scenesSinceAppearance)} scene(s), since ${String(dormancy.lastAppearanceSceneId)}.`,
    });
  }

  return out;
}

/**
 * Setups a scene is party to, in both directions.
 *
 * Separated from the checks because the Context Compiler and the UI both want
 * this and neither wants a finding.
 */
export function setupsForScene(
  setups: readonly Setup[],
  sceneId: string,
): { planted: Setup[]; paidOff: Setup[] } {
  return {
    planted: setups.filter((s) => (s.setupSceneIds as readonly string[]).includes(sceneId)),
    paidOff: setups.filter((s) => (s.payoffSceneIds as readonly string[]).includes(sceneId)),
  };
}

/**
 * Promises outstanding entering a scene: planted before it, not yet kept.
 *
 * This is the list a drafting operation needs — what the story has already
 * asked the reader to hold on to. A setup planted *later* is not an outstanding
 * promise at this point in the book, and including it would hand an earlier
 * scene a piece of the ending.
 */
export function openSetupsBefore(
  setups: readonly Setup[],
  timeline: StoryTimeline,
  sceneId: string,
): Setup[] {
  const rank = (id: string): number | undefined => {
    try {
      return timeline.positionOf(id);
    } catch {
      return undefined;
    }
  };
  const here = rank(sceneId);
  if (here === undefined) return [];

  return setups.filter((setup) => {
    if (setup.abandoned === true) return false;
    const planted = (setup.setupSceneIds as readonly string[]).some((s) => {
      const at = rank(s);
      return at !== undefined && at < here;
    });
    if (!planted) return false;
    const kept = (setup.payoffSceneIds as readonly string[]).some((s) => {
      const at = rank(s);
      return at !== undefined && at < here;
    });
    return !kept;
  });
}
