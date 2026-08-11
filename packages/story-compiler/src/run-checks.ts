import type { BuildReport, CheckContext, Finding, Severity, StoryCheck } from "./types";

/**
 * Run a set of story checks and aggregate their findings into a
 * {@link BuildReport}. This is the deterministic orchestration core of the
 * Story Build: individual checks (deterministic or semantic) are pluggable, but
 * running them, tallying severities and deciding pass/fail is plain software.
 *
 * Checks are run concurrently; a check that throws is surfaced as an
 * `error`-severity finding rather than aborting the whole build.
 */
export async function runChecks(
  checks: readonly StoryCheck[],
  context: CheckContext = {},
): Promise<BuildReport> {
  const results = await Promise.all(
    checks.map(async (check): Promise<Finding[]> => {
      try {
        return await check.run(context);
      } catch (error) {
        return [
          {
            checkId: check.id,
            severity: "error",
            source: "deterministic",
            message: `Check "${check.name}" threw: ${error instanceof Error ? error.message : String(error)}`,
          },
        ];
      }
    }),
  );

  const findings = results.flat();
  const counts: Record<Severity, number> = { error: 0, warning: 0, suggestion: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  return { findings, counts, ok: counts.error === 0 };
}
