import type { SkillFinding } from "@jellytind/domain";
import type { SkillOperation } from "../types";
import { finding, nothingToDo, operation } from "./shared";

/**
 * The `/continuity-audit` workflow.
 *
 * The deterministic half is the Story Build, which already knows how to check
 * timeline, knowledge, objects, threads and dependencies. The audit does not
 * re-implement any of it — it runs the build, reads the diagnostics, and only
 * then asks a model to look at the kinds of continuity a rule cannot express
 * ("the compiler consumes, it does not duplicate", docs/STORY_COMPILER.md).
 */

interface BuildResult {
  readonly buildId: string;
  readonly status: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly diagnostics: ReadonlyArray<{
    readonly id: string;
    readonly ruleId: string;
    readonly severity: string;
    readonly message: string;
    readonly evidence: string;
    readonly entities: readonly string[];
    readonly sceneId?: string;
  }>;
}

export const runStoryBuild = operation({
  id: "run_story_build",
  title: "Run the Story Build",
  kind: "deterministic",
  produces: "build",
  requiredTools: ["run_story_build"],
  async run(context) {
    const build = await context.repo.buildStory();
    const data: BuildResult = {
      buildId: build.id,
      status: build.status,
      counts: build.counts,
      diagnostics: build.diagnostics.map((diagnostic) => ({
        id: diagnostic.id,
        ruleId: diagnostic.ruleId,
        severity: diagnostic.severity,
        message: diagnostic.message,
        evidence: diagnostic.evidence,
        entities: [...diagnostic.entities],
        ...(diagnostic.sceneId === undefined ? {} : { sceneId: diagnostic.sceneId }),
      })),
    };
    return {
      summary: `Build ${build.id} ${build.status} — ${String(build.diagnostics.length)} diagnostic(s)`,
      data,
      measurements: [
        {
          label: "Diagnostics",
          value: build.diagnostics.length,
          unit: "diagnostics",
          basis: `build ${build.id}`,
        },
      ],
    };
  },
});

export const inspectDiagnostics = operation({
  id: "inspect_diagnostics",
  title: "Inspect diagnostics",
  kind: "deterministic",
  reads: ["build"],
  produces: "diagnostics",
  requiredTools: ["get_build_diagnostics"],
  async run(context) {
    const build = context.read<BuildResult>("build");
    if (build === null) return nothingToDo("No build to read diagnostics from.");
    if (build.diagnostics.length === 0) {
      return {
        summary: "No diagnostics — every deterministic check passed",
        data: { byRule: {}, findings: 0 },
      };
    }

    const findings: SkillFinding[] = build.diagnostics.map((diagnostic, index) =>
      finding(context, index, {
        // An error is a contradiction in the record; a warning is worth a look.
        kind: diagnostic.severity === "error" ? "conflict" : "attention",
        statement: diagnostic.message,
        detail: diagnostic.evidence,
        basis: `${diagnostic.ruleId} · build ${build.buildId}`,
        ...(diagnostic.sceneId === undefined ? {} : { sceneIds: [diagnostic.sceneId] }),
        entities: diagnostic.entities,
      }),
    );

    const byRule: Record<string, number> = {};
    for (const diagnostic of build.diagnostics) {
      byRule[diagnostic.ruleId] = (byRule[diagnostic.ruleId] ?? 0) + 1;
    }

    return {
      summary: `Read ${String(build.diagnostics.length)} diagnostic(s) across ${String(Object.keys(byRule).length)} rule(s)`,
      data: { byRule },
      findings,
    };
  },
});

