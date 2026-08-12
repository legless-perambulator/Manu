import type { OutputSchema } from "@jellytind/model-router";
import { EditError, type ModelProposal } from "./types";

/**
 * The schema every editing model call must satisfy.
 *
 * Prose comes back as a structured value rather than raw text so it is
 * validated before it can reach a file, and so the model can report its
 * reasoning-free rationale and any continuity concerns separately from the prose
 * itself (AGENTS.md — "Structured LLM Output").
 */
export const PROPOSAL_SCHEMA: OutputSchema<ModelProposal> = {
  name: "ManuscriptEdit",
  parse(value: unknown): ModelProposal {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new EditError("empty_response", "ManuscriptEdit: expected an object.");
    }
    const raw = value as Record<string, unknown>;
    if (typeof raw.text !== "string") {
      throw new EditError("empty_response", 'ManuscriptEdit: "text" must be a string.');
    }
    const warnings = raw.warnings ?? [];
    if (!Array.isArray(warnings) || warnings.some((w) => typeof w !== "string")) {
      throw new EditError("empty_response", 'ManuscriptEdit: "warnings" must be strings.');
    }
    return {
      text: raw.text,
      rationale: typeof raw.rationale === "string" ? raw.rationale : "",
      warnings: warnings as string[],
    };
  },
};

export const RESPONSE_FORMAT = `Reply with JSON only, matching:
{
  "text": "the replacement prose, exactly as it should appear in the manuscript",
  "rationale": "one or two sentences on what you changed and why",
  "warnings": ["any continuity or consistency concern you noticed but did not fix"]
}
"text" is manuscript prose, not commentary: no headings, no notes to the author, no markdown fences. Do not restate the instruction. Preserve the project's existing voice and tense.`;

/**
 * Deterministic checks the schema cannot express, applied before anything is
 * staged. Malformed or degenerate output is refused here rather than surfacing
 * as a baffling diff.
 */
export function validateProposalText(
  proposed: string,
  original: string,
  options: { operation: string; maxGrowthFactor?: number },
): string {
  const text = proposed.replace(/^\s*```[a-z]*\n?/i, "").replace(/```\s*$/, "");
  const trimmed = text.trim();

  if (trimmed === "") {
    throw new EditError("empty_response", "The model returned no prose.", {
      details: { operation: options.operation },
    });
  }
  if (original !== "" && trimmed === original.trim()) {
    throw new EditError("no_change", "The model returned the original text unchanged.", {
      details: { operation: options.operation },
    });
  }

  // A runaway response usually means the model ignored the target and rewrote
  // far more than it was asked to. Refuse rather than stage a huge diff.
  const factor = options.maxGrowthFactor ?? 12;
  const baseline = Math.max(original.length, 400);
  if (trimmed.length > baseline * factor) {
    throw new EditError(
      "runaway_response",
      `The model returned ${String(trimmed.length)} characters for a ${String(
        original.length,
      )}-character target, which is far beyond what this operation should produce.`,
      { details: { operation: options.operation, produced: trimmed.length } },
    );
  }

  return text.trim();
}
