import { DEBUG_MODE_LABEL, type DebugReport, type DebugTrace } from "./types";

/**
 * A debug report as text.
 *
 * The seven headings are fixed and always present, in this order:
 *
 * ```
 * Problem · Scope inspected · Evidence · Diagnosis
 * Confidence and uncertainty · Possible interventions · Affected entities
 * ```
 *
 * A section with nothing in it says so rather than disappearing. A report whose
 * shape changes with its content cannot be read at a glance, and a missing
 * Diagnosis heading would quietly hide the fact that nothing interpreted the
 * evidence (docs/STORY_DEBUGGER.md).
 *
 * Every claim carries its provenance: evidence lines are prefixed with the
 * system that produced them, and the diagnosis is prefixed MODEL JUDGEMENT.
 */
export function renderDebugReport(
  report: DebugReport | DebugTrace,
  label: (id: string) => string = (id) => id,
): string {
  const full = "id" in report ? report : undefined;
  const out: string[] = [];

  out.push(
    `STORY DEBUG — ${DEBUG_MODE_LABEL[report.mode]}${full === undefined ? "" : ` · ${full.id}`}`,
  );
  out.push("");

  out.push("PROBLEM");
  out.push(`  ${report.problem}`);
  out.push("");

  out.push("SCOPE INSPECTED");
  out.push(`  ${report.scope.summary}`);
  out.push(`  Systems traced: ${report.scope.systems.join(", ")}`);
  out.push(
    `  ${String(report.scope.sceneIds.length)} scene(s), ${String(report.scope.chapterIds.length)} chapter(s), ${String(report.scope.entityIds.length)} entity(ies)`,
  );
  for (const gap of report.scope.notInspected) out.push(`  Not inspected: ${gap}`);
  out.push("");

  out.push(`EVIDENCE (deterministic — ${String(report.evidence.length)} item(s))`);
  if (report.evidence.length === 0) out.push("  Nothing was found to retrieve.");
  for (const item of report.evidence) {
    out.push(`  [${item.id}] ${item.system}: ${item.statement}`);
    if (item.detail !== undefined) out.push(`        ${item.detail}`);
    const links = [item.sceneId, item.chapterId, ...item.entities].filter(
      (id): id is string => id !== undefined,
    );
    if (links.length > 0) out.push(`        → ${links.map((id) => label(id)).join(" · ")}`);
  }
  out.push("");

  if (report.measurements.length > 0) {
    out.push("MEASUREMENTS (counted, not graded)");
    for (const m of report.measurements) {
      out.push(`  ${m.label}: ${String(m.value)} ${m.unit}`);
      out.push(`        ${m.basis}`);
    }
    out.push("");
  }

  out.push("DIAGNOSIS");
  if (full?.diagnosis === undefined) {
    out.push("  Not diagnosed. The evidence above stands on its own; nothing has interpreted it.");
    out.push("");
    out.push("CONFIDENCE AND UNCERTAINTY");
    out.push("  No interpretation was made, so there is nothing to be confident about.");
  } else {
    const d = full.diagnosis;
    out.push(`  MODEL JUDGEMENT: ${d.statement}`);
    out.push(`  ${d.reasoning}`);
    out.push(`  Resting on: ${d.basis.length === 0 ? "no cited evidence" : d.basis.join(", ")}`);
    if (d.unsupported.length > 0) {
      out.push(`  Cited evidence that does not exist: ${d.unsupported.join(", ")}`);
    }
    out.push("");
    out.push("CONFIDENCE AND UNCERTAINTY");
    out.push(`  Confidence: ${d.confidence}`);
    for (const line of d.uncertainty) out.push(`  Would change this: ${line}`);
  }
  out.push("");

  out.push("POSSIBLE INTERVENTIONS (suggestions — nothing has been applied)");
  const interventions = full?.interventions ?? [];
  if (interventions.length === 0) out.push("  None proposed.");
  for (const intervention of interventions) {
    out.push(`  ${intervention.kind} (${intervention.effort}): ${intervention.summary}`);
    out.push(`        ${intervention.rationale}`);
    if (intervention.sceneIds.length > 0) {
      out.push(`        → ${intervention.sceneIds.map((id) => label(id)).join(" · ")}`);
    }
  }
  out.push("");

  out.push("AFFECTED ENTITIES");
  const entities = full?.entities ?? report.scope.entityIds;
  out.push(
    entities.length === 0
      ? "  None named."
      : `  ${entities.map((id) => `${label(id)} (${id})`).join(", ")}`,
  );

  return out.join("\n");
}
