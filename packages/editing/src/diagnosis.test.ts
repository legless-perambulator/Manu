import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { MockLanguageModel } from "@jellytind/model-router";
import type { PermissionGrant } from "@jellytind/agent-runtime";
import { StoryRepository } from "@jellytind/story-repository";
import { DiagnosisAnalyst, renderTraceForModel } from "./diagnosis-analyst";
import { EditError } from "./types";

const READ_ONLY: PermissionGrant = { permissions: ["read_manuscript", "read_canon"] };
const NO_ACCESS: PermissionGrant = { permissions: [] };

/**
 * The interpreting half of the debugger, with a deterministic model.
 *
 * What is tested here is not whether the model is right — it is a mock — but
 * whether the boundary holds: the evidence is deterministic, the diagnosis is
 * labelled and cited, a citation to nothing is surfaced, and nothing the model
 * says touches the story.
 */
async function novel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "Blackthorn" });

  const marcus = await repo.addCharacter({ name: "Marcus", role: "ally", goals: ["Stay hidden"] });
  const elias = await repo.addCharacter({ name: "Elias", role: "protagonist" });
  const thread = await repo.addPlotThread({ name: "The betrayal", status: "introduced" });
  const chapter = await repo.addChapter({ title: "The Turn", status: "drafted" });

  const early = await repo.addScene({
    title: "The letter",
    chapterId: chapter.id,
    characterIds: [marcus.id],
    plotThreadIds: [thread.id],
    purpose: ["Plant doubt"],
    status: "drafted",
  });
  const reveal = await repo.addScene({
    title: "The turn",
    chapterId: chapter.id,
    characterIds: [marcus.id, elias.id],
    plotThreadIds: [thread.id],
    purpose: ["The betrayal lands"],
    status: "drafted",
  });
  await repo.addStateTransitions([
    { sceneId: early.id, kind: "thread_appearance", subjectId: thread.id, value: "complicates" },
    { sceneId: reveal.id, kind: "thread_appearance", subjectId: thread.id, value: "resolves" },
  ]);

  const scaffold = (await repo.readProjectFile(chapter.filePath)) ?? "";
  await repo.writeProjectFile(chapter.filePath, `${scaffold}\nMarcus did not look up.\n`);

  return { repo, marcus, elias, thread, early, reveal };
}

const diagnosing = (structured: unknown) =>
  new MockLanguageModel({ structured: structured as Record<string, unknown> });

const request = (characterId: string, threadId: string) =>
  ({
    mode: "reveal" as const,
    problem: "Why doesn't Marcus's betrayal land?",
    characterId,
    threadId,
  }) as const;

