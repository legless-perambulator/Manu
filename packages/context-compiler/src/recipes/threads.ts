import type { PlotThread, Scene, Setup } from "@jellytind/domain";
import {
  describeDormancy,
  isRunning,
  openSetupsBefore,
  setupsForScene,
  type ManuscriptMetrics,
  type StoryTimeline,
} from "@jellytind/story-state";
import { PRIORITY, type Candidate } from "../candidate";
import type { ProjectReader } from "../reader";
import { provenance } from "./shared";

/**
 * Narrative promises as compiled context.
 *
 * Drafting a scene needs three things the manuscript does not say out loud: the
 * threads this scene is carrying, the promises the story has already made and
 * not yet kept, and — when this scene is where one lands — what it is meant to
 * pay off.
 *
 * The third is the dangerous one. A payoff's `trueMeaning` is *authorial
 * intent*: it is what the writer knows and the reader does not. Elements
 * carrying it are marked `revealsFuture`, so a Reader Simulation — whose whole
 * purpose is modelling what a reader believes at a point in the book — can
 * exclude them structurally rather than by remembering to
 * (docs/NARRATIVE_THREADS.md).
 */
export interface ThreadCandidateInput {
  readonly timeline: StoryTimeline;
  readonly scene: Scene;
  readonly threads: readonly PlotThread[];
  readonly setups: readonly Setup[];
  readonly metrics?: ManuscriptMetrics;
  /** Cap on outstanding promises carried, newest first. */
  readonly maxOpenSetups?: number;
}

export async function readNarrative(
  reader: ProjectReader,
): Promise<{ threads: PlotThread[]; setups: Setup[] }> {
  const [threads, setups] = await Promise.all([
    reader.listPlotThreads(),
    reader.listSetups?.() ?? Promise.resolve([]),
  ]);
  return { threads, setups };
}

