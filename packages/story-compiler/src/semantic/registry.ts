import type { LanguageModel } from "@jellytind/model-router";
import type {
  AuthorVoiceProfile,
  VoiceRule,
  VoiceTendency,
  VoiceCategory,
} from "@jellytind/domain";
import type {
  JudgementRuleSpec,
  RuleRun,
  SemanticBuildContext,
  SemanticCompilerRule,
  SemanticTarget,
} from "./types";

/**
 * The two ways a semantic rule is built (§2).
 *
 * A heuristic rule is a fixed procedure over the text — model-free, light,
 * runs in Quick builds. A judgement rule is declared as its parts — the
 * instruction, the context recipe, the validated output schema, the
 * interpretation — and this module assembles them into one uniform
 * {@link SemanticCompilerRule} so the engine treats both kinds identically.
 */

export function heuristicRule(input: {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly category: SemanticCompilerRule["category"];
  readonly description: string;
  readonly requiresModule?: string;
  run(context: SemanticBuildContext, target: SemanticTarget): RuleRun;
}): SemanticCompilerRule {
  return {
    id: input.id,
    name: input.name,
    version: input.version,
    category: input.category,
    description: input.description,
    ...(input.requiresModule !== undefined ? { requiresModule: input.requiresModule } : {}),
    weight: "light",
    requiresModel: false,
    run: (context, target) => Promise.resolve(input.run(context, target)),
  };
}

export function judgementRule<T>(spec: JudgementRuleSpec<T>): SemanticCompilerRule {
  return {
    id: spec.id,
    name: spec.name,
    version: spec.version,
    category: spec.category,
    description: spec.description,
    ...(spec.requiresModule !== undefined ? { requiresModule: spec.requiresModule } : {}),
    weight: "full",
    requiresModel: true,
    async run(
      context: SemanticBuildContext,
      target: SemanticTarget,
      model: LanguageModel | null,
    ): Promise<RuleRun> {
      const material = spec.contextRecipe(context, target);
      if (material === null) return { findings: [], note: "nothing in scope to judge" };
      if (model === null) return { findings: [], note: "no model available" };
      const parsed = await model.generateStructured(
        {
          system: spec.instruction,
          messages: [{ role: "user", content: material }],
          schema: spec.outputSchema,
          maxOutputTokens: 2_000,
        },
        { timeoutMs: 120_000 },
      );
      const run = spec.interpret(parsed, context, target);
      return {
        // Judgements carry the judge. Interpretations may set modelId
        // themselves; anything that did not gets the model that actually ran.
        findings: run.findings.map((draft) =>
          draft.modelId === undefined ? { ...draft, modelId: model.id } : draft,
        ),
        ...(run.note !== undefined ? { note: run.note } : {}),
      };
    },
  };
}

/**
 * Author Voice awareness (§7).
 *
 * Whether the writer has *deliberately chosen* a style this rule would
 * otherwise flag. Only their own enabled rules and **confirmed** tendencies
 * count — a proposed tendency is an unreviewed inference and silences
 * nothing. Matching is by keyword against the statement, restricted to the
 * relevant voice categories so "prefer repetition in dialogue" does not
 * silence a prose finding.
 */
export function voiceSanctions(
  voice: AuthorVoiceProfile,
  categories: readonly VoiceCategory[],
  keywords: readonly string[],
): string | null {
  const match = (statement: string): boolean => {
    const lowered = statement.toLowerCase();
    return keywords.some((keyword) => lowered.includes(keyword));
  };
  const rule = voice.rules.find(
    (held: VoiceRule) =>
      held.enabled &&
      held.kind === "prefer" &&
      categories.includes(held.category) &&
      match(held.statement),
  );
  if (rule !== undefined) return `your voice rule "${rule.statement}"`;
  const tendency = voice.tendencies.find(
    (held: VoiceTendency) =>
      held.status === "confirmed" && categories.includes(held.category) && match(held.statement),
  );
  if (tendency !== undefined) return `your confirmed tendency "${tendency.statement}"`;
  return null;
}