describe("diagnosing a traced problem", () => {
  it("keeps the diagnosis, its confidence and its citations apart from the evidence", async () => {
    const { repo, marcus, thread } = await novel();
    const analyst = new DiagnosisAnalyst({
      repo,
      model: diagnosing({
        diagnosis: {
          statement: "The reader is ahead of the reveal.",
          reasoning: "Every scene before it carries the same signal.",
          confidence: "moderate",
          uncertainty: ["How the prose frames the letter."],
          basis: ["E1", "E2"],
        },
        interventions: [
          {
            kind: "revise",
            summary: "Reinterpret the letter.",
            rationale: "It repeats a signal already made.",
            effort: "small",
            sceneIds: ["SCENE_0001"],
            entities: ["CHAR_0001"],
          },
        ],
      }),
      grant: READ_ONLY,
      now: () => "2026-01-01T00:00:00.000Z",
    });

    const report = await analyst.debug(request(marcus.id as string, thread.id as string));

    expect(report.id).toBe("DEBUG_0001");
    expect(report.evidence.length).toBeGreaterThan(0);
    expect(report.diagnosis?.statement).toBe("The reader is ahead of the reveal.");
    expect(report.diagnosis?.confidence).toBe("moderate");
    expect(report.diagnosis?.uncertainty).toHaveLength(1);
    expect(report.diagnosis?.basis).toEqual(["E1", "E2"]);
    expect(report.diagnosis?.unsupported).toEqual([]);
    expect(report.interventions[0]?.kind).toBe("revise");
    expect(report.modelId).toBe("mock:test");
  });

  /** The failure worth catching: a conclusion resting on evidence that isn't there. */
  it("surfaces citations to evidence that does not exist", async () => {
    const { repo, marcus, thread } = await novel();
    const analyst = new DiagnosisAnalyst({
      repo,
      model: diagnosing({
        diagnosis: {
          statement: "The setup in chapter nine is the problem.",
          reasoning: "As shown.",
          confidence: "high",
          uncertainty: [],
          basis: ["E1", "E99", "E100"],
        },
      }),
      grant: READ_ONLY,
    });

    const report = await analyst.debug(request(marcus.id as string, thread.id as string));
    expect(report.diagnosis?.basis).toEqual(["E1"]);
    expect(report.diagnosis?.unsupported).toEqual(["E99", "E100"]);
  });

  it("treats an unreadable confidence as low, not high", async () => {
    const { repo, marcus, thread } = await novel();
    const analyst = new DiagnosisAnalyst({
      repo,
      model: diagnosing({
        diagnosis: { statement: "Something is off.", confidence: "certain", basis: [] },
      }),
      grant: READ_ONLY,
    });

    const report = await analyst.debug(request(marcus.id as string, thread.id as string));
    expect(report.diagnosis?.confidence).toBe("low");
  });

  it("drops an intervention with no summary rather than storing an empty one", async () => {
    const { repo, marcus, thread } = await novel();
    const analyst = new DiagnosisAnalyst({
      repo,
      model: diagnosing({
        diagnosis: { statement: "Ahead of the reveal.", confidence: "low", basis: [] },
        interventions: [
          { kind: "add", summary: "", rationale: "…" },
          { kind: "nonsense", summary: "Move the letter later.", effort: "enormous" },
        ],
      }),
      grant: READ_ONLY,
    });

    const report = await analyst.debug(request(marcus.id as string, thread.id as string));
    expect(report.interventions).toHaveLength(1);
    // Unreadable enum values fall back rather than propagating into the report.
    expect(report.interventions[0]?.kind).toBe("revise");
    expect(report.interventions[0]?.effort).toBe("moderate");
  });

  /** A failed interpretation must not cost the writer the investigation. */
  it("still saves the evidence when the model fails", async () => {
    const { repo, marcus, thread } = await novel();
    const analyst = new DiagnosisAnalyst({
      repo,
      model: new MockLanguageModel({ failWith: "provider_error" }),
      grant: READ_ONLY,
    });

    await expect(analyst.debug(request(marcus.id as string, thread.id as string))).rejects.toThrow(
      EditError,
    );

    const saved = await repo.listDebugReports();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.diagnosed).toBe(false);
    expect(saved[0]?.evidenceCount).toBeGreaterThan(0);
  });

  it("refuses without permission to read canon", async () => {
    const { repo, marcus, thread } = await novel();
    const analyst = new DiagnosisAnalyst({
      repo,
      model: diagnosing({ diagnosis: { statement: "…" } }),
      grant: NO_ACCESS,
    });

    await expect(analyst.debug(request(marcus.id as string, thread.id as string))).rejects.toThrow(
      /permission/i,
    );
    expect(await repo.listDebugReports()).toEqual([]);
  });

  /** Diagnosing is not editing. */
  it("changes nothing about the story", async () => {
    const { repo, marcus, thread } = await novel();
    const before = (await repo.listChangeSets()).length;
    const analyst = new DiagnosisAnalyst({
      repo,
      model: diagnosing({
        diagnosis: { statement: "Ahead of the reveal.", confidence: "low", basis: ["E1"] },
        interventions: [{ kind: "revise", summary: "Cut the letter.", effort: "small" }],
      }),
      grant: READ_ONLY,
    });

    await analyst.debug(request(marcus.id as string, thread.id as string));
    expect((await repo.listChangeSets()).length).toBe(before);
  });
});

describe("what the model is shown", () => {
  it("labels the evidence, the measurements and the limits of the prose", async () => {
    const { repo, marcus, thread } = await novel();
    const trace = await repo.traceStoryProblem(request(marcus.id as string, thread.id as string));
    const rendered = renderTraceForModel(trace);

    expect(rendered).toContain("EVIDENCE — deterministic");
    expect(rendered).toContain("Cite these IDs");
    expect(rendered).toContain("E1 [");
    expect(rendered).toContain("MEASUREMENTS — counts, not verdicts.");
    expect(rendered).toContain("NOT inspected:");
    expect(rendered).toContain("Do not reason about text you were not shown");
  });
});
