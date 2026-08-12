import { REFACTOR_KIND_LABEL, type RefactorAnalysis, type RefactorRun } from "./types";

/**
 * The analysis as a report a writer reads before deciding.
 *
 * Counts first, because the first question is *how big is this*; then the
 * high-risk items by name; then the consequences, each labelled with whether
 * the project found it or a model suggested it.
 */
export function renderAnalysis(
  analysis: RefactorAnalysis,
  label: (id: string) => string = (id) => id,
): string {
  const out: string[] = [];
  out.push("STORY REFACTOR ANALYSIS");
  out.push("");
  out.push("Requested change:");
  out.push(`  ${analysis.instruction}`);
  out.push(`  ${analysis.summary}`);
  out.push("");

  out.push("Affected:");
  for (const [kind, count] of Object.entries(analysis.counts).sort()) {
    if (count === 0) continue;
    out.push(`  ${kind.replace(/_/g, " ")}: ${String(count)}`);
  }
  if (analysis.blastRadius !== null && analysis.blastRadius.total > 0) {
    out.push(`  registered dependencies downstream: ${String(analysis.blastRadius.total)}`);
  }
  out.push("");

  const high = analysis.risks.filter((r) => r.level === "high");
  out.push("High-risk:");
  if (high.length === 0) out.push("  Nothing the structured systems flag.");
  for (const risk of high) {
    out.push(`  ${risk.summary}`);
    for (const entity of risk.entities) out.push(`    ${label(entity)} (${entity})`);
  }
  out.push("");

  out.push("Potential consequences:");
  if (analysis.risks.length === 0) out.push("  None found.");
  for (const risk of analysis.risks) {
    out.push(
      `  [${risk.source === "structured" ? "RECORDED" : "MODEL JUDGEMENT"}] ${risk.summary}`,
    );
    if (risk.detail !== "") out.push(`      ${risk.detail}`);
  }
  return out.join("\n");
}

/** What validation found, and whether it should stop the writer. */
export function renderValidation(run: RefactorRun): string {
  const out: string[] = [];
  const errors = run.introduced.filter((d) => d.severity === "error");

  out.push(
    errors.length > 0
      ? "REFACTOR VALIDATION FAILED"
      : `REFACTOR STAGED — ${REFACTOR_KIND_LABEL[run.kind]}`,
  );
  out.push("");
  out.push(`New errors: ${String(errors.length)}`);
  out.push("");

  for (const diagnostic of run.introduced) {
    const where = diagnostic.sceneId ?? diagnostic.entities[0] ?? diagnostic.ruleId;
    out.push(`${where}:`);
    out.push(`  ${diagnostic.severity.toUpperCase()} ${diagnostic.message}`);
  }

  const before = run.before;
  const after = run.after;
  if (before !== undefined && after !== undefined) {
    out.push("");
    out.push(
      `Story tests: ${String(after.testsPassed)} / ${String(after.testsTotal)} passed (was ${String(before.testsPassed)} / ${String(before.testsTotal)})`,
    );
    const broken = after.failedTestIds.filter((id) => !before.failedTestIds.includes(id));
    for (const id of broken) out.push(`  ${id}: newly failing.`);
  }

  out.push("");
  out.push(`Staged files: ${String(run.stagedFiles.length)}`);
  if (run.checkpointId !== undefined) out.push(`Checkpoint taken: ${run.checkpointId}`);
  out.push("Nothing has been applied. Approve to commit, or discard to walk away.");
  return out.join("\n");
}
