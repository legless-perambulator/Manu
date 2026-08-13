import type { SkillFindingKind } from "@jellytind/domain";
import type { SkillOperation } from "../types";
import { operation } from "./shared";

/**
 * The last step of every skill: assemble what the earlier steps established.
 *
 * It reads nothing new. A report step that went back to the project could
 * report something no step had checked, and then the workflow would no longer
 * be the thing the writer watched run.
 */

const ORDER: readonly SkillFindingKind[] = [
  "conflict",
  "gap",
  "attention",
  "measurement",
  "proposal",
];

export const compileReport = operation({
  id: "compile_report",
  title: "Produce report",
  kind: "deterministic",
  produces: "report",
  async run(context) {
    const byKind = new Map<SkillFindingKind, number>();
    for (const item of context.findings) {
      byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
    }
    const modelDerived = context.findings.filter((item) => item.source === "model").length;

    const headline =
      context.findings.length === 0
        ? "Nothing was found by the checks that ran."
        : ORDER.filter((kind) => byKind.has(kind))
            .map((kind) => `${String(byKind.get(kind) ?? 0)} ${kind}`)
            .join(", ");

    return {
      summary: `Report: ${headline}`,
      data: {
        headline,
        counts: Object.fromEntries(byKind),
        total: context.findings.length,
        modelDerived,
        deterministic: context.findings.length - modelDerived,
        measurements: context.measurements,
        notMeasured: context.notMeasured,
      },
    };
  },
});

export const REPORT_OPERATIONS: readonly SkillOperation[] = [compileReport];
