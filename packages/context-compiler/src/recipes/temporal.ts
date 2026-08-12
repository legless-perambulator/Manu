import { describeDuration, describeStoryTime, type Scene } from "@jellytind/domain";
import { StoryChronology, timelineNodes, type TimelineNode } from "@jellytind/story-state";
import { PRIORITY, type Candidate } from "../candidate";
import type { ProjectReader } from "../reader";
import { provenance } from "./shared";

/**
 * Temporal context.
 *
 * A model drafting a scene needs to know *when* it happens — and, just as much,
 * what has already happened by then. The trap is the second half: in a nonlinear
 * story the manuscript's neighbours are not the story's neighbours, so "what
 * came before" cannot be read off the chapter order. It has to come from the
 * chronology.
 *
 * Which is also why the future is excluded by default. A flashback sits early in
 * the story world and late in the book; handing its drafting context the events
 * that surround it *in the manuscript* would quietly write the ending into the
 * beginning. Everything here is selected at the target's chronological position
 * and nothing after it is included unless a caller asks (`includeFuture`), which
 * is the "unless intentionally requested" clause made explicit rather than
 * assumed.
 */
export async function buildChronology(reader: ProjectReader): Promise<StoryChronology> {
  const [scenes, chapters, events, links] = await Promise.all([
    reader.listScenes(),
    reader.listChapters(),
    reader.listEvents?.() ?? Promise.resolve([]),
    reader.listTemporalLinks?.() ?? Promise.resolve([]),
  ]);
  return new StoryChronology(timelineNodes({ scenes, chapters, events }), links);
}

export interface TemporalCandidateInput {
  readonly chronology: StoryChronology;
  readonly scene: Scene;
  /** How many chronologically preceding events to carry. */
  readonly maxPrecedingEvents?: number;
  /**
   * Include material that happens *after* the target in the story world.
   * Off by default: future events leaking into drafting context is the specific
   * failure this recipe exists to prevent.
   */
  readonly includeFuture?: boolean;
}

function describeNode(chronology: StoryChronology, node: TimelineNode): string {
  const bits = [`${node.id} — ${node.label}`, `when: ${describeStoryTime(node.storyTime)}`];
  if (node.duration !== undefined) bits.push(`lasts: ${describeDuration(node.duration)}`);
  if (node.locationId !== undefined) bits.push(`at: ${node.locationId}`);
  if (node.characterIds.length > 0) bits.push(`involves: ${node.characterIds.join(", ")}`);
  if (node.kind === "event" && node.sceneId === undefined) bits.push("off-page");
  if (chronology.isFlashback(node.id)) bits.push("presented out of chronological sequence");
  return `- ${bits.join("; ")}`;
}

/**
 * Temporal candidates for a scene: where it sits in story time, what the story
 * world had already reached by then, and what is happening elsewhere at the
 * same moment.
 */
export function temporalCandidates(input: TemporalCandidateInput): Candidate[] {
  const { chronology, scene } = input;
  const sceneId = scene.id as string;
  if (!chronology.has(sceneId)) return [];

  const here = chronology.chronologicalIndexOf(sceneId);
  const out: Candidate[] = [];
  const flashback = chronology.isFlashback(sceneId);

  // ── Where the target sits ────────────────────────────────────────────────
  const node = chronology.node(sceneId);
  const presentationRank = node.presentationIndex;
  out.push({
    id: `story-time@${sceneId}`,
    kind: "story_time",
    label: `${sceneId} in story time`,
    section: "storyState",
    priority: PRIORITY.state - 1,
    provenance: provenance("story_time", `where ${sceneId} sits in story-world chronology`, [
      sceneId,
    ]),
    full: [
      `STORY TIME OF ${sceneId}`,
      `when: ${describeStoryTime(node.storyTime)}`,
      ...(node.duration === undefined ? [] : [`lasts: ${describeDuration(node.duration)}`]),
      `chronological position: ${String(here + 1)} of ${String(chronology.chronologicalOrder().length)}`,
      ...(presentationRank === undefined
        ? []
        : [`manuscript position: ${String(presentationRank + 1)}`]),
      ...(flashback
        ? [
            "This scene is presented after material that happens later in the story world:",
            "it is out of chronological sequence. Do not assume the preceding chapters",
            "have already happened here.",
          ]
        : []),
    ].join("\n"),
    summary: `${sceneId} happens ${describeStoryTime(node.storyTime)}${flashback ? " (out of sequence)" : ""}`,
  });

  // ── What the world had already reached ──────────────────────────────────
  const limit = input.maxPrecedingEvents ?? 6;
  const preceding = chronology
    .chronologicalOrder()
    .filter((n) => n.kind === "event" && chronology.chronologicalIndexOf(n.id) < here)
    .slice(-limit);

  if (preceding.length > 0) {
    out.push({
      id: `preceding-events@${sceneId}`,
      kind: "timeline",
      label: "Events already past",
      section: "storyState",
      priority: PRIORITY.state + 7,
      provenance: provenance(
        "preceding_event",
        `events that have already happened in the story world by ${sceneId}`,
        [sceneId],
      ),
      full: [
        `STORY-WORLD EVENTS BEFORE ${sceneId}`,
        "These have happened by this point in the story world, whatever order the",
        "manuscript presents them in.",
        ...preceding.map((n) => describeNode(chronology, n)),
      ].join("\n"),
    });
  }

  // ── What else is happening now ──────────────────────────────────────────
  const concurrent = chronology
    .simultaneousWith(sceneId)
    .filter((n) => input.includeFuture === true || chronology.chronologicalIndexOf(n.id) <= here);

  if (concurrent.length > 0) {
    out.push({
      id: `concurrent@${sceneId}`,
      kind: "timeline",
      label: "Happening at the same time",
      section: "storyState",
      priority: PRIORITY.state + 8,
      provenance: provenance(
        "concurrent_node",
        `material that occupies the same story-world moment as ${sceneId}`,
        [sceneId],
      ),
      full: [
        `CONCURRENT WITH ${sceneId}`,
        ...concurrent.map((n) => describeNode(chronology, n)),
      ].join("\n"),
    });
  }

  // ── What has not happened yet ───────────────────────────────────────────
  if (input.includeFuture === true) {
    const future = chronology
      .chronologicalOrder()
      .filter((n) => n.kind === "event" && chronology.chronologicalIndexOf(n.id) > here)
      .slice(0, limit);
    if (future.length > 0) {
      out.push({
        id: `future-events@${sceneId}`,
        kind: "timeline",
        label: "Events still to come",
        section: "storyState",
        priority: PRIORITY.state + 9,
        provenance: provenance(
          "future_event",
          `events after ${sceneId} in story time, included because this operation asked for them`,
          [sceneId],
        ),
        full: [
          `STORY-WORLD EVENTS AFTER ${sceneId}`,
          "These have NOT happened yet at this point in the story. They are included",
          "because the operation requested forward-looking context — do not write them",
          "as though the characters know them.",
          ...future.map((n) => describeNode(chronology, n)),
        ].join("\n"),
      });
    }
  }

  return out;
}
