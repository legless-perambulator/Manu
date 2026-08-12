import type {
  BuildComparison,
  BuildConfig,
  BuildContext,
  BuildInputKind,
  Diagnostic,
  DiagnosticDraft,
  ResolvedBuildConfig,
  RuleOutcome,
  Severity,
  StoryBuild,
  StoryCompilerRule,
} from "./types";

/**
 * The Story Build.
 *
 * Running the rules, tallying severities and deciding pass or fail is plain
 * software: no model is involved, and the same project state always produces
 * the same build. What the rules *find* comes from the systems that already own
 * that knowledge — the entity graph, the story-state timeline, the chronology,
 * the narrative checks — because a second implementation of continuity logic
 * inside the compiler is a second implementation to get out of step
 * (docs/STORY_COMPILER.md).
 */

export interface BuildOptions {
  readonly config?: BuildConfig;
  /** Build number. Callers with a history supply the next one. */
  readonly number?: number;
  readonly now?: () => string;
  /**
   * Re-run only the rules that read these inputs.
   *
   * The seam for incremental builds: a caller that knows what changed can pass
   * the input kinds it touched. Rules not re-run are reported as skipped, so a
   * partial build never quietly looks like a clean one.
   */
  readonly only?: readonly BuildInputKind[];
}

export function resolveConfig(config: BuildConfig = {}): ResolvedBuildConfig {
  return {
    disabledRules: config.disabledRules ?? [],
    disabledCategories: config.disabledCategories ?? [],
    severityOverrides: config.severityOverrides ?? {},
    options: config.options ?? {},
  };
}

/** Rules that read any of these inputs — the incremental-build selector. */
export function rulesAffectedBy(
  rules: readonly StoryCompilerRule[],
  changed: readonly BuildInputKind[],
): StoryCompilerRule[] {
  return rules.filter((rule) => rule.inputs.some((input) => changed.includes(input)));
}

/**
 * Run the rules over a project and produce a build.
 *
 * A rule that throws becomes a `failed` outcome rather than aborting: one
 * broken rule must not cost a writer the other twenty answers.
 */
export async function buildStory(
  rules: readonly StoryCompilerRule[],
  context: Omit<BuildContext, "config">,
  options: BuildOptions = {},
): Promise<StoryBuild> {
  const now = options.now ?? (() => new Date().toISOString());
  const config = resolveConfig(options.config);
  const started = now();
  const startedMs = Date.now();
  const full: BuildContext = { ...context, config };

  const affected =
    options.only === undefined
      ? null
      : new Set(rulesAffectedBy(rules, options.only).map((r) => r.id));

  const outcomes: RuleOutcome[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const rule of rules) {
    const base = { ruleId: rule.id, name: rule.name, category: rule.category };

    const skip = config.disabledRules.includes(rule.id)
      ? "disabled in this project's build configuration"
      : config.disabledCategories.includes(rule.category)
        ? `category "${rule.category}" is disabled in this project's build configuration`
        : affected !== null && !affected.has(rule.id)
          ? "not affected by this change; carried over from the previous build"
          : undefined;

    if (skip !== undefined) {
      outcomes.push({ ...base, status: "skipped", diagnosticCount: 0, reason: skip });
      continue;
    }

    try {
      const drafts = await rule.run(full);
      const found = drafts.map((draft) => toDiagnostic(rule, draft, config, context));
      diagnostics.push(...found);
      outcomes.push({
        ...base,
        status: found.length === 0 ? "passed" : "found",
        diagnosticCount: found.length,
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      // The rule failing is itself a finding: a check that cannot run is not a
      // check that passed, and a build must never imply otherwise.
      diagnostics.push(
        toDiagnostic(
          rule,
          {
            severity: "error",
            message: `The "${rule.name}" check could not run: ${reason}`,
            evidence: "The rule threw while running; its findings are missing from this build.",
            key: "rule_failure",
          },
          config,
          context,
        ),
      );
      outcomes.push({ ...base, status: "failed", diagnosticCount: 1, reason });
    }
  }

  const ordered = [...diagnostics].sort(compareDiagnostics);
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of ordered) counts[diagnostic.severity] += 1;

  const finished = now();
  return {
    id: `BUILD_${String(options.number ?? 1).padStart(4, "0")}`,
    number: options.number ?? 1,
    startedAt: started,
    finishedAt: finished,
    durationMs: Math.max(0, Date.now() - startedMs),
    status: counts.error > 0 ? "failed" : counts.warning > 0 ? "passed_with_warnings" : "passed",
    counts,
    diagnostics: ordered,
    rules: outcomes,
    config,
  };
}

/**
 * Compare two builds.
 *
 * Matching is by fingerprint, so a diagnostic survives a reworded message and
 * "resolved" means the problem went away rather than the wording changing.
 */
export function compareBuilds(
  previous: Pick<StoryBuild, "id" | "diagnostics"> | undefined,
  current: Pick<StoryBuild, "id" | "diagnostics">,
): BuildComparison {
  const before = new Map((previous?.diagnostics ?? []).map((d) => [d.id, d]));
  const after = new Map(current.diagnostics.map((d) => [d.id, d]));

  return {
    ...(previous !== undefined ? { previousBuildId: previous.id } : {}),
    buildId: current.id,
    added: current.diagnostics.filter((d) => !before.has(d.id)),
    resolved: [...before.values()].filter((d) => !after.has(d.id)),
    persistent: current.diagnostics.filter((d) => before.has(d.id)),
  };
}

// ── Identity and ordering ────────────────────────────────────────────────────

function toDiagnostic(
  rule: StoryCompilerRule,
  draft: DiagnosticDraft,
  config: ResolvedBuildConfig,
  context: Omit<BuildContext, "config">,
): Diagnostic {
  const entities = [...(draft.entities ?? [])].sort();
  const chapterId =
    draft.sceneId === undefined
      ? undefined
      : (context.scenes.find((s) => s.id === draft.sceneId)?.chapterId as string | undefined);

  return {
    id: fingerprint(rule.id, draft.sceneId, entities, draft.key),
    ruleId: rule.id,
    severity: config.severityOverrides[rule.id] ?? draft.severity,
    message: draft.message,
    entities,
    ...(draft.sceneId !== undefined ? { sceneId: draft.sceneId } : {}),
    ...(chapterId !== undefined ? { chapterId } : {}),
    evidence: draft.evidence,
    ...(draft.suggestedAction !== undefined ? { suggestedAction: draft.suggestedAction } : {}),
  };
}

/**
 * A diagnostic's stable identity.
 *
 * Built from what the finding is *about*, never from how it is phrased, so the
 * same problem keeps the same ID across builds and across message rewrites.
 */
export function fingerprint(
  ruleId: string,
  sceneId: string | undefined,
  entities: readonly string[],
  key = "",
): string {
  const material = [ruleId, sceneId ?? "", [...entities].sort().join(","), key].join("|");
  // FNV-1a: short, deterministic, and no dependency. Collisions across a
  // project's handful of findings are not a practical concern, and a collision
  // would merge two findings rather than lose one.
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `DIAG_${hash.toString(16).padStart(8, "0")}`;
}

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { error: 0, warning: 1, info: 2 };

/** Errors first, then by rule and scene — a total order, so builds are stable. */
function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    a.ruleId.localeCompare(b.ruleId) ||
    (a.sceneId ?? "").localeCompare(b.sceneId ?? "") ||
    a.id.localeCompare(b.id)
  );
}
