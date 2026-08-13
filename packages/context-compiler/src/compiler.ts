import { dedupe, PRIORITY, type Candidate } from "./candidate";
import { CompileError } from "./errors";
import type { ProjectReader } from "./reader";
import { excerptProse } from "./render";
import { gatherChapterInspection } from "./recipes/chapter-inspection";
import { gatherSceneInspection } from "./recipes/scene-inspection";
import { gatherSceneRewrite } from "./recipes/scene-rewrite";
import { gatherReaderSequential } from "./recipes/reader-sequential";
import { byId, provenance, readSnapshot } from "./recipes/shared";
import { CHARACTER_ESTIMATOR, type TokenCounter } from "./tokens";
import {
  DEFAULT_BUDGET,
  SECTION_ORDER,
  type BudgetNote,
  type ContextBudget,
  type ContextItem,
  type ContextPackage,
  type ContextSection,
  type TargetRef,
} from "./types";

export const RECIPE_NAMES = [
  "scene_inspection",
  "scene_rewrite",
  "chapter_inspection",
  "reader_sequential",
] as const;
export type RecipeName = (typeof RECIPE_NAMES)[number];

export interface RecipeInfo {
  readonly name: RecipeName;
  readonly title: string;
  readonly description: string;
  readonly targetKind: "scene" | "chapter";
}

/** The recipe catalog, as data — there is deliberately no universal recipe. */
export const RECIPES: readonly RecipeInfo[] = [
  {
    name: "scene_inspection",
    title: "Scene inspection",
    description:
      "The target scene, its previous and next scenes, POV and participating characters, location, and linked plot threads.",
    targetKind: "scene",
  },
  {
    name: "scene_rewrite",
    title: "Scene rewrite",
    description:
      "Everything scene inspection gathers, plus author style material and voice material for the characters who speak in the scene.",
    targetKind: "scene",
  },
  {
    name: "chapter_inspection",
    title: "Chapter inspection",
    description:
      "The chapter's scenes, summaries of the previous and next chapters, the characters involved, and the plot threads still active.",
    targetKind: "chapter",
  },
  {
    name: "reader_sequential",
    title: "Reader sequential",
    description:
      "The manuscript as a reader has met it: prose up to and including this chapter, nearest first, and nothing else — no records, no state, nothing from later.",
    targetKind: "chapter",
  },
];

export interface CompileRequest {
  readonly recipe: RecipeName;
  /** Scene or chapter ID, per the recipe's `targetKind`. */
  readonly targetId: string;
  /** The instruction this context serves. Included as the `task` section. */
  readonly instruction?: string;
  readonly budget?: ContextBudget;
  /** Entity IDs the user pinned; they outrank everything the recipe chose. */
  readonly pinned?: readonly string[];
}

export interface ContextCompilerOptions {
  readonly tokenCounter?: TokenCounter;
  readonly now?: () => string;
}

