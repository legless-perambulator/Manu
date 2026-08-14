import { ContextCompiler, renderContextPackage } from "@jellytind/context-compiler";
import { ModelError, type LanguageModel, type OutputSchema } from "@jellytind/model-router";
import { groundClaims } from "@jellytind/shared";
import type { StoryRepository } from "@jellytind/story-repository";
import { RefactorError, type PlanStep, type RefactorAnalysis, type RefactorPlan } from "./types";

/**
 * The model's contribution to a plan.
 *
 * Two things, and only two: the consequences the structured systems cannot see
 * — *the inheritance motive no longer works*, *Elias's mother calls Marcus her
 * son* — and sentence-level rewrites where a word substitution would leave the
 * prose ungrammatical.
 *
 * It is never asked *what is affected*. The project already knows that, and a
 * model asked the same question would be wrong more expensively
 * (docs/STORY_REFACTOR.md).
 *
 * Rewrites are returned as **verbatim sentence pairs** and verified against the
 * file before staging. A model that cannot quote the sentence it is changing
 * does not get to change it, which is what keeps a refactor from rewriting a
 * chapter nobody asked it to touch.
 */

const SYSTEM_PROMPT = `You help plan a structural change to a fiction project.

You are given the change, what the project's own systems found it affects, and the passages of prose that mention the words involved. The mechanical part is already handled: exact word substitutions will be made deterministically and you do not need to propose them.

Your job is the two things arithmetic cannot do.

Rules:
- Consequences: say what stops working. "The inheritance motive rests on them being brothers" is useful; "this may affect the story" is not. Name entity IDs where you can.
- Rewrites: only where swapping the word alone would leave a sentence wrong — a possessive, a family term, a line of dialogue that names the relation. Quote the original sentence EXACTLY as it appears, character for character, and give the rewritten sentence.
- If a sentence would read correctly after the plain substitution, do not propose a rewrite for it.
- Every consequence must cite, in "basis", the affected entity IDs it rests on — from the list you were given and no other. Citations are checked: an ID that was not in the analysis is reported to the writer as unsupported.
- Never invent entity IDs, scenes or facts. Use only what you were given.
- Do not rewrite anything the change does not require. A refactor that quietly improves prose is a refactor a writer cannot review.
- Be brief and specific. This is read by someone deciding whether to proceed.`;

interface RawPlan {
  readonly consequences?: unknown;
  readonly rewrites?: unknown;
  readonly manual?: unknown;
}

const PLAN_SCHEMA: OutputSchema<RawPlan> = {
  name: "RefactorPlanNotes",
  parse(value: unknown): RawPlan {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new RefactorError("nothing_to_do", "RefactorPlanNotes: expected an object.");
    }
    return value as RawPlan;
  },
};

const FORMAT = `Reply with JSON only, matching:
{
  "consequences": [{ "statement": "what stops working, and why", "basis": ["CHAR_0002", "THREAD_0001"] }],
  "manual": ["something a person has to decide or rewrite, stated as a task"],
  "rewrites": [
    {
      "path": "manuscript/CHAPTER_0004.md",
      "original": "the sentence exactly as it appears in the file",
      "replacement": "the rewritten sentence"
    }
  ]
}
Return empty arrays where you have nothing to add.`;

export interface RefactorPlannerOptions {
  readonly repo: StoryRepository;
  readonly model: LanguageModel;
  readonly maxOutputTokens?: number;
  readonly maxContextTokens?: number;
}

/** A rewrite the model proposed that could not be used, and why. */
export interface RejectedRewrite {
  readonly path: string;
  readonly original: string;
  readonly problem: string;
}

export interface EnrichedPlan extends RefactorPlan {
  readonly rejectedRewrites: readonly RejectedRewrite[];
}

export class RefactorPlanner {
  constructor(private readonly options: RefactorPlannerOptions) {}

