import { SkillError, type SkillDefinition, type SkillOperation, type SkillStep } from "../types";
import { CHARACTER_OPERATIONS } from "./character";
import { CONTINUITY_OPERATIONS } from "./continuity";
import { DIALOGUE_OPERATIONS } from "./dialogue";
import { REPORT_OPERATIONS } from "./report";
import { STRUCTURE_OPERATIONS } from "./structure";
import { TENDENCY_OPERATIONS } from "./tendencies";

/**
 * Every operation a skill may name.
 *
 * This registry is the boundary of what any skill — shipped or written by a
 * writer — can do. A custom skill composes these in a different order; it
 * cannot introduce a new one, which is what makes loading a skill from a file
 * safe (docs/WRITING_SKILLS.md).
 */
export const OPERATIONS: readonly SkillOperation[] = [
  ...CHARACTER_OPERATIONS,
  ...CONTINUITY_OPERATIONS,
  ...DIALOGUE_OPERATIONS,
  ...STRUCTURE_OPERATIONS,
  ...TENDENCY_OPERATIONS,
  ...REPORT_OPERATIONS,
];

const BY_ID = new Map(OPERATIONS.map((op) => [op.id, op]));

export function operationById(id: string): SkillOperation {
  const found = BY_ID.get(id);
  if (found === undefined) {
    throw new SkillError("unknown_operation", `No operation named "${id}".`, {
      details: { operation: id },
    });
  }
  return found;
}

export function hasOperation(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * Check a workflow before it runs.
 *
 * A step that reads an output no earlier step produces cannot work, and finding
 * that out half-way through a twenty-minute audit is not acceptable. The same
 * check validates a custom skill at load time, so a writer gets a sentence
 * naming the problem rather than a failure at step six.
 */
export function validateWorkflow(
  steps: readonly SkillStep[],
  inputs: readonly { key: string }[],
): void {
  if (steps.length === 0) {
    throw new SkillError("invalid_workflow", "A skill needs at least one step.");
  }
  const seenIds = new Set<string>();
  const available = new Set<string>();
  const declared = new Set(inputs.map((input) => input.key));

  for (const step of steps) {
    if (seenIds.has(step.id)) {
      throw new SkillError("invalid_workflow", `Two steps share the id "${step.id}".`);
    }
    seenIds.add(step.id);

    const op = operationById(step.operationId);
    for (const key of op.reads) {
      if (!available.has(key)) {
        throw new SkillError(
          "invalid_workflow",
          `Step "${step.id}" reads "${key}", which no earlier step produces.`,
          { details: { step: step.id, reads: key } },
        );
      }
    }
    for (const key of op.requiresInput) {
      if (!declared.has(key)) {
        throw new SkillError(
          "invalid_workflow",
          `Step "${step.id}" needs the input "${key}", which this skill does not declare.`,
          { details: { step: step.id, input: key } },
        );
      }
    }
    available.add(op.produces);
  }
}

/** The tools and recipes a workflow uses, derived from its steps. */
export function surfaceOf(steps: readonly SkillStep[]): {
  requiredTools: readonly string[];
  contextRecipes: readonly string[];
} {
  const tools = new Set<string>();
  const recipes = new Set<string>();
  for (const step of steps) {
    const op = operationById(step.operationId);
    for (const tool of op.requiredTools) tools.add(tool);
    if (op.contextRecipe !== undefined) recipes.add(op.contextRecipe);
  }
  return { requiredTools: [...tools].sort(), contextRecipes: [...recipes].sort() };
}

/** Output keys a finished run of this skill will carry. */
export function sectionsOf(steps: readonly SkillStep[]): readonly string[] {
  return [...new Set(steps.map((step) => operationById(step.operationId).produces))];
}

/** True when every semantic step of a skill would be skipped without a model. */
export function isFullyDeterministic(skill: SkillDefinition): boolean {
  return skill.steps.every((step) => operationById(step.operationId).kind === "deterministic");
}

export * from "./character";
export * from "./continuity";
export * from "./dialogue";
export * from "./structure";
export * from "./tendencies";
export * from "./report";
