import type { LanguageModel, OutputSchema } from "@jellytind/model-router";
import { EditError } from "./types";
import type { VoiceCategory, VoiceSample, VoiceSampleId } from "@jellytind/domain";
import { VOICE_CATEGORIES, isNegativeEvidence, isPositiveEvidence } from "@jellytind/domain";

/**
 * The model-driven half of the Author Voice system.
 *
 * The deterministic half — storage, retrieval by operation, and checking prose
 * against rules that carry a pattern — lives in the repository and runs with no
 * model at all. This half reads prose and offers a reading, and everything it
 * produces is labelled INFERRED, carries the evidence it rests on, and arrives
 * as a proposal the writer confirms, edits or rejects.
 *
 * It never writes to the profile. It returns drafts (docs/AUTHOR_VOICE.md).
 */

export interface TendencyDraft {
  readonly category: VoiceCategory;
  readonly statement: string;
  readonly evidenceSampleIds: readonly VoiceSampleId[];
  readonly evidence: string;
  readonly confidence: "low" | "medium" | "high";
}

/** How many rejections must share a trait before it is worth mentioning. */
export const REJECTION_PATTERN_THRESHOLD = 3;

export interface RejectionInsight {
  readonly observation: string;
  readonly possiblePreference: string;
  readonly category: VoiceCategory;
  readonly evidenceSampleIds: readonly VoiceSampleId[];
  readonly evidence: string;
}

const SYSTEM_PROMPT = `You are the Author Voice analyst inside Manu, a fiction development environment.

You are shown passages a writer has explicitly marked as representative of how
they want to write, or as prose they rejected. You describe what you observe.

Rules:
- Describe tendencies, do not prescribe. "Dialogue tends to use contractions
  heavily" — not "use more contractions".
- Every observation must be supported by the passages you were given. If you
  cannot point to them, do not make the observation.
- Say nothing rather than pad. Three real observations beat ten vague ones.
- Never comment on the quality of the writing. You are describing a style, not
  grading it.
- You are not deciding anything. The writer confirms, edits or rejects
  everything you say.`;

const PASSTHROUGH = (name: string): OutputSchema<unknown> => ({
  name,
  parse(value: unknown): unknown {
    if (typeof value !== "object" || value === null) {
      throw new EditError("empty_response", `${name}: expected an object.`);
    }
    return value;
  },
});

const TENDENCY_FORMAT = `Reply with JSON only, matching:
{ "tendencies": [ { "category": "dialogue", "statement": "...", "confidence": "low | medium | high", "passages": [1, 4, 9] } ] }`;

const REJECTION_FORMAT = `Reply with JSON only, matching:
{ "patterns": [ { "category": "interiority", "observation": "...", "possiblePreference": "...", "passages": [1, 2, 5] } ] }`;

export class VoiceAnalyst {
  constructor(private readonly model: LanguageModel) {}

  /**
   * Read the writer's chosen passages and describe what recurs.
   *
   * Only passages the writer assessed are used. Prose that merely exists in the
   * project says nothing about intent — a manuscript is full of first drafts.
   */
  async inferTendencies(samples: readonly VoiceSample[]): Promise<TendencyDraft[]> {
    const positive = samples.filter((s) => isPositiveEvidence(s.stance));
    if (positive.length === 0) return [];

    const raw = await this.model.generateStructured(
      {
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              `${String(positive.length)} passage(s) the writer marked as representative of the voice they want:`,
              "",
              ...positive.map((s, i) => `[${String(i + 1)}] (${s.stance})\n${s.text}`),
              "",
              `Describe recurring tendencies. Categories: ${VOICE_CATEGORIES.join(", ")}.`,
              "",
              TENDENCY_FORMAT,
            ].join("\n"),
          },
        ],
        schema: PASSTHROUGH("VoiceTendencies"),
      },
      { timeoutMs: 120_000 },
    );

    return parseTendencies(raw, positive);
  }

  /**
   * Look at what a writer has rejected and ask whether there is a pattern.
   *
   * **Not from every rejection.** A writer rejects prose for a hundred reasons —
   * it was wrong about the plot, it was fine but not now, they changed their
   * mind. Inferring a style rule from a single "no" would fill the profile with
   * noise the writer then has to clean up. A pattern needs to repeat before it
   * is worth their attention, and even then it arrives as a question.
   */
  async learnFromRejections(samples: readonly VoiceSample[]): Promise<RejectionInsight[]> {
    const rejected = samples.filter((s) => isNegativeEvidence(s.stance));
    if (rejected.length < REJECTION_PATTERN_THRESHOLD) return [];

    const raw = await this.model.generateStructured(
      {
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              `${String(rejected.length)} passage(s) the writer rejected:`,
              "",
              ...rejected.map((s, i) => {
                const note = s.note !== undefined ? `\nWriter's note: ${s.note}` : "";
                return `[${String(i + 1)}]\n${s.text}${note}`;
              }),
              "",
              "Is there a trait shared by several of these? Only report a trait that",
              `appears in at least ${String(REJECTION_PATTERN_THRESHOLD)} of them. If there is no such`,
              "pattern, return an empty list — that is the expected answer most of the time.",
              "",
              REJECTION_FORMAT,
            ].join("\n"),
          },
        ],
        schema: PASSTHROUGH("RejectionPatterns"),
      },
      { timeoutMs: 120_000 },
    );

    return parseRejections(raw, rejected);
  }
}

