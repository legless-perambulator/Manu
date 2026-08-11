import { describe, expect, it } from "vitest";
import { runChecks } from "./run-checks";
import type { StoryCheck } from "./types";

const clean: StoryCheck = { id: "clean", name: "Clean", run: () => [] };

const warns: StoryCheck = {
  id: "dormant-thread",
  name: "Dormant thread",
  run: () => [
    {
      checkId: "dormant-thread",
      severity: "warning",
      source: "deterministic",
      message: "Thread dormant for 63,291 words.",
    },
  ],
};

const errors: StoryCheck = {
  id: "dead-speaks",
  name: "Dead character speaks",
  run: () => [
    {
      checkId: "dead-speaks",
      severity: "error",
      source: "deterministic",
      message: "A dead character has dialogue.",
    },
  ],
};

describe("runChecks", () => {
  it("passes with no findings", async () => {
    const report = await runChecks([clean]);
    expect(report.ok).toBe(true);
    expect(report.counts).toEqual({ error: 0, warning: 0, suggestion: 0 });
  });

  it("passes with warnings but no errors", async () => {
    const report = await runChecks([clean, warns]);
    expect(report.ok).toBe(true);
    expect(report.counts.warning).toBe(1);
    expect(report.findings).toHaveLength(1);
  });

  it("fails when any error-severity finding is present", async () => {
    const report = await runChecks([warns, errors]);
    expect(report.ok).toBe(false);
    expect(report.counts).toEqual({ error: 1, warning: 1, suggestion: 0 });
  });

  it("captures a thrown check as an error finding instead of aborting", async () => {
    const boom: StoryCheck = {
      id: "boom",
      name: "Explodes",
      run: () => {
        throw new Error("kaboom");
      },
    };
    const report = await runChecks([clean, boom]);
    expect(report.ok).toBe(false);
    expect(report.findings[0]?.message).toContain("kaboom");
  });
});
