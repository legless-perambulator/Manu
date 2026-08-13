/**
 * The vocabulary of a character simulation.
 *
 * The question is never "what would this character say?" but "would this
 * character *do* this, here, knowing what they know now?" — which is a question
 * about a specific point in the story, answered from what the project records
 * about them at that point and nothing later (docs/SIMULATIONS.md).
 */

/**
 * The dimensions of an author-confirmed personality.
 *
 * Deliberately not a personality test. These are the things that decide
 * behaviour under pressure, in the author's own words — and every one is
 * optional, because a character the author has not finished inventing is a
 * character with gaps, and the simulator should say so rather than fill them.
 */
export const PERSONALITY_DIMENSIONS = [
  "values",
  "fears",
  "temperament",
  "moral_lines",
  "under_pressure",
  "attachments",
  "blind_spots",
  "competence",
  "self_image",
  "risk_appetite",
] as const;
export type PersonalityDimension = (typeof PERSONALITY_DIMENSIONS)[number];

/**
 * Where a trait came from, and whether the author has agreed to it.
 *
 * **Only confirmed traits reach a simulation.** A model's reading of a
 * character, fed back in as that character's personality, would make every
 * answer agree with the model's own guess (docs/AUTHOR_VOICE.md — the same
 * discipline as inferred voice tendencies).
 */
export const TRAIT_STATUSES = ["confirmed", "proposed", "rejected"] as const;
export type TraitStatus = (typeof TRAIT_STATUSES)[number];

export interface PersonalityTrait {
  readonly id: string;
  readonly characterId: string;
  readonly dimension: PersonalityDimension;
  /** The trait itself, e.g. "will not leave someone behind, ever". */
  readonly statement: string;
  readonly status: TraitStatus;
  /** Where a proposed trait came from — a scene, a passage, a model's reading. */
  readonly evidence?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Something the project records that bears on the proposed action. */
export interface BehaviourFactor {
  readonly statement: string;
  readonly detail?: string;
  /** Which recorded system this came from — or the model, when it is a reading. */
  readonly source: string;
  readonly sceneIds?: readonly string[];
  readonly entities?: readonly string[];
  /** `deterministic` when the project records it; `model` when it is a reading. */
  readonly derivation: "deterministic" | "model";
}

/**
 * A conflict between the proposed action and something recorded.
 *
 * `hard` means the project contradicts the action outright — she is not in this
 * location, she does not hold the fact the action turns on, she is recorded
 * dead. Those are checkable. `soft` is a tension a reader might feel, which is
 * a judgement and is labelled as one.
 */
export interface Contradiction {
  readonly kind: "hard" | "soft";
  readonly statement: string;
  readonly detail?: string;
  readonly derivation: "deterministic" | "model";
  readonly entities?: readonly string[];
}

/**
 * How well the action sits with the character, as a band.
 *
 * **Never a percentage.** "Behavioural plausibility: 24%" is a number with no
 * defined error, no population and no instrument — it would look like science
 * and mean nothing. A band with its reasoning is the honest form, and the
 * counts behind it are reported separately as counts
 * (AGENTS.md — "measurement is not judgement").
 */
export const PLAUSIBILITY_BANDS = [
  "out_of_character",
  "strained",
  "plausible",
  "characteristic",
] as const;
export type PlausibilityBand = (typeof PLAUSIBILITY_BANDS)[number];

export function describePlausibility(band: PlausibilityBand): string {
  switch (band) {
    case "out_of_character":
      return "Out of character";
    case "strained":
      return "Strained — possible, but it costs something";
    case "plausible":
      return "Plausible";
    case "characteristic":
      return "Characteristic — this is who they are";
  }
}

/** A change to the story that would make the action sit better. Advisory. */
export interface NarrativeCondition {
  readonly statement: string;
  readonly rationale?: string;
  /** What it would cost elsewhere, when the model names one. */
  readonly cost?: string;
}

export interface CharacterJudgement {
  readonly band: PlausibilityBand;
  readonly statement: string;
  readonly reasoning: string;
  /** What would change this answer. A judgement with none is not a judgement. */
  readonly uncertainty: readonly string[];
  readonly modelId: string;
}

/** The seven sections the behaviour test returns. */
export interface BehaviourTest {
  readonly characterId: string;
  readonly characterName: string;
  readonly sceneId: string;
  readonly proposedAction: string;
  /** What the project records that bears on this. Deterministic. */
  readonly established: readonly BehaviourFactor[];
  readonly supporting: readonly BehaviourFactor[];
  readonly opposing: readonly BehaviourFactor[];
  readonly contradictions: readonly Contradiction[];
  /** Absent when no model ran. The deterministic half still stands. */
  readonly judgement?: CharacterJudgement;
  readonly conditions: readonly NarrativeCondition[];
  /** Counts, stated as counts. Not a probability, not a score out of anything. */
  readonly counts: {
    readonly supporting: number;
    readonly opposing: number;
    readonly hardContradictions: number;
  };
  readonly basis: string;
  /** What could not be checked, and why. Silence is not a claim. */
  readonly notChecked: readonly string[];
  readonly createdAt: string;
}

/** What the character would plausibly do instead. Advisory; nothing is applied. */
export interface Counterfactual {
  readonly characterId: string;
  readonly sceneId: string;
  readonly alternatives: ReadonlyArray<{
    readonly action: string;
    readonly because: string;
    readonly band: PlausibilityBand;
  }>;
  readonly caveat: string;
  readonly modelId?: string;
}

/** A place where someone appears to act because the plot needs them to. */
export interface AgencyFinding {
  readonly sceneId: string;
  readonly characterId: string;
  /** What the project shows, in one line. */
  readonly statement: string;
  readonly detail?: string;
  readonly derivation: "deterministic" | "model";
  readonly kind:
    | "acts_on_unknown_information"
    | "no_recorded_goal"
    | "decision_without_reason"
    | "moved_without_reason"
    | "reads_as_plot_driven";
}

export const AGENCY_CAVEAT =
  "Whether a character is acting for their own reasons or the plot's is a reading, not a measurement. The deterministic findings say what the project records; the rest is model judgement.";

export const SIMULATION_ADVISORY =
  "Advisory only. Nothing here has changed the story, and no alternative has been applied.";

/** Where the plausibility band lands from what was found. Heuristic, and named so. */
export function heuristicBand(counts: BehaviourTest["counts"]): PlausibilityBand {
  if (counts.hardContradictions > 0) return "out_of_character";
  if (counts.opposing > counts.supporting) return "strained";
  if (counts.supporting > counts.opposing) return "characteristic";
  return "plausible";
}
