import { AppError } from "@jellytind/shared";
import type {
  AgencyFinding,
  BehaviourFactor,
  CharacterJudgement,
  Contradiction,
  NarrativeCondition,
  PlausibilityBand,
} from "@jellytind/domain";
import type { CharacterSnapshot } from "./snapshot";

export type CharacterSimErrorCode =
  "unknown_character" | "unknown_scene" | "no_action" | "no_analyst";

export class CharacterSimError extends AppError {
  constructor(
    code: CharacterSimErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(code, message, options);
  }
}

/**
 * The semantic half, as a port.
 *
 * The simulator compiles the character and finds every contradiction a program
 * can check. What it cannot do is read a proposed action against a personality
 * — that is a judgement, and it is asked for here, from an implementation above
 * (`@jellytind/editing`).
 *
 * With no analyst, the behaviour test still runs and still returns its
 * established factors and its hard contradictions. It simply carries no
 * judgement, and says so (docs/SIMULATIONS.md).
 */
export interface CharacterAnalyst {
  readonly modelId: string;

  /** Read a proposed action against the character as compiled. */
  weigh(request: {
    snapshot: CharacterSnapshot;
    briefing: string;
    proposedAction: string;
    /** What the deterministic half already found, so the model does not repeat it. */
    established: readonly BehaviourFactor[];
    hardContradictions: readonly Contradiction[];
  }): Promise<{
    supporting: readonly BehaviourFactor[];
    opposing: readonly BehaviourFactor[];
    contradictions: readonly Contradiction[];
    judgement: Omit<CharacterJudgement, "modelId"> | null;
    conditions: readonly NarrativeCondition[];
  }>;

  /** What they would most plausibly do instead. Advisory. */
  alternatives(request: {
    snapshot: CharacterSnapshot;
    briefing: string;
    proposedAction: string;
    limit: number;
  }): Promise<ReadonlyArray<{ action: string; because: string; band: PlausibilityBand }>>;

  /** Whether a scene reads as the character serving the plot. */
  readAgency(request: {
    briefing: string;
    /** The candidates the deterministic pass found, so it does not repeat them. */
    candidates: readonly AgencyFinding[];
    limit: number;
  }): Promise<ReadonlyArray<{ sceneId: string; statement: string; detail?: string }>>;
}