export const runStoryTests = operation({
  id: "run_story_tests",
  title: "Run the writer's own assertions",
  kind: "deterministic",
  produces: "testRun",
  requiredTools: ["run_story_tests"],
  async run(context) {
    const tests = await context.repo.listStoryTests();
    if (tests.length === 0) {
      return nothingToDo("No story tests are recorded, so none were run.");
    }
    const run = await context.repo.runStoryTests();
    const failed = run.results.filter((result) => result.status === "failed");
    const findings = failed.map((result, index) =>
      finding(context, index, {
        kind: "conflict",
        statement: `Story test failed: ${result.name}`,
        detail: result.statement,
        basis: "story test suite",
        sceneIds: result.failures.map((failure) => failure.sceneId),
      }),
    );
    return {
      summary: `${String(run.deterministic.passed)} passed, ${String(run.deterministic.failed)} failed, ${String(run.semantic.notEvaluated)} not evaluated`,
      data: {
        passed: run.deterministic.passed,
        failed: run.deterministic.failed,
        notEvaluated: run.semantic.notEvaluated,
      },
      findings,
      ...(run.semantic.notEvaluated > 0
        ? {
            notMeasured: [
              `${String(run.semantic.notEvaluated)} semantic test(s) were not evaluated — not evaluated is not passed`,
            ],
          }
        : {}),
    };
  },
});

export const inspectSemanticContinuity = operation({
  id: "inspect_semantic_continuity",
  title: "Inspect suspicious semantic continuity",
  kind: "semantic",
  reads: ["build"],
  produces: "semanticContinuity",
  requiredTools: ["read_chapter_prose"],
  contextRecipe: "chapter_inspection",
  async run(context) {
    if (context.analyst === null) {
      return nothingToDo("No model is configured, so semantic continuity was not inspected.");
    }
    const build = context.read<BuildResult>("build");
    const scenes = await context.repo.listScenes();
    const material = [
      "DIAGNOSTICS ALREADY FOUND BY DETERMINISTIC RULES (do not repeat these)",
      ...(build?.diagnostics ?? []).map((d) => `- ${d.ruleId}: ${d.message}`),
      "",
      "SCENES, IN MANUSCRIPT ORDER",
      ...scenes.map(
        (scene) =>
          `- ${scene.id as string} ${scene.title}${scene.purpose.length > 0 ? ` — ${scene.purpose.join("; ")}` : ""}`,
      ),
    ].join("\n");

    const notes = await context.analyst.read({
      instruction:
        "Name continuity risks a deterministic rule cannot express: things the scene records imply but do not state, and which a reader would notice. Do not repeat a diagnostic already listed. If nothing stands out, return nothing.",
      material,
      maxItems: 8,
    });

    const findings = notes.map((note, index) =>
      finding(context, index, {
        kind: "attention",
        statement: note.statement,
        ...(note.detail === undefined ? {} : { detail: note.detail }),
        basis: `model reading (${context.analyst?.modelId ?? "model"}) — not a project record`,
        ...(note.sceneIds === undefined ? {} : { sceneIds: note.sceneIds }),
        ...(note.entities === undefined ? {} : { entities: note.entities }),
        source: "model",
      }),
    );

    return {
      summary: `Model raised ${String(notes.length)} semantic continuity risk(s)`,
      data: { notes },
      findings,
    };
  },
});

export const categoriseFindings = operation({
  id: "categorise_findings",
  title: "Categorise findings",
  kind: "deterministic",
  produces: "categories",
  async run(context) {
    const byKind: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const item of context.findings) {
      byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
      bySource[item.source] = (bySource[item.source] ?? 0) + 1;
    }
    const parts = Object.entries(byKind).map(([kind, count]) => `${String(count)} ${kind}`);
    return {
      summary:
        context.findings.length === 0
          ? "Nothing to categorise"
          : `Categorised ${String(context.findings.length)} finding(s): ${parts.join(", ")}`,
      data: { byKind, bySource, total: context.findings.length },
    };
  },
});

export const CONTINUITY_OPERATIONS: readonly SkillOperation[] = [
  runStoryBuild,
  inspectDiagnostics,
  runStoryTests,
  inspectSemanticContinuity,
  categoriseFindings,
];