/** Ordering used for selection and for the compiled package. Fully determined. */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.required !== b.required) return a.required === true ? -1 : 1;
  return (
    a.priority - b.priority ||
    SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Compiles task-specific working context.
 *
 * The whole point of the subsystem: a model operation states *which recipe* and
 * *which target*, and receives an explicit, attributed, budget-resolved package
 * — never a hand-assembled prompt scraped from arbitrary project files
 * (docs/CONTEXT_COMPILER.md).
 *
 * Selection is deterministic: recipes follow the project's own references, the
 * ordering is total, and the budget is resolved by pure arithmetic over
 * already-materialised renderings. Compiling the same request against the same
 * project state twice yields an identical package.
 */
export class ContextCompiler {
  private readonly tokens: TokenCounter;
  private readonly now: () => string;

  constructor(
    private readonly reader: ProjectReader,
    options: ContextCompilerOptions = {},
  ) {
    this.tokens = options.tokenCounter ?? CHARACTER_ESTIMATOR;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async compile(request: CompileRequest): Promise<ContextPackage> {
    const budget = request.budget ?? DEFAULT_BUDGET;
    const available = budget.maxTokens - (budget.reserveForOutput ?? 0);
    if (!Number.isFinite(available) || available <= 0) {
      throw new CompileError(
        "invalid_budget",
        `Budget leaves ${String(available)} tokens for context; it must be positive.`,
        { details: { budget } },
      );
    }

    const { candidates, target } = await this.gather(request);
    const ordered = dedupe(candidates).sort(compareCandidates);
    const { items, notes, used } = this.resolveBudget(ordered, available);

    return {
      task: request.instruction ?? defaultInstruction(request, target),
      ...(target !== undefined ? { target } : {}),
      sections: buildSections(items),
      metadata: {
        recipe: request.recipe,
        budget,
        availableTokens: available,
        estimatedTokens: used,
        withinBudget: used <= available,
        candidateCount: ordered.length,
        includedCount: items.filter((item) => item.rendering !== "reference").length,
        notes,
        tokenEstimator: this.tokens.name,
        compiledAt: this.now(),
      },
    };
  }

  /** Run the requested recipe, then apply pins and the task instruction. */
  private async gather(
    request: CompileRequest,
  ): Promise<{ candidates: Candidate[]; target?: TargetRef }> {
    const snapshot = await readSnapshot(this.reader);
    let candidates: Candidate[];
    let target: TargetRef;

    switch (request.recipe) {
      case "scene_inspection": {
        const out = await gatherSceneInspection(this.reader, request.targetId, snapshot);
        candidates = out.candidates;
        target = { id: out.scene.id, kind: "scene", label: out.scene.title };
        break;
      }
      case "scene_rewrite": {
        const out = await gatherSceneRewrite(this.reader, request.targetId, snapshot);
        candidates = out.candidates;
        const scene = byId(snapshot.scenes, request.targetId);
        target = { id: request.targetId, kind: "scene", label: scene?.title ?? request.targetId };
        break;
      }
      case "chapter_inspection": {
        const out = await gatherChapterInspection(this.reader, request.targetId, snapshot);
        candidates = out.candidates;
        target = { id: out.chapter.id, kind: "chapter", label: out.chapter.title };
        break;
      }
      case "reader_sequential": {
        const out = await gatherReaderSequential(this.reader, request.targetId, snapshot);
        candidates = out.candidates;
        target = { id: out.chapter.id, kind: "chapter", label: out.chapter.title };
        break;
      }
      default:
        throw new CompileError("unknown_recipe", `No recipe named "${String(request.recipe)}".`, {
          details: { recipe: request.recipe },
        });
    }

    const instruction = request.instruction ?? defaultInstruction(request, target);
    const withTask: Candidate[] = [
      {
        id: "task",
        kind: "instruction",
        label: "Task",
        section: "task",
        priority: PRIORITY.essential,
        provenance: provenance("task_instruction", "the operation this context serves"),
        full: instruction,
        required: true,
      },
      ...this.pinnedCandidates(request, snapshot),
      ...candidates,
    ];
    return { candidates: withTask, target };
  }

  /**
   * User-pinned entities. Pins sit above everything the recipe chose, because a
   * writer overriding the compiler's judgement is the one signal it should never
   * budget away.
   */
  private pinnedCandidates(
    request: CompileRequest,
    snapshot: Awaited<ReturnType<typeof readSnapshot>>,
  ): Candidate[] {
    const out: Candidate[] = [];
    for (const id of request.pinned ?? []) {
      const pools = [
        ["scene", snapshot.scenes],
        ["character", snapshot.characters],
        ["location", snapshot.locations],
        ["plot_thread", snapshot.plotThreads],
        ["world_rule", snapshot.worldRules],
        ["chapter", snapshot.chapters],
      ] as const;
      for (const [kind, pool] of pools) {
        const entity = byId(pool as readonly { id: string }[], id);
        if (entity === undefined) continue;
        out.push({
          id,
          kind,
          label: labelOf(entity),
          section: "additionalRetrievedContext",
          priority: PRIORITY.essential + 1,
          provenance: provenance("pinned", "pinned by the user for this operation"),
          full: JSON.stringify(entity, null, 2),
        });
        break;
      }
    }
    return out;
  }

  /**
   * Fit candidates into the budget by priority.
   *
   * Nothing is silently truncated. An element that does not fit at full fidelity
   * is offered its deterministic summary; prose, which has no structural digest,
   * is offered an explicitly-labelled opening excerpt. If even that will not fit,
   * only its identity is kept. Every downgrade and every exclusion is recorded in
   * a {@link BudgetNote} with the reason.
   */
  private resolveBudget(
    ordered: readonly Candidate[],
    available: number,
  ): { items: ContextItem[]; notes: BudgetNote[]; used: number } {
    const items: ContextItem[] = [];
    const notes: BudgetNote[] = [];
    let used = 0;

    for (const candidate of ordered) {
      const fullTokens = this.tokens.count(candidate.full);
      const remaining = available - used;

      // Required elements are included whole; the package reports going over
      // rather than dropping the task or its target.
      if (candidate.required === true || fullTokens <= remaining) {
        items.push(toItem(candidate, candidate.full, "full", fullTokens));
        used += fullTokens;
        continue;
      }

      const short = candidate.summary ?? proseFallback(candidate, remaining);
      if (short !== undefined) {
        const shortTokens = this.tokens.count(short);
        if (shortTokens <= remaining) {
          items.push(toItem(candidate, short, "summary", shortTokens, fullTokens));
          used += shortTokens;
          notes.push(
            note(
              candidate,
              "summary",
              fullTokens,
              shortTokens,
              `Full content needed ${String(fullTokens)} tokens but only ${String(
                remaining,
              )} remained; included as a summary.`,
            ),
          );
          continue;
        }
      }

      const reference = `${candidate.kind.toUpperCase()} ${candidate.id} — ${candidate.label} [content omitted: context budget]`;
      const referenceTokens = this.tokens.count(reference);
      if (referenceTokens <= remaining) {
        items.push(toItem(candidate, reference, "reference", referenceTokens, fullTokens));
        used += referenceTokens;
        notes.push(
          note(
            candidate,
            "reference",
            fullTokens,
            referenceTokens,
            `Neither full content (${String(fullTokens)} tokens) nor a summary fitted in the remaining ${String(remaining)}; only its identity is present.`,
          ),
        );
        continue;
      }

      notes.push(
        note(
          candidate,
          "excluded",
          fullTokens,
          0,
          `The context budget was exhausted (${String(remaining)} tokens remained).`,
        ),
      );
    }

    return { items, notes, used };
  }
}

function toItem(
  candidate: Candidate,
  text: string,
  rendering: ContextItem["rendering"],
  estimatedTokens: number,
  fullTokens?: number,
): ContextItem {
  return {
    id: candidate.id,
    section: candidate.section,
    kind: candidate.kind,
    label: candidate.label,
    text,
    provenance: candidate.provenance,
    priority: candidate.priority,
    rendering,
    estimatedTokens,
    ...(fullTokens !== undefined ? { fullTokens } : {}),
    // Carried through so a reader-facing operation can filter on it without
    // re-deriving which recipe produced the element.
    ...(candidate.revealsFuture === true ? { revealsFuture: true } : {}),
  };
}

function note(
  candidate: Candidate,
  disposition: BudgetNote["disposition"],
  fullTokens: number,
  includedTokens: number,
  reason: string,
): BudgetNote {
  return {
    id: candidate.id,
    kind: candidate.kind,
    label: candidate.label,
    provenance: candidate.provenance,
    disposition,
    fullTokens,
    includedTokens,
    reason,
  };
}

/** Prose has no structural digest, so its shortened form is a labelled excerpt. */
function proseFallback(candidate: Candidate, remainingTokens: number): string | undefined {
  if (candidate.kind !== "file") return undefined;
  // Leave room for the excerpt's own label; ~4 chars per token.
  const keep = Math.max(0, remainingTokens * 4 - 160);
  return keep < 200 ? undefined : excerptProse(candidate.full, keep);
}

function labelOf(entity: { id: string }): string {
  const record = entity as { name?: string; title?: string; id: string };
  return record.name ?? record.title ?? record.id;
}

function defaultInstruction(request: CompileRequest, target?: TargetRef): string {
  const info = RECIPES.find((r) => r.name === request.recipe);
  return `${info?.title ?? request.recipe} of ${target?.id ?? request.targetId}${
    target === undefined ? "" : ` — ${target.label}`
  }.`;
}

function buildSections(items: readonly ContextItem[]): ContextSection[] {
  const sections: ContextSection[] = [];
  for (const name of SECTION_ORDER) {
    const inSection = items.filter((item) => item.section === name);
    if (inSection.length > 0) sections.push({ name, items: inSection });
  }
  return sections;
}
