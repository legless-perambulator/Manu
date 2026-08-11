import type { OutputSchema } from "@jellytind/model-router";
import { AgentError } from "./errors";

/**
 * A grounded agent answer.
 *
 * The shape enforces the canon/inference boundary (AGENTS.md — "Canon vs
 * Inference"): retrieved project information and model interpretation are
 * separate fields, so the UI can render them differently and a reader is never
 * left guessing which is which. `findings` must cite the tool-retrieved sources
 * they came from; `interpretation` is explicitly the model's reading and is not
 * canon.
 */
export interface Finding {
  /** A statement drawn from retrieved project content. */
  readonly statement: string;
  /** Entity IDs and/or file paths this statement came from. */
  readonly sources: readonly string[];
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
 * Schema for the final answer. Validated before display, so a malformed model
 * response surfaces as a typed failure instead of a half-rendered answer — and,
 * because this phase is read-only, it can never touch project state either way
 * (AGENTS.md — "Structured LLM Output").
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
Every finding must come from a tool result you actually received, and its sources must be the entity IDs or file paths those results came from. Do not invent IDs. If the tools returned nothing relevant, say so in "summary" and leave "findings" empty.`;
