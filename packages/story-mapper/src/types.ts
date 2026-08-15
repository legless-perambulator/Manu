/**
 * The vocabulary of reverse story mapping (Phase 40 Part B).
 *
 * Mapping never writes canon directly. Every extraction — deterministic or
 * model-derived — becomes a `MappingProposal` carrying qualitative confidence,
 * evidence and a status the writer controls. Applying accepted proposals is a
 * separate, explicit act (docs/STORY_MAPPING.md).
 */

export type MappingConfidence = "low" | "medium" | "high";

export interface MappingEvidence {
  readonly chapterIndex: number;
  readonly chapterTitle: string;
  /** A short quotation from the prose, when one supports the claim. */
  readonly quote?: string;
}

export type ProposalCategory =
  | "character"
  | "alias"
  | "importance"
  | "location"
  | "object"
  | "fact"
  | "scene"
  | "timeline"
  | "knowledge"
  | "relationship"
  | "thread"
  | "setup_payoff"
  | "causality"
  | "voice"
  | "character_voice"
  | "summary";

export type ProposalStatus = "proposed" | "needs_review" | "accepted" | "rejected" | "applied";

export interface MappingProposal {
  readonly id: string;
  readonly category: ProposalCategory;
  readonly status: ProposalStatus;
  readonly confidence: MappingConfidence;
  /** `deterministic` came from parsing; `model` from a model's reading. */
  readonly origin: "deterministic" | "model";
  readonly summary: string;
  readonly evidence: readonly MappingEvidence[];
  /** Category-specific structured content, used when the proposal is applied. */
  readonly payload: Readonly<Record<string, unknown>>;
}

/** One chapter of the manuscript being mapped, tied to its repo record. */
export interface MappingSourceChapter {
  readonly index: number;
  readonly chapterId: string;
  readonly title: string;
  readonly text: string;
}

export const MAPPING_STEPS = [
  "scenes",
  "characters",
  "aliases",
  "importance",
  "locations",
  "objects",
  "facts",
  "timeline",
  "knowledge",
  "relationships",
  "threads",
  "setup_payoff",
  "causality",
  "voice",
  "character_voice",
  "summaries",
  "validation",
] as const;
export type MappingStep = (typeof MAPPING_STEPS)[number];

export const STEP_LABEL: Readonly<Record<MappingStep, string>> = {
  scenes: "Scene segmentation",
  characters: "Character extraction",
  aliases: "Entity resolution",
  importance: "Character importance",
  locations: "Location extraction",
  objects: "Object extraction",
  facts: "Fact extraction",
  timeline: "Timeline reconstruction",
  knowledge: "Knowledge reconstruction",
  relationships: "Relationship reconstruction",
  threads: "Plot-thread extraction",
  setup_payoff: "Setup and payoff",
  causality: "Causality proposals",
  voice: "Author voice analysis",
  character_voice: "Character voice analysis",
  summaries: "Story summaries",
  validation: "Validation",
};

/** Which steps need a model at all. The rest are parsing. */
export const SEMANTIC_STEPS: readonly MappingStep[] = [
  "facts",
  "timeline",
  "knowledge",
  "relationships",
  "threads",
  "setup_payoff",
  "causality",
  "voice",
  "character_voice",
  "summaries",
];

export interface MappingStepRecord {
  readonly id: MappingStep;
  readonly status: "pending" | "running" | "done" | "skipped";
  readonly note?: string;
  /** Progress through the step's chunks (chapters, for semantic steps). */
  readonly chunksDone: number;
  readonly chunksTotal: number;
}

export interface MappingRun {
  readonly id: string;
  readonly status: "running" | "paused" | "completed" | "failed";
  readonly steps: readonly MappingStepRecord[];
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly error?: string;
}

/** Honest scope, shown before mapping a large manuscript (§29). */
export interface MappingScope {
  readonly words: number;
  readonly chapters: number;
  /** Model calls the semantic steps would make. An estimate, not a promise. */
  readonly estimatedOperations: number;
}
