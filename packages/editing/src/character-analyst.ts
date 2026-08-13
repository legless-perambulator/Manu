import { PLAUSIBILITY_BANDS } from "@jellytind/domain";
import type {
  AgencyFinding,
  BehaviourFactor,
  CharacterJudgement,
  Contradiction,
  NarrativeCondition,
  PlausibilityBand,
} from "@jellytind/domain";
import type { CharacterAnalyst } from "@jellytind/character-sim";
import type { LanguageModel, OutputSchema } from "@jellytind/model-router";
import { EditError } from "./types";

/**
 * The judging half of the Character Simulator.
 *
 * The simulator compiles the character at a story point and finds everything a
 * program can settle. What is left is the actual question — *does this action
 * follow from who she is?* — and that is a reading.
 *
 * Three rules shape the contract:
 *
 * - The model works from the **briefing only**. It cannot fetch anything, and
 *   the briefing has already been bounded to what the character knows.
 * - It must **not repeat** what the deterministic pass found. Restating "she is
 *   not in this location" as a considered opinion would launder a fact into a
 *   judgement.
 * - It gives a **band and its reasoning**, never a percentage. A number would
 *   be the most misleading thing on the screen (docs/SIMULATIONS.md).
 */
const SYSTEM_PROMPT = `You are reading one character for a novelist, inside Manu, a fiction development environment.

You are given that character exactly as the project records them at one point in the story: who they are, what the author has confirmed about them, what they want, what they know *at this moment*, who people are to them, what they have been through, and what is pressing on them. You are then given a proposed action.

Rules:
- Work only from the briefing. You cannot see the manuscript, and you must not assume anything the briefing says is unrecorded.
- The character knows only what the briefing says they know. If the action requires information they do not have, that is the point, not an oversight to reason around.
- Do not repeat findings you are told the project already established. Add what only a reader can see.
- Distinguish "she would not" from "she could not". Reluctance is characterisation; impossibility is a contradiction.
- Give a band and say why. Never give a percentage, a score, or a probability — you have no instrument for one.
- Say what would change your answer. A judgement with no uncertainty is not a judgement.
- Conditions are options for the writer: what would have to be true for this to sit right. Do not describe any of them as done.
- Be specific and short. A writer reads this to decide what to change.`;

interface RawWeighing {
  readonly [field: string]: unknown;
}

const SCHEMA: OutputSchema<RawWeighing> = {
  name: "CharacterWeighing",
  parse(value: unknown): RawWeighing {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new EditError("empty_response", "CharacterWeighing: expected a JSON object.");
    }
    return value as RawWeighing;
  },
};

const WEIGH_FORMAT = `Reply with JSON only, matching:
{
  "supporting": [{ "statement": "what makes this action fit", "detail": "one sentence more" }],
  "opposing": [{ "statement": "what makes it not fit", "detail": "one sentence more" }],
  "contradictions": [{ "statement": "a tension a reader would feel", "detail": "why" }],
  "judgement": {
    "band": "${PLAUSIBILITY_BANDS.join(" | ")}",
    "statement": "one sentence: would they do this?",
    "reasoning": "two or three sentences",
    "uncertainty": ["what would change this answer"]
  },
  "conditions": [
    { "statement": "what would make it more plausible", "rationale": "why", "cost": "what it would cost elsewhere" }
  ]
}
Every list may be empty. "judgement" may be null if the briefing records too little to answer.`;

export interface ModelCharacterAnalystOptions {
  readonly model: LanguageModel;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
}

export class ModelCharacterAnalyst implements CharacterAnalyst {
  readonly modelId: string;
  private readonly model: LanguageModel;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;

  constructor(options: ModelCharacterAnalystOptions) {
    this.model = options.model;
    this.modelId = options.model.id;
    this.maxOutputTokens = options.maxOutputTokens ?? 1_800;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async weigh(request: {
    briefing: string;
    proposedAction: string;
    established: readonly BehaviourFactor[];
    hardContradictions: readonly Contradiction[];
  }): Promise<{
    supporting: readonly BehaviourFactor[];
    opposing: readonly BehaviourFactor[];
    contradictions: readonly Contradiction[];
    judgement: Omit<CharacterJudgement, "modelId"> | null;
    conditions: readonly NarrativeCondition[];
  }> {
    const alreadyFound = [
      ...request.hardContradictions.map((entry) => `- CONTRADICTION: ${entry.statement}`),
      ...request.established.slice(0, 30).map((entry) => `- ${entry.statement}`),
    ].join("\n");

    const raw = await this.model.generateStructured(
      {
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: request.briefing },
          {
            role: "user",
            content: `ALREADY ESTABLISHED BY THE PROJECT — do not repeat these\n${alreadyFound}`,
          },
          {
            role: "user",
            content: `PROPOSED ACTION\n${request.proposedAction}\n\n${WEIGH_FORMAT}`,
          },
        ],
        schema: SCHEMA,
        maxOutputTokens: this.maxOutputTokens,
      },
      { timeoutMs: this.timeoutMs },
    );

