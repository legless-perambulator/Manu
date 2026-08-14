import type { OutputSchema } from "@jellytind/model-router";
import { AgentError } from "./errors";
import type { EvidenceLedger, SourceVerdict } from "./evidence";

/**
 * A grounded agent answer.
 *
 * The shape enforces the canon/inference boundary (AGENTS.md — "Canon vs
 * Inference"): retrieved project information and model interpretation are
 * separate fields, so the UI can render them differently and a reader is never
 * left guessing which is which. `findings` must cite the tool-retrieved sources
 * they came from; `interpretation` is explicitly the model's reading and is not
 * canon.
 *
 * The citations are **checked**, not requested. See `evidence.ts`: a finding's
 * sources are compared against the handles the executor recorded from real tool
 * results, and one that names nothing retrieved is never presented as though it
 * were (MANU-007).
 */
export interface Finding {
  /** A statement drawn from retrieved project content. */
  readonly statement: string;
  /** Entity IDs and/or file paths this statement came from. */
  readonly sources: readonly string[];
  /**
   * Evidence handle IDs for the sources that checked out.
   *
   * Populated by {@link groundAnswer}; empty until the answer has been
   * grounded, which is why nothing should render a finding straight from the
   * schema.
   */
  readonly evidence: readonly string[];
  /** Cited sources that name nothing the tools returned. */
  readonly unverified: readonly string[];
  /**
   * True only when every cited source resolved **and** there was at least one.
   *
   * An uncited finding is not grounded either. It may well be true, but the
   * product's whole claim is that what it shows as project fact came from the
   * project.
   */
  readonly grounded: boolean;
}

export interface AgentAnswer {
  /** One or two sentences answering the question. */
  readonly summary: string;
  /** What the project actually says, with sources. */
  readonly findings: readonly Finding[];
  /** The model's reading of the findings. Not canon. */
  readonly interpretation: string;
  /** What could not be determined from the project. */
  readonly uncertainties: readonly string[];
}

/** One rejected citation, kept so the repair prompt can be specific. */
export interface SourceProblem {
  readonly findingIndex: number;
  readonly statement: string;
  readonly source: string;
  readonly verdict: Exclude<SourceVerdict, "verified">;
}

/** What grounding found, for the UI and for the bounded repair loop. */
export interface GroundingReport {
  readonly answer: AgentAnswer;
  readonly problems: readonly SourceProblem[];
  /** Findings with no sources at all, by index. */
  readonly uncited: readonly number[];
  readonly groundedFindings: number;
  readonly totalFindings: number;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new AgentError("invalid_output", `AgentAnswer: "${field}" must be a string.`);
  }
  return value;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new AgentError("invalid_output", `AgentAnswer: "${field}" must be an array of strings.`);
  }
  return value as string[];
}

/**
 * Schema for the final answer.
 *
 * Shape only. Whether the citations mean anything is a separate question with a
 * separate answer — {@link groundAnswer} — because the two failures want
 * different handling: a malformed response is a provider problem to fail on, an
 * ungrounded one is a model problem to repair or disclose.
 */
export const AGENT_ANSWER_SCHEMA: OutputSchema<AgentAnswer> = {
  name: "AgentAnswer",
  parse(value: unknown): AgentAnswer {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new AgentError("invalid_output", "AgentAnswer: expected an object.");
    }
    const raw = value as Record<string, unknown>;
    const rawFindings = raw.findings;
    if (!Array.isArray(rawFindings)) {
      throw new AgentError("invalid_output", 'AgentAnswer: "findings" must be an array.');
    }
    const findings: Finding[] = rawFindings.map((entry, i) => {
      if (typeof entry !== "object" || entry === null) {
        throw new AgentError("invalid_output", `AgentAnswer: finding ${i} must be an object.`);
      }
      const f = entry as Record<string, unknown>;
      return {
        statement: asString(f.statement, `findings[${i}].statement`),
        sources: asStringArray(f.sources ?? [], `findings[${i}].sources`),
        // Grounding has not run yet. Nothing may present a finding as sourced
        // until it has, and these defaults make an ungrounded one look exactly
        // as unverified as it is.
        evidence: [],
        unverified: [],
        grounded: false,
      };
    });

    return {
      summary: asString(raw.summary, "summary"),
      findings,
      interpretation: asString(raw.interpretation ?? "", "interpretation"),
      uncertainties: asStringArray(raw.uncertainties ?? [], "uncertainties"),
    };
  },
};

/**
 * Check every citation against what the tools actually returned.
 *
 * Nothing is thrown and nothing is deleted: a finding whose sources do not
 * resolve keeps its statement and is marked `grounded: false` with the offending
 * sources listed. Deleting it would hide that the model made something up,
 * which is precisely the information a reader needs.
 */
export function groundAnswer(answer: AgentAnswer, ledger: EvidenceLedger): GroundingReport {
  const problems: SourceProblem[] = [];
  const uncited: number[] = [];

  const findings = answer.findings.map((finding, index) => {
    const evidence: string[] = [];
    const unverified: string[] = [];

    for (const source of finding.sources) {
      const verdict = ledger.verdict(source);
      if (verdict === "verified") {
        // `resolve` cannot be undefined here: `verified` means it is present.
        evidence.push(ledger.resolve(source)?.id ?? source);
      } else {
        unverified.push(source);
        problems.push({ findingIndex: index, statement: finding.statement, source, verdict });
      }
    }

    if (finding.sources.length === 0) uncited.push(index);

    return {
      ...finding,
      evidence,
      unverified,
      grounded: unverified.length === 0 && evidence.length > 0,
    };
  });

  return {
    answer: { ...answer, findings },
    problems,
    uncited,
    groundedFindings: findings.filter((f) => f.grounded).length,
    totalFindings: findings.length,
  };
}

/** The JSON shape asked of the model, kept beside the schema that validates it. */
export const ANSWER_FORMAT_INSTRUCTIONS = `Reply with JSON only, matching:
{
  "summary": "one or two sentences answering the question",
  "findings": [
    { "statement": "something the project actually says", "sources": ["SCENE_0012", "manuscript/CHAPTER_0002.md"] }
  ],
  "interpretation": "your reading of those findings, clearly not presented as project canon",
  "uncertainties": ["anything the project does not settle"]
}
Every finding must come from a tool result you actually received, and its sources must be the exact entity IDs or file paths those results contained. Citations are checked against what the tools returned: an ID that was never retrieved will be rejected and shown to the writer as unverified. If the tools returned nothing relevant, say so in "summary" and leave "findings" empty.`;

/**
 * The follow-up sent when citations did not check out.
 *
 * One bounded retry, and it is specific: the model is told exactly which
 * sources were rejected and exactly what it is allowed to cite. A vague "try
 * again" invites the same invention a second time.
 */
export function repairInstructions(
  problems: readonly SourceProblem[],
  available: readonly string[],
): string {
  const rejected = problems
    .map(
      (p) =>
        `- "${p.source}" (${p.verdict === "unknown" ? "never returned by any tool" : "not a valid ID or file path"}) cited for: ${p.statement}`,
    )
    .join("\n");
  const allowed = available.length === 0 ? "(nothing was retrieved)" : available.join(", ");

  return `Some citations were rejected:\n${rejected}\n\nYou may only cite these, which the tools actually returned:\n${allowed}\n\nRewrite the answer in the same JSON shape. Drop or re-source any finding you cannot support. Do not invent an ID to satisfy this instruction — a finding with no honest source belongs in "uncertainties".`;
}
