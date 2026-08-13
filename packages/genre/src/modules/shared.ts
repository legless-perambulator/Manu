import type { ExtensionRecord } from "@jellytind/domain";
import type { BuildContext, DiagnosticDraft, StoryCompilerRule } from "@jellytind/story-compiler";
import type { ExtensionField, ExtensionKind, ModuleId, TestTemplate } from "../types";

/** Declare an extension kind, with the boilerplate filled in. */
export function kind(
  moduleId: ModuleId,
  definition: Omit<ExtensionKind, "moduleId" | "attachesTo" | "fields"> &
    Partial<Pick<ExtensionKind, "attachesTo" | "fields">>,
): ExtensionKind {
  return { moduleId, attachesTo: [], fields: [], ...definition };
}

export function field(definition: ExtensionField): ExtensionField {
  return definition;
}

/** A choice field, with its label derived from the key when not given. */
export function choice(
  key: string,
  label: string,
  choices: readonly string[],
  extra: Partial<ExtensionField> = {},
): ExtensionField {
  return { key, label, type: "choice", choices, ...extra };
}

export function text(key: string, label: string, extra: Partial<ExtensionField> = {}) {
  return field({ key, label, type: "text", ...extra });
}

export function longText(key: string, label: string, extra: Partial<ExtensionField> = {}) {
  return field({ key, label, type: "long_text", ...extra });
}

export function list(key: string, label: string, extra: Partial<ExtensionField> = {}) {
  return field({ key, label, type: "list", ...extra });
}

/**
 * Declare a module rule.
 *
 * `inputs` always includes `extensions`, because a module rule that did not
 * declare it would be skipped by an incremental build after the only change
 * that could possibly affect it. Validation enforces this; the helper means
 * nobody has to remember.
 */
export function moduleRule(
  definition: Omit<StoryCompilerRule, "inputs"> & { inputs?: StoryCompilerRule["inputs"] },
): StoryCompilerRule {
  return {
    ...definition,
    inputs: [...new Set(["extensions" as const, ...(definition.inputs ?? [])])],
  };
}

/** A module's records of one kind, from the build context. */
export function recordsOf(
  context: BuildContext,
  moduleId: string,
  kindId: string,
): readonly ExtensionRecord[] {
  return context.modules.extensions.filter(
    (record) => record.moduleId === moduleId && record.kind === kindId,
  );
}

/** One field's value as a single string, or "" when it is absent or a list. */
export function valueOf(record: ExtensionRecord, key: string): string {
  const value = record.fields[key];
  return typeof value === "string" ? value.trim() : "";
}

export function listOf(record: ExtensionRecord, key: string): readonly string[] {
  const value = record.fields[key];
  return typeof value === "string" ? (value === "" ? [] : [value]) : (value ?? []);
}

/**
 * A story-test template.
 *
 * Always semantic — a module contributes a **rule** for anything the project
 * can decide, and a template only for what it cannot. Adopting one creates an
 * ordinary story test the writer then owns (docs/GENRE_MODULES.md).
 */
export function template(input: {
  id: string;
  name: string;
  rationale: string;
  statement: string;
  severity?: "error" | "warning" | "info";
}): TestTemplate {
  return {
    id: input.id,
    name: input.name,
    rationale: input.rationale,
    draft: {
      name: input.name,
      description: input.rationale,
      type: "semantic",
      scope: { kind: "always" },
      enabled: true,
      severity: input.severity ?? "warning",
      assertion: { kind: "free_form", statement: input.statement },
    },
  };
}

/** Build a diagnostic draft for a module record. */
export function about(
  record: ExtensionRecord,
  draft: Omit<DiagnosticDraft, "entities"> & { entities?: readonly string[] },
): DiagnosticDraft {
  return {
    ...draft,
    entities: [record.id as string, ...(draft.entities ?? []), ...record.attachedTo.map(String)],
  };
}
