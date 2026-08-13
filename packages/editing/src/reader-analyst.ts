import { READER_LEVELS, READER_QUESTIONS, levelOf } from "@jellytind/domain";
import type { ReaderAttitude, ReaderReading, ReaderState } from "@jellytind/domain";
import type { LanguageModel, OutputSchema } from "@jellytind/model-router";
import type { ReaderAnalyst, ReaderPacket } from "@jellytind/reader-sim";
import { EditError } from "./types";

/**
 * The reader, as a model call.
 *
 * Everything that guarantees this reader has not seen the future happens
 * *before* this file: the simulator builds a packet from the sequential recipe,
 * and the packet is all the model gets. Nothing here fetches anything.
 *
 * What this adds is the reader's disposition — their traits, and the state they
 * are carrying from the last chapter — and the ten questions. It asks for an
 * ordinary reader's answers, not an editor's: a reader who says "I didn't
 * understand chapter four" is giving the writer the most useful sentence in the
 * report, and a model asked to be helpful will suppress it.
 */
const SYSTEM_PROMPT = `You are simulating one reader of an unfinished novel, inside Manu, a fiction development environment.

You have read the book up to and including the chapter you are given. You have NOT read past it. You do not know what happens next, you have not been told the author's intentions, and you have not seen any notes, character sheets or plans — only the pages.

Rules:
- Answer as a reader, not as an editor or a critic hired to be constructive. If a chapter bored you, say it bored you.
- Everything you believe must come from the pages you have read. Do not resolve a mystery you have not been given the pieces for.
- You are allowed to be wrong. A wrong prediction is a useful answer; a hedged non-answer is not.
- Carry your previous state forward. You are the person who read the last chapter, not a fresh reader handed a summary.
- Name people the way the book names them. Where the text gives an ID, use it.
- Be brief. One or two sentences per answer.`;

interface RawReading {
  readonly [field: string]: unknown;
}

const READING_SCHEMA: OutputSchema<RawReading> = {
  name: "ReaderReading",
  parse(value: unknown): RawReading {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new EditError("empty_response", "ReaderReading: expected a JSON object.");
    }
    return value as RawReading;
  },
};

const FORMAT = `Reply with JSON only, matching:
{
  "understanding": "what you think is happening, in one or two sentences",
  "known": ["things you now take to be true about the story"],
  "remembered": ["details that stuck with you, whether or not they seemed important"],
  "suspicions": [{ "subject": "who or what", "level": "${READER_LEVELS.join(" | ")}", "because": "what put it there" }],
  "trust": [{ "subject": "who", "level": "${READER_LEVELS.join(" | ")}", "because": "why" }],
  "attachment": [{ "subject": "who", "level": "${READER_LEVELS.join(" | ")}", "because": "why" }],
  "predictions": ["what you think will happen"],
  "questions": ["what you are still asking"],
  "confusedBy": ["what you did not follow"],
  "bored": ["what you skimmed or lost interest in"],
  "interested": ["what kept you reading"],
  "emotionalMoments": ["moments that landed, and what they did"],
  "confusion": "${READER_LEVELS.join(" | ")}",
  "interest": "${READER_LEVELS.join(" | ")}",
  "emotionalResponse": "how you feel at this point, in one line"
}
Empty lists are valid answers. So is "none".`;

export interface ModelReaderAnalystOptions {
  readonly model: LanguageModel;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
}

export class ModelReaderAnalyst implements ReaderAnalyst {
  readonly modelId: string;
  private readonly model: LanguageModel;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;