export function threadCandidates(input: ThreadCandidateInput): Candidate[] {
  const { timeline, scene, threads, setups } = input;
  try {
    timeline.positionOf(scene.id);
  } catch {
    return [];
  }

  const sceneId = scene.id as string;
  const asOf = { sceneId, position: "before" } as const;
  const out: Candidate[] = [];

  // ── Threads this scene carries ──────────────────────────────────────────
  const carried = (scene.plotThreadIds as readonly string[])
    .map((id) => threads.find((t) => t.id === id))
    .filter((t): t is PlotThread => t !== undefined);

  for (const [index, thread] of carried.entries()) {
    const state = timeline.threadStateAt(
      { id: thread.id as string, name: thread.name, status: thread.status },
      asOf,
    );
    const dormancy = timeline.threadDormancy(thread.id as string, asOf, input.metrics ?? {});

    const lines = [
      `THREAD ${thread.id} — ${thread.name}`,
      `status entering ${sceneId}: ${state.status}`,
      `description: ${thread.description}`,
    ];
    if (state.introducedSceneId !== undefined) {
      lines.push(`introduced in: ${state.introducedSceneId}`);
    }
    if (state.appearanceSceneIds.length > 0) {
      lines.push(`appears in: ${state.appearanceSceneIds.join(", ")}`);
    }
    // Stated as a measurement. Whether the gap is a problem is the writer's call.
    if (!dormancy.neverAppeared) lines.push(`last touched: ${describeDormancy(dormancy)}`);

    out.push({
      id: thread.id as string,
      kind: "plot_thread_state",
      label: `${thread.name} (${state.status})`,
      section: "plotThreads",
      priority: PRIORITY.threads + index,
      provenance: provenance(
        "active_thread",
        `plot thread carried by ${sceneId}, as it stands entering the scene`,
        [sceneId, thread.id as string],
      ),
      full: lines.join("\n"),
      summary: `${thread.id as string} — ${thread.name}: ${state.status}`,
    });
  }

  // ── Promises already made and not yet kept ──────────────────────────────
  const open = openSetupsBefore(setups, timeline, sceneId).slice(-(input.maxOpenSetups ?? 8));
  const relevant = open.filter(
    (setup) =>
      setup.targetThreadId === undefined ||
      (scene.plotThreadIds as readonly string[]).includes(setup.targetThreadId as string),
  );
  const carried_ = relevant.length > 0 ? relevant : open;

  if (carried_.length > 0) {
    out.push({
      id: `open-setups@${sceneId}`,
      kind: "setup",
      label: "Promises outstanding",
      section: "plotThreads",
      priority: PRIORITY.threads + 20,
      provenance: provenance(
        "open_setup",
        `promises planted before ${sceneId} that the story has not yet kept`,
        [sceneId],
      ),
      // Deliberately not marked as revealing the future: what has already been
      // planted is something the reader has seen. Only the intent behind it is
      // hidden, and that is not rendered here.
      full: [
        `OUTSTANDING PROMISES ENTERING ${sceneId}`,
        "The story has made these and not yet kept them. The reader is holding them.",
        ...carried_.map(
          (setup) =>
            `- ${setup.id as string}: ${setup.description} (planted in ${(setup.setupSceneIds as readonly string[]).join(", ")}; ${setup.subtlety})`,
        ),
      ].join("\n"),
    });
  }

  // ── What this scene is meant to pay off ─────────────────────────────────
  const { paidOff, planted } = setupsForScene(setups, sceneId);

  if (paidOff.length > 0) {
    out.push({
      id: `payoffs@${sceneId}`,
      kind: "setup",
      label: "Payoffs landing here",
      section: "plotThreads",
      priority: PRIORITY.threads + 21,
      provenance: provenance("scene_payoff", `${sceneId} is where these promises are kept`, [
        sceneId,
      ]),
      revealsFuture: true,
      full: [
        `PAYOFFS LANDING IN ${sceneId}`,
        ...paidOff.flatMap((setup) => [
          `- ${setup.id as string}: planted as "${setup.description}" in ${(setup.setupSceneIds as readonly string[]).join(", ")}`,
          ...(setup.payoffDescription === undefined
            ? []
            : [`  pays off as: ${setup.payoffDescription}`]),
          ...(setup.trueMeaning === undefined
            ? []
            : [`  what it actually means: ${setup.trueMeaning}`]),
        ]),
      ].join("\n"),
    });
  }

  if (planted.length > 0) {
    out.push({
      id: `plantings@${sceneId}`,
      kind: "setup",
      label: "Planted here",
      section: "plotThreads",
      priority: PRIORITY.threads + 22,
      provenance: provenance(
        "authorial_intent",
        `${sceneId} plants these promises, and what they are for`,
        [sceneId],
      ),
      revealsFuture: true,
      full: [
        `PLANTED IN ${sceneId}`,
        "Author-only. The reader must not be told what these are for.",
        ...planted.flatMap((setup) => [
          `- ${setup.id as string}: ${setup.description} (${setup.subtlety})`,
          ...(setup.intendedInterpretation === undefined
            ? []
            : [`  a first reading should take it as: ${setup.intendedInterpretation}`]),
          ...(setup.trueMeaning === undefined
            ? []
            : [`  what it actually means: ${setup.trueMeaning}`]),
          ...(setup.payoffSceneIds.length === 0
            ? []
            : [`  pays off in: ${(setup.payoffSceneIds as readonly string[]).join(", ")}`]),
        ]),
      ].join("\n"),
    });
  }

  return out;
}

/** Threads running at a scene, for recipes that want the list rather than the text. */
export function runningThreadsAt(
  timeline: StoryTimeline,
  threads: readonly PlotThread[],
  sceneId: string,
): PlotThread[] {
  const asOf = { sceneId, position: "before" } as const;
  return threads.filter((thread) =>
    isRunning(
      timeline.threadStateAt(
        { id: thread.id as string, name: thread.name, status: thread.status },
        asOf,
      ).status,
    ),
  );
}