  /**
   * Add the model's reading to a deterministic plan.
   *
   * The plan it is given already works. If the model call fails, the caller
   * still has a plan — a refactor must not become impossible because a provider
   * was unavailable.
   */
  async enrich(analysis: RefactorAnalysis, plan: RefactorPlan): Promise<EnrichedPlan> {
    const { repo, model } = this.options;

    let raw: RawPlan;
    try {
      raw = await model.generateStructured(
        {
          system: SYSTEM_PROMPT,
          messages: [
            { role: "user", content: await this.renderScope(analysis) },
            { role: "user", content: `Plan the change described above.\n\n${FORMAT}` },
          ],
          schema: PLAN_SCHEMA,
          maxOutputTokens: this.options.maxOutputTokens ?? 2_000,
        },
        { timeoutMs: 120_000 },
      );
    } catch (cause) {
      if (cause instanceof ModelError) {
        return {
          ...plan,
          modelNotes: [`The model could not be reached (${cause.message}). The plan is unchanged.`],
          consequences: [],
          rejectedRewrites: [],
        };
      }
      throw cause;
    }

    const steps: PlanStep[] = [...plan.steps];
    const rejectedRewrites: RejectedRewrite[] = [];

    for (const task of strings(raw.manual)) {
      steps.push({
        kind: "manual",
        description: task,
        entities: [],
        reason: "Raised by the model. Its reading, not a recorded fact.",
      });
    }

    for (const entry of array(raw.rewrites)) {
      const path = text(entry.path);
      const original = text(entry.original);
      const replacement = text(entry.replacement);

      if (path === "" || original === "" || replacement === "") {
        rejectedRewrites.push({
          path,
          original,
          problem: "Incomplete: a rewrite needs a file, the original sentence and its replacement.",
        });
        continue;
      }
      const file = await repo.readProjectFile(path);
      if (file === null) {
        rejectedRewrites.push({
          path,
          original,
          problem: `${path} is not a file in this project.`,
        });
        continue;
      }
      // Verbatim or not at all. A model that cannot quote the sentence it is
      // changing does not get to change it.
      const occurrences = file.split(original).length - 1;
      if (occurrences === 0) {
        rejectedRewrites.push({
          path,
          original,
          problem: "That sentence does not appear in the file, character for character.",
        });
        continue;
      }
      if (occurrences > 1) {
        rejectedRewrites.push({
          path,
          original,
          problem: `That sentence appears ${String(occurrences)} times; which one is meant is ambiguous.`,
        });
        continue;
      }

      steps.push({
        kind: "rewrite_passage",
        path,
        instruction: replacement,
        excerpt: original,
        reason: "The model's rewrite, applied literally to the sentence it quoted.",
      });
    }

    // Consequences are the model's claims about the story, so each is checked
    // against the entities the deterministic analysis actually found. One that
    // cites something the analysis never produced survives, marked unsupported
    // (AGENTS.md — "Canon vs Inference").
    const affected = new Set(analysis.affected.map((entry) => entry.id));
    const consequences = groundClaims(
      array(raw.consequences)
        .map((entry) => ({ statement: text(entry.statement), cited: strings(entry.basis) }))
        .filter((claim) => claim.statement !== ""),
      affected,
    );

    return {
      steps,
      modelId: model.id,
      modelNotes: [],
      consequences,
      rejectedRewrites,
    };
  }

  /**
   * What the model is shown.
   *
   * The change, what the project found, and compiled context for the affected
   * scenes — never the whole project. Context comes from the Context Compiler
   * so the selection is attributed and budgeted like every other model call
   * (docs/CONTEXT_COMPILER.md).
   */
  private async renderScope(analysis: RefactorAnalysis): Promise<string> {
    const out: string[] = [];
    out.push("REQUESTED CHANGE");
    out.push(analysis.instruction);
    out.push(analysis.summary);
    out.push("");

    out.push("WHAT THE PROJECT'S OWN SYSTEMS FOUND — treat as fact");
    for (const entry of analysis.affected) {
      out.push(`${entry.id} (${entry.kind}) ${entry.name} — ${entry.why}`);
    }
    out.push("");

    if (analysis.risks.length > 0) {
      out.push("RECORDED RISKS");
      for (const risk of analysis.risks) out.push(`- ${risk.summary} ${risk.detail}`);
      out.push("");
    }

    out.push("PASSAGES THAT MENTION THE WORDS INVOLVED");
    for (const reference of analysis.manuscriptReferences) {
      out.push(
        `${reference.path} — "${reference.term}" ×${String(reference.occurrences)}: ${reference.excerpt}`,
      );
    }
    out.push("");

    // One compiled context package for the most-affected scene: enough for the
    // model to know the story around the change without being handed the book.
    const scene = analysis.affected.find((a) => a.kind === "scene");
    if (scene !== undefined) {
      const compiler = new ContextCompiler(this.options.repo);
      const pkg = await compiler.compile({
        recipe: "scene_inspection",
        targetId: scene.id,
        instruction: analysis.instruction,
        budget: {
          maxTokens: this.options.maxContextTokens ?? 8_000,
          reserveForOutput: 2_000,
        },
      });
      out.push("CONTEXT FOR THE MOST AFFECTED SCENE");
      out.push(renderContextPackage(pkg));
    }

    return out.join("\n");
  }
}

// ── Coercion: model output is untrusted ──────────────────────────────────────

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : [];

function array(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    : [];
}
