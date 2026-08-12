import type { EntityKind } from "./ids/entity-kind";
import { entityKindOf } from "./ids/ids";

/**
 * The causality vocabulary: cause and effect between story elements.
 *
 * A manuscript records *sequence* — this scene, then that one. It does not
 * record *consequence*, and consequence is what breaks when a scene is cut.
 * Nothing in the prose says that the confrontation in chapter 19 only happens
 * because of the letter in chapter 4; that link lives in the author's head
 * until something writes it down (MASTER_BUILD.md §3, docs/STORY_REFACTOR.md).
 *
 * This is deliberately **not** an attempt to encode every causal relation in a
 * novel. A graph that tried would be enormous, mostly wrong, and useless. What
 * earns a place here is the dependency a writer would want to be warned about.
 */

export type DependencyKind =
  | "causes"
  | "enables"
  | "motivates"
  | "reveals"
  | "requires"
  | "depends_on"
  | "prevents"
  | "resolves";

export const DEPENDENCY_KINDS: readonly DependencyKind[] = [
  "causes",
  "enables",
  "motivates",
  "reveals",
  "requires",
  "depends_on",
  "prevents",
  "resolves",
];

/**
 * Which way influence runs along an edge.
 *
 * The writer states the relation the way they would say it out loud — *the
 * confrontation **requires** the letter* — but influence flows the other way:
 * the letter is upstream, the confrontation downstream. Storing the sentence as
 * written and normalising the direction here means the writer never has to
 * think backwards, and every traversal still runs on one consistent arrow.
 */
export type Influence = "forward" | "backward";

export interface DependencyKindInfo {
  readonly kind: DependencyKind;
  /** Reads as `${from} ${verb} ${to}` — the sentence the writer wrote. */
  readonly verb: string;
  /**
   * The same relation read along the influence arrow, `${cause} ${arrowVerb}
   * ${effect}`. For a backward kind this is the passive form, so a traced path
   * always reads forwards even when the edge was written backwards.
   */
  readonly arrowVerb: string;
  /** `forward`: from influences to. `backward`: to influences from. */
  readonly influence: Influence;
  readonly description: string;
}

export const DEPENDENCY_KIND_INFO: Readonly<Record<DependencyKind, DependencyKindInfo>> = {
  causes: {
    kind: "causes",
    verb: "causes",
    arrowVerb: "causes",
    influence: "forward",
    description: "The first brings the second about.",
  },
  enables: {
    kind: "enables",
    verb: "enables",
    arrowVerb: "enables",
    influence: "forward",
    description: "The first makes the second possible without forcing it.",
  },
  motivates: {
    kind: "motivates",
    verb: "motivates",
    arrowVerb: "motivates",
    influence: "forward",
    description: "The first gives someone a reason for the second.",
  },
  reveals: {
    kind: "reveals",
    verb: "reveals",
    arrowVerb: "reveals",
    influence: "forward",
    description: "The first puts the second in front of someone.",
  },
  requires: {
    kind: "requires",
    verb: "requires",
    arrowVerb: "is required by",
    influence: "backward",
    description: "The first cannot happen unless the second already has.",
  },
  depends_on: {
    kind: "depends_on",
    verb: "depends on",
    arrowVerb: "is depended on by",
    influence: "backward",
    description: "The first rests on the second in some way the author knows.",
  },
  prevents: {
    kind: "prevents",
    verb: "prevents",
    arrowVerb: "prevents",
    influence: "forward",
    description: "The first stops the second from happening.",
  },
  resolves: {
    kind: "resolves",
    verb: "resolves",
    arrowVerb: "resolves",
    influence: "forward",
    description: "The first settles the second.",
  },
};

/**
 * The entity kinds that may be endpoints of a dependency.
 *
 * Locations and world rules are absent on purpose: a place does not cause
 * anything, and a rule constrains the story rather than participating in its
 * chain of events. Letting them in would fill the graph with edges nobody would
 * act on.
 */
export const DEPENDENCY_NODE_KINDS: readonly EntityKind[] = [
  "scene",
  "event",
  "fact",
  "plot_thread",
  "setup",
  "decision",
  "object",
  "character",
];

export function isDependencyNode(id: string): boolean {
  const kind = entityKindOf(id);
  return kind !== null && DEPENDENCY_NODE_KINDS.includes(kind);
}

/**
 * Whether a dependency is the author's or a model's, and whether it has been
 * accepted.
 *
 * The same three-state boundary that governs story state: only `confirmed`
 * edges are part of the graph, so a model's guess at causality never quietly
 * becomes the structure a refactor is planned against (AGENTS.md — "Canon vs
 * Inference").
 */
export type DependencyStatus = "confirmed" | "proposed" | "rejected";
export const DEPENDENCY_STATUSES: readonly DependencyStatus[] = [
  "confirmed",
  "proposed",
  "rejected",
];

export type DependencySource = "human" | "agent" | "import";
export const DEPENDENCY_SOURCES: readonly DependencySource[] = ["human", "agent", "import"];

/** One registered cause-and-effect link. */
export interface Dependency {
  readonly id: string;
  readonly kind: DependencyKind;
  /** The subject of the sentence. */
  readonly fromId: string;
  /** Its object. */
  readonly toId: string;
  /** Why the author says this holds. Required of a model; optional for a human. */
  readonly description?: string;
  readonly status: DependencyStatus;
  readonly source: DependencySource;
  /** The model's stated evidence, when a model proposed it. */
  readonly evidence?: string;
  readonly modelId?: string;
  readonly createdAt: string;
}

/** The direction influence actually runs, whatever the sentence says. */
export function influenceOf(dependency: { kind: DependencyKind; fromId: string; toId: string }): {
  readonly causeId: string;
  readonly effectId: string;
} {
  return DEPENDENCY_KIND_INFO[dependency.kind].influence === "forward"
    ? { causeId: dependency.fromId, effectId: dependency.toId }
    : { causeId: dependency.toId, effectId: dependency.fromId };
}

/** The dependency as the writer wrote it. */
export function describeDependency(
  dependency: { kind: DependencyKind; fromId: string; toId: string },
  label: (id: string) => string = (id) => id,
): string {
  return `${label(dependency.fromId)} ${DEPENDENCY_KIND_INFO[dependency.kind].verb} ${label(dependency.toId)}`;
}

export function isDependencyKind(value: unknown): value is DependencyKind {
  return typeof value === "string" && (DEPENDENCY_KINDS as readonly string[]).includes(value);
}