  constructor(options: ModelReaderAnalystOptions) {
    this.model = options.model;
    this.modelId = options.model.id;
    this.maxOutputTokens = options.maxOutputTokens ?? 2_000;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  async read(
    packet: ReaderPacket,
  ): Promise<Omit<ReaderReading, "exposure" | "fingerprint" | "createdAt">> {
    const raw = await this.model.generateStructured(
      {
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: `WHO YOU ARE\n${describeReader(packet)}` },
          ...(packet.exposure.position > 1
            ? [
                {
                  role: "user" as const,
                  content: `WHERE YOU LEFT OFF\n${describeState(packet.state)}`,
                },
              ]
            : []),
          { role: "user", content: packet.pages },
          {
            role: "user",
            content: `You have just finished ${packet.exposure.chapterTitle} (chapter ${String(packet.exposure.position)}). Answer these:\n\n${READER_QUESTIONS.map((question) => `- ${question}`).join("\n")}\n\n${FORMAT}`,
          },
        ],
        schema: READING_SCHEMA,
        maxOutputTokens: this.maxOutputTokens,
      },
      { timeoutMs: this.timeoutMs },
    );

    const understanding = text(raw.understanding);
    if (understanding === "") {
      throw new EditError("empty_response", "The reader returned no answer for this chapter.");
    }

    return {
      chapterId: packet.exposure.chapterId,
      position: packet.exposure.position,
      understanding,
      bored: strings(raw.bored),
      interested: strings(raw.interested),
      confusedBy: strings(raw.confusedBy),
      emotionalMoments: strings(raw.emotionalMoments),
      state: {
        known: strings(raw.known),
        remembered: strings(raw.remembered),
        suspicions: attitudes(raw.suspicions),
        trust: attitudes(raw.trust),
        attachment: attitudes(raw.attachment),
        predictions: strings(raw.predictions),
        questions: strings(raw.questions),
        confusion: levelOf(raw.confusion),
        interest: levelOf(raw.interest),
        emotionalResponse: text(raw.emotionalResponse),
      },
      modelId: this.model.id,
    };
  }
}

/** Who this reader is — traits, not a costume. */
function describeReader(packet: ReaderPacket): string {
  return [
    `${packet.profile.name}: ${packet.profile.description}`,
    ...packet.profile.traits.map((trait) => `- ${trait}`),
  ].join("\n");
}

/**
 * The reader's own state, handed back to them.
 *
 * Deliberately written as *their* beliefs rather than as facts: "you suspect"
 * and "you think", so a wrong belief carried from chapter three stays a belief
 * rather than hardening into something the reader treats as established.
 */
function describeState(state: ReaderState): string {
  const lines: string[] = [];
  if (state.known.length > 0) lines.push(`You believe: ${state.known.join("; ")}`);
  if (state.remembered.length > 0) lines.push(`You remember: ${state.remembered.join("; ")}`);
  for (const entry of state.suspicions) {
    lines.push(`You are ${entry.level} suspicious of ${entry.subject}${reason(entry)}`);
  }
  for (const entry of state.trust) {
    lines.push(`Your trust in ${entry.subject} is ${entry.level}${reason(entry)}`);
  }
  for (const entry of state.attachment) {
    lines.push(`Your attachment to ${entry.subject} is ${entry.level}${reason(entry)}`);
  }
  if (state.predictions.length > 0) lines.push(`You expect: ${state.predictions.join("; ")}`);
  if (state.questions.length > 0) lines.push(`You are asking: ${state.questions.join("; ")}`);
  lines.push(`Interest: ${state.interest}. Confusion: ${state.confusion}.`);
  if (state.emotionalResponse !== "") lines.push(`You felt: ${state.emotionalResponse}`);
  return lines.join("\n");
}

const reason = (entry: ReaderAttitude): string =>
  entry.because === undefined ? "" : ` — ${entry.because}`;

// ── Coercion: model output is untrusted ──────────────────────────────────────

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];

function attitudes(value: unknown): ReaderAttitude[] {
  if (!Array.isArray(value)) return [];
  const out: ReaderAttitude[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const subject = text(raw.subject);
    // An attitude about nobody is not an attitude.
    if (subject === "") continue;
    out.push({
      subject,
      level: levelOf(raw.level),
      ...(text(raw.because) === "" ? {} : { because: text(raw.because) }),
    });
  }
  return out;
}