    return {
      supporting: factors(raw.supporting),
      opposing: factors(raw.opposing),
      contradictions: softContradictions(raw.contradictions),
      judgement: judgementOf(raw.judgement),
      conditions: conditionsOf(raw.conditions),
    };
  }

  async alternatives(request: {
    briefing: string;
    proposedAction: string;
    limit: number;
  }): Promise<ReadonlyArray<{ action: string; because: string; band: PlausibilityBand }>> {
    const raw = await this.model.generateStructured(
      {
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: request.briefing },
          {
            role: "user",
            content: `The writer has proposed: ${request.proposedAction}\n\nWhat would this character most plausibly do instead, given only what they know and want here? Offer at most ${String(request.limit)}. These are options for the writer — do not describe any of them as what happens.\n\nReply with JSON only:\n{ "alternatives": [{ "action": "what they would do", "because": "why, from the briefing", "band": "${PLAUSIBILITY_BANDS.join(" | ")}" }] }`,
          },
        ],
        schema: SCHEMA,
        maxOutputTokens: this.maxOutputTokens,
      },
      { timeoutMs: this.timeoutMs },
    );

    const list = Array.isArray(raw.alternatives) ? raw.alternatives : [];
    const out: Array<{ action: string; because: string; band: PlausibilityBand }> = [];
    for (const entry of list) {
      if (typeof entry !== "object" || entry === null) continue;
      const item = entry as Record<string, unknown>;
      const action = text(item.action);
      if (action === "") continue;
      out.push({ action, because: text(item.because), band: bandOf(item.band) });
    }
    return out.slice(0, request.limit);
  }

  async readAgency(request: {
    briefing: string;
    candidates: readonly AgencyFinding[];
    limit: number;
  }): Promise<ReadonlyArray<{ sceneId: string; statement: string; detail?: string }>> {
    const raw = await this.model.generateStructured(
      {
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: request.briefing },
          {
            role: "user",
            content: `ALREADY FOUND BY THE PROJECT — do not repeat these\n${request.candidates
              .map((entry) => `- ${entry.statement}`)
              .join("\n")}`,
          },
          {
            role: "user",
            content: `Name scenes where this character appears to act because the story needs them to, rather than because they want something. Quote what in the scene's recorded purpose makes you say it. At most ${String(request.limit)}. If none stand out, return an empty list.\n\nReply with JSON only:\n{ "findings": [{ "sceneId": "SCENE_0012", "statement": "one sentence", "detail": "why" }] }`,
          },
        ],
        schema: SCHEMA,
        maxOutputTokens: this.maxOutputTokens,
      },
      { timeoutMs: this.timeoutMs },
    );

    const list = Array.isArray(raw.findings) ? raw.findings : [];
    const out: Array<{ sceneId: string; statement: string; detail?: string }> = [];
    for (const entry of list) {
      if (typeof entry !== "object" || entry === null) continue;
      const item = entry as Record<string, unknown>;
      const statement = text(item.statement);
      const sceneId = text(item.sceneId);
      // A finding that names no scene cannot be navigated to, so it is dropped.
      if (statement === "" || !sceneId.startsWith("SCENE_")) continue;
      out.push({
        sceneId,
        statement,
        ...(text(item.detail) === "" ? {} : { detail: text(item.detail) }),
      });
    }
    return out.slice(0, request.limit);
  }
}

// ── Coercion: model output is untrusted ──────────────────────────────────────

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
    : [];

function bandOf(value: unknown): PlausibilityBand {
  return typeof value === "string" && (PLAUSIBILITY_BANDS as readonly string[]).includes(value)
    ? (value as PlausibilityBand)
    : // An unreadable band is not a confident one.
      "strained";
}

function factors(value: unknown): BehaviourFactor[] {
  if (!Array.isArray(value)) return [];
  const out: BehaviourFactor[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const statement = text(raw.statement);
    if (statement === "") continue;
    out.push({
      statement,
      ...(text(raw.detail) === "" ? {} : { detail: text(raw.detail) }),
      source: "model reading of the character",
      derivation: "model",
    });
  }
  return out;
}

function softContradictions(value: unknown): Contradiction[] {
  if (!Array.isArray(value)) return [];
  const out: Contradiction[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const statement = text(raw.statement);
    if (statement === "") continue;
    // Everything a model raises is soft: it is a tension a reader might feel,
    // not something the project settles.
    out.push({
      kind: "soft",
      statement,
      ...(text(raw.detail) === "" ? {} : { detail: text(raw.detail) }),
      derivation: "model",
    });
  }
  return out;
}

function judgementOf(value: unknown): Omit<CharacterJudgement, "modelId"> | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const statement = text(raw.statement);
  if (statement === "") return null;
  return {
    band: bandOf(raw.band),
    statement,
    reasoning: text(raw.reasoning),
    uncertainty: strings(raw.uncertainty),
  };
}

function conditionsOf(value: unknown): NarrativeCondition[] {
  if (!Array.isArray(value)) return [];
  const out: NarrativeCondition[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const statement = text(raw.statement);
    if (statement === "") continue;
    out.push({
      statement,
      ...(text(raw.rationale) === "" ? {} : { rationale: text(raw.rationale) }),
      ...(text(raw.cost) === "" ? {} : { cost: text(raw.cost) }),
    });
  }
  return out;
}