function parseTendencies(value: unknown, samples: readonly VoiceSample[]): TendencyDraft[] {
  const rows = rowsOf(value, "tendencies");
  const out: TendencyDraft[] = [];
  for (const row of rows) {
    const statement = text(row.statement);
    if (statement === "") continue;
    const ids = referencedSamples(row.passages ?? row.evidence, samples);
    out.push({
      category: category(row.category),
      statement,
      evidenceSampleIds: ids,
      evidence: `${String(ids.length > 0 ? ids.length : samples.length)} selected representative passage(s).`,
      confidence: confidence(row.confidence),
    });
  }
  return out;
}

function parseRejections(value: unknown, samples: readonly VoiceSample[]): RejectionInsight[] {
  const rows = rowsOf(value, "patterns");
  const out: RejectionInsight[] = [];
  for (const row of rows) {
    const observation = text(row.observation);
    const preference = text(row.possiblePreference);
    if (observation === "" || preference === "") continue;
    const ids = referencedSamples(row.passages ?? row.evidence, samples);
    // Hold the model to its own threshold: a "pattern" in one passage is not one.
    if (ids.length > 0 && ids.length < REJECTION_PATTERN_THRESHOLD) continue;
    out.push({
      observation,
      possiblePreference: preference,
      category: category(row.category),
      evidenceSampleIds: ids,
      evidence: `${String(ids.length > 0 ? ids.length : samples.length)} rejected passage(s).`,
    });
  }
  return out;
}

function rowsOf(value: unknown, key: string): Record<string, unknown>[] {
  if (typeof value !== "object" || value === null) return [];
  const list = (value as Record<string, unknown>)[key];
  if (!Array.isArray(list)) return [];
  return list.filter(
    (row): row is Record<string, unknown> => typeof row === "object" && row !== null,
  );
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function category(value: unknown): VoiceCategory {
  const raw = text(value).toLowerCase().replace(/\s+/g, "_");
  return (VOICE_CATEGORIES as readonly string[]).includes(raw) ? (raw as VoiceCategory) : "prose";
}

function confidence(value: unknown): "low" | "medium" | "high" {
  const raw = text(value).toLowerCase();
  return raw === "high" || raw === "medium" ? raw : "low";
}

/**
 * Map the passage numbers a model cited back to sample IDs.
 *
 * A citation that points at nothing is dropped rather than invented — the same
 * rule the Story Debugger applies to evidence it cannot find.
 */
function referencedSamples(value: unknown, samples: readonly VoiceSample[]): VoiceSampleId[] {
  const numbers: number[] = [];
  if (Array.isArray(value)) {
    for (const entry of value) {
      const n = typeof entry === "number" ? entry : Number.parseInt(String(entry), 10);
      if (Number.isFinite(n)) numbers.push(n);
    }
  } else if (typeof value === "string") {
    for (const match of value.matchAll(/\d+/g)) numbers.push(Number.parseInt(match[0], 10));
  }
  const ids: VoiceSampleId[] = [];
  for (const n of numbers) {
    const sample = samples[n - 1];
    if (sample !== undefined && !ids.includes(sample.id)) ids.push(sample.id);
  }
  return ids;
}
