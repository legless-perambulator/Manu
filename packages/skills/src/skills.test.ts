import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "@jellytind/story-repository";
import type { SkillRun } from "@jellytind/domain";
import { parseSkillCommand } from "./command";
import { loadCustomSkills, parseCustomSkill, saveCustomSkill } from "./custom";
import { OPERATIONS, operationById, sectionsOf, validateWorkflow } from "./operations";
import { SkillRunner, validateReport } from "./runner";
import {
  BUILT_IN_SKILLS,
  CHARACTER_PASS,
  CONTINUITY_AUDIT,
  DIALOGUE_PASS,
  FAIRNESS_AUDIT,
  REMOVE_AI_TENDENCIES,
  SCENE_PURPOSE_AUDIT,
  defineSkill,
  skillByCommand,
} from "./skills";
import { SkillError, type SkillAnalyst } from "./types";

/**
 * A small novel with the material every skill needs: two characters who speak
 * differently, a fact one of them learns, a relationship that moves, a promise
 * planted and kept, and prose with a couple of familiar constructions in it.
 */
async function novel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Cellar Door" });

  const mara = await repo.addCharacter({ name: "Mara", goals: ["find out who sealed the vault"] });
  const elias = await repo.addCharacter({ name: "Elias" });
  const one = await repo.addChapter({ title: "Openings" });
  const two = await repo.addChapter({ title: "The Cellar" });

  const key = await repo.addPlotThread({ name: "The brass key" });
  const fact = await repo.addFact({ statement: "The vault was sealed from the inside" });

  const s1 = await repo.addScene({
    title: "The hall",
    chapterId: one.id,
    pov: mara.id,
    characterIds: [mara.id, elias.id],
    plotThreadIds: [key.id],
    purpose: ["establish the rift"],
  });
  const s2 = await repo.addScene({
    title: "The stairs",
    chapterId: one.id,
    characterIds: [mara.id],
    purpose: ["establish the rift"],
  });
  const s3 = await repo.addScene({
    title: "The cellar",
    chapterId: two.id,
    pov: mara.id,
    characterIds: [mara.id, elias.id],
    plotThreadIds: [key.id],
    purpose: ["keep the promise"],
  });

  await repo.writeProjectFile(
    one.filePath,
    `---\nid: ${one.id}\ntitle: ${one.title}\n---\n\n` +
      `The hall was colder than she remembered. She began to count the doors.\n\n` +
      `"That is not what I said," Mara said. She could not help but look away.\n\n` +
      `"As you know, the vault has been sealed for thirty years, and nobody in this house has ever been willing to say by whom, or why, or what it cost them," Elias replied, at considerable length and with a palpable sense of grievance.\n\n` +
      `She began to answer. The silence was palpable.\n`,
  );
  await repo.writeProjectFile(
    two.filePath,
    `---\nid: ${two.id}\ntitle: ${two.title}\n---\n\n` +
      `The cellar door stood open.\n\n` +
      `"You knew," said Mara.\n\n` +
      `"I did," Elias answered.\n`,
  );

  const relationship = await repo.addRelationship({
    characterAId: mara.id,
    characterBId: elias.id,
    type: "siblings",
  });

  await repo.addStateTransitions([
    { sceneId: s1.id, kind: "thread_appearance", subjectId: key.id, value: "introduces" },
    {
      sceneId: s3.id,
      kind: "knowledge_changed",
      subjectId: mara.id,
      value: fact.id,
      knowledgeState: "known",
      sourceType: "witnessed",
    },
    {
      sceneId: s3.id,
      kind: "relationship_status",
      subjectId: relationship.id,
      value: "broken",
    },
  ]);

  await repo.addSetup({
    description: "A brass key left in the hall drawer",
    setupSceneIds: [s1.id],
    payoffSceneIds: [s3.id],
  });
  await repo.addSetup({ description: "The scratches on the cellar door" });

  await repo.addStoryTest({
    name: "Mara knows about the seal by the end",
    assertion: { kind: "character_knows_fact", characterId: mara.id, factId: fact.id },
  });

  await repo.characterVoices.setProfile(mara.id, {
    attributes: { directness: { value: "blunt" } },
  });
  await repo.characterVoices.addExample({ characterId: mara.id, text: "That is not what I said." });

  return { repo, store, mara, elias, one, two, s1, s2, s3, fact, relationship };
}

const runnerFor = (repo: StoryRepository, analyst: SkillAnalyst | null = null) =>
  new SkillRunner({ repo, runs: repo.skillRuns, analyst });

const statuses = (run: SkillRun) => run.steps.map((step) => step.status);

// ── The workflow model ──────────────────────────────────────────────────────

describe("a skill is a workflow, not a prompt", () => {
  it("composes every built-in skill from the operation registry", () => {
    for (const skill of BUILT_IN_SKILLS) {
      expect(skill.steps.length).toBeGreaterThan(1);
      for (const step of skill.steps) {
        expect(() => operationById(step.operationId)).not.toThrow();
      }
    }
  });

  it("derives each skill's tools and recipes from its steps rather than restating them", () => {
    const tools = new Set(
      CHARACTER_PASS.steps.flatMap((step) => operationById(step.operationId).requiredTools),
    );
    expect([...CHARACTER_PASS.requiredTools].sort()).toEqual([...tools].sort());
    expect(CHARACTER_PASS.outputSchema.sections).toEqual(sectionsOf(CHARACTER_PASS.steps));
  });

  it("gives every skill a distinct id and command", () => {
    expect(new Set(BUILT_IN_SKILLS.map((s) => s.id)).size).toBe(BUILT_IN_SKILLS.length);
    expect(new Set(BUILT_IN_SKILLS.map((s) => s.command)).size).toBe(BUILT_IN_SKILLS.length);
  });

  it("refuses a workflow whose step reads something no earlier step produces", () => {
    expect(() =>
      validateWorkflow(
        [
          { id: "a", operationId: "reconstruct_chronology", title: "Chronology" },
          { id: "b", operationId: "compile_report", title: "Report" },
        ],
        [],
      ),
    ).toThrowError(/reads "scenes"/);
  });

  it("refuses a workflow whose step needs an input the skill never declares", () => {
    expect(() =>
      validateWorkflow([{ id: "a", operationId: "locate_character_scenes", title: "Locate" }], []),
    ).toThrowError(/needs the input "characterId"/);
  });

  it("names every operation exactly once", () => {
    expect(new Set(OPERATIONS.map((op) => op.id)).size).toBe(OPERATIONS.length);
  });
});

// ── /character-pass ─────────────────────────────────────────────────────────

describe("/character-pass", () => {
  it("runs every step against the project with no model configured", async () => {
    const { repo, mara } = await novel();
    const lines: string[] = [];
    const run = await runnerFor(repo).start(
      CHARACTER_PASS,
      { characterId: mara.id },
      { onProgress: (event) => lines.push(event.line) },
    );

    expect(run.status).toBe("completed");
    expect(statuses(run)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(validateReport(CHARACTER_PASS, run)).toEqual([]);

    // The progress display the specification asks for: a line per step, in order.
    expect(lines.some((line) => line.startsWith("→ Locate every scene"))).toBe(true);
    expect(lines.some((line) => /^✓ Located 3 scene\(s\)/.test(line))).toBe(true);
  });

  it("reconstructs what the project records rather than describing it", async () => {
    const { repo, mara, fact } = await novel();
    const run = await runnerFor(repo).start(CHARACTER_PASS, { characterId: mara.id });

    const knowledge = run.outputs.knowledge as { acquisitions: Array<{ factId: string }> };
    expect(knowledge.acquisitions.map((entry) => entry.factId)).toContain(fact.id);

    const relationships = run.outputs.relationships as {
      relationships: Array<{ with: string; changes: unknown[] }>;
    };
    expect(relationships.relationships[0]?.with).toBe("Elias");
    expect(relationships.relationships[0]?.changes).toHaveLength(1);

    const arc = run.outputs.arc as { relationshipChanges: number; acquisitions: number };
    expect(arc.acquisitions).toBe(1);
    expect(arc.relationshipChanges).toBe(1);
  });

  it("says the same thing twice on an unchanged project", async () => {
    const { repo, mara } = await novel();
    const runner = runnerFor(repo);
    const first = await runner.start(CHARACTER_PASS, { characterId: mara.id });
    const second = await runner.start(CHARACTER_PASS, { characterId: mara.id });

    expect(second.findings.map((f) => f.statement)).toEqual(first.findings.map((f) => f.statement));
    expect(second.measurements).toEqual(first.measurements);
  });

  it("stops rather than inventing a pass for a character who appears nowhere", async () => {
    const { repo } = await novel();
    const ghost = await repo.addCharacter({ name: "Nobody" });
    const run = await runnerFor(repo).start(CHARACTER_PASS, { characterId: ghost.id });

    expect(run.steps[0]?.status).toBe("skipped");
    expect(run.steps[0]?.reason).toMatch(/appears in no recorded scene/);
    expect(run.status).toBe("completed");
  });

  it("refuses to start without the input it needs", async () => {
    const { repo } = await novel();
    await expect(runnerFor(repo).start(CHARACTER_PASS, {})).rejects.toThrowError(/needs Character/);
  });

  it("records a gap rather than a verdict when nothing is recorded", async () => {
    const { repo, elias } = await novel();
    const run = await runnerFor(repo).start(CHARACTER_PASS, { characterId: elias.id });
    const gaps = run.findings.filter((f) => f.kind === "gap");
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((f) => f.source === "deterministic")).toBe(true);
    // No goals recorded for Elias, and the finding says exactly that.
    expect(gaps.some((f) => /No goals are recorded/.test(f.statement))).toBe(true);
  });
});

// ── Failure and resumption ──────────────────────────────────────────────────

describe("a failed step is resumable", () => {
  /** A repository whose story tests explode, as a provider or a disk might. */
  const breaking = (repo: StoryRepository, method: string) =>
    new Proxy(repo, {
      get(target, property, receiver) {
        if (property === method) {
          return () => Promise.reject(new Error("the disk went away"));
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    }) as StoryRepository;

  it("keeps the steps that did run, then continues from the one that failed", async () => {
    const { repo } = await novel();
    const failing = await runnerFor(breaking(repo, "runStoryTests")).start(CONTINUITY_AUDIT);

    expect(failing.status).toBe("failed");
    expect(failing.failureReason).toMatch(/the disk went away/);
    expect(statuses(failing)).toEqual(["ok", "ok", "failed", "pending", "pending", "pending"]);
    // The work already done is on disk, not lost with the failure.
    expect(failing.outputs.build).toBeDefined();

    const buildsBefore = (await repo.listBuilds()).length;
    const resumed = await runnerFor(repo).resume(failing.id, CONTINUITY_AUDIT);

    expect(resumed.status).toBe("completed");
    expect(resumed.resumeCount).toBe(1);
    expect(resumed.failureReason).toBeUndefined();
    // Step one was not run again: no second build was produced.
    expect((await repo.listBuilds()).length).toBe(buildsBefore);
    expect(resumed.steps[0]?.startedAt).toBe(failing.steps[0]?.startedAt);
    expect(resumed.steps[2]?.status).toBe("ok");
  });

  it("survives a restart, because the run is on disk rather than in memory", async () => {
    const { repo, store } = await novel();
    const failing = await runnerFor(breaking(repo, "runStoryTests")).start(CONTINUITY_AUDIT);

    // A whole new repository over the same files: the app was closed and reopened.
    const reopened = await StoryRepository.openProject({ store });
    const resumed = await runnerFor(reopened).resume(failing.id, CONTINUITY_AUDIT);

    expect(resumed.status).toBe("completed");
    expect(resumed.outputs.build).toEqual(failing.outputs.build);
  });

  it("will not resume a run that already finished", async () => {
    const { repo } = await novel();
    const done = await runnerFor(repo).start(SCENE_PURPOSE_AUDIT);
    await expect(runnerFor(repo).resume(done.id, SCENE_PURPOSE_AUDIT)).rejects.toThrowError(
      /already completed/,
    );
  });
});

// ── The model is optional ───────────────────────────────────────────────────

describe("semantic steps", () => {
  const analyst: SkillAnalyst = {
    modelId: "mock-model",
    read: () =>
      Promise.resolve([
        { statement: "Elias explains the seal to someone who already knows about it." },
      ]),
  };

  it("are skipped with a stated reason when no model is configured", async () => {
    const { repo } = await novel();
    const run = await runnerFor(repo).start(DIALOGUE_PASS);
    const subtext = run.steps.find((step) => step.operationId === "inspect_subtext");

    expect(subtext?.status).toBe("skipped");
    expect(subtext?.reason).toMatch(/No model is configured/);
    expect(run.status).toBe("completed");
    // Skipped is not passed: the report never claims subtext was inspected.
    expect(run.findings.some((f) => f.source === "model")).toBe(false);
  });

  it("label everything they contribute as model-derived", async () => {
    const { repo } = await novel();
    const run = await runnerFor(repo, analyst).start(DIALOGUE_PASS);
    const fromModel = run.findings.filter((f) => f.source === "model");

    expect(fromModel).toHaveLength(1);
    expect(fromModel[0]?.basis).toMatch(/mock-model/);
    expect(fromModel[0]?.basis).toMatch(/nothing has been changed/);
    expect(run.modelId).toBe("mock-model");
  });
});

// ── /dialogue-pass and /remove-ai-tendencies ────────────────────────────────

describe("the other shipped skills", () => {
  it("pulls dialogue off the page and says what it could not attribute", async () => {
    const { repo, mara } = await novel();
    const run = await runnerFor(repo).start(DIALOGUE_PASS);
    const dialogue = run.outputs.dialogue as {
      attributed: number;
      unattributed: number;
      speakerIds: string[];
    };

    expect(dialogue.speakerIds).toContain(mara.id);
    expect(dialogue.attributed).toBeGreaterThan(0);
    expect(run.status).toBe("completed");
    if (dialogue.unattributed > 0) {
      expect(run.notMeasured.some((note) => /no speech tag/.test(note))).toBe(true);
    }
  });

  it("flags dialogue addressed to someone who is told they already know", async () => {
    const { repo } = await novel();
    const run = await runnerFor(repo).start(DIALOGUE_PASS);
    expect(run.findings.some((f) => /already know/.test(f.statement))).toBe(true);
  });

  it("counts constructions without calling them faults, and changes nothing", async () => {
    const { repo, one } = await novel();
    const before = await repo.readProjectFile(one.filePath);
    const run = await runnerFor(repo).start(REMOVE_AI_TENDENCIES);

    const tendencies = run.outputs.tendencies as { hits: Array<{ id: string; count: number }> };
    const began = tendencies.hits.find((hit) => hit.id === "began_to");
    expect(began?.count).toBe(2);
    expect(tendencies.hits.find((hit) => hit.id === "palpable")?.count).toBe(2);

    // Measurements, not verdicts — and the manuscript is untouched.
    expect(run.findings.filter((f) => f.kind === "measurement").length).toBeGreaterThan(0);
    expect(await repo.readProjectFile(one.filePath)).toBe(before);
  });

  it("reports scenes that record no change without claiming they are pointless", async () => {
    const { repo, s2 } = await novel();
    const run = await runnerFor(repo).start(SCENE_PURPOSE_AUDIT);
    const inert = run.findings.find((f) => /record no change/.test(f.statement));

    expect(inert?.kind).toBe("gap");
    expect(inert?.sceneIds).toContain(s2.id);
    expect(inert?.detail).toMatch(/may still change something on the page/);
  });

  it("notices two consecutive scenes stating the same purpose", async () => {
    const { repo } = await novel();
    const run = await runnerFor(repo).start(SCENE_PURPOSE_AUDIT);
    expect(run.findings.some((f) => /same purpose/.test(f.statement))).toBe(true);
  });
});

// ── Commands ────────────────────────────────────────────────────────────────

describe("/skill commands", () => {
  it("resolves a name against the project's own entities", async () => {
    const { repo, mara } = await novel();
    const parsed = parseSkillCommand("/character-pass Mara", await repo.listEntitySummaries());

    expect(parsed.skill.id).toBe("character_pass");
    expect(parsed.inputs.characterId).toBe(mara.id);
    expect(parsed.resolved[0]).toMatch(/Mara → Mara \(CHAR_/);
  });

  it("refuses rather than guessing when the argument matches nothing", async () => {
    const { repo } = await novel();
    const entities = await repo.listEntitySummaries();
    expect(() => parseSkillCommand("/character-pass Nobody", entities)).toThrowError(
      /needs character/i,
    );
  });

  it("says plainly when a command is not a skill", () => {
    expect(() => parseSkillCommand("/make-it-good", [])).toThrowError(/not a skill Manu has/);
  });

  it("runs a skill that needs no arguments", () => {
    expect(skillByCommand("/continuity-audit")?.id).toBe("continuity_audit");
  });
});

// ── Custom skills ───────────────────────────────────────────────────────────

describe("skills a writer writes", () => {
  const file = (steps: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      id: "promise_sweep",
      name: "Promise Sweep",
      description: "Just the promises.",
      steps,
      ...extra,
    });

  it("loads a workflow composed of the same operations", () => {
    const skill = parseCustomSkill(
      file([{ operationId: "inspect_setups" }, { operationId: "compile_report" }]),
      "test.json",
    );
    expect(skill.custom).toBe(true);
    expect(skill.command).toBe("/promise-sweep");
    expect(skill.requiredTools).toContain("list_setups");
  });

  it("runs exactly like a shipped skill", async () => {
    const { repo } = await novel();
    const skill = parseCustomSkill(
      file([
        { operationId: "inspect_setups" },
        { operationId: "measure_setup_distance" },
        { operationId: "compile_report" },
      ]),
      "test.json",
    );
    const run = await runnerFor(repo).start(skill);

    expect(run.status).toBe("completed");
    expect(run.findings.some((f) => /still outstanding/.test(f.statement))).toBe(true);
  });

  it("cannot name an operation Manu does not have", () => {
    expect(() =>
      parseCustomSkill(file([{ operationId: "rewrite_everything" }]), "mine.json"),
    ).toThrowError(/"rewrite_everything", which is not an operation Manu has/);
  });

  it("cannot take over a shipped skill's id", () => {
    expect(() =>
      parseCustomSkill(
        JSON.stringify({
          id: "character_pass",
          name: "Mine",
          steps: [{ operationId: "compile_report" }],
        }),
        "mine.json",
      ),
    ).toThrowError(/is the id of a skill Manu ships with/);
  });

  it("names the file and the problem when the JSON is broken", () => {
    expect(() => parseCustomSkill("{not json", "mine.json")).toThrowError(
      /mine\.json: not valid JSON/,
    );
  });

  it("is stored in the project and loaded back, with broken files reported not swallowed", async () => {
    const { repo } = await novel();
    await saveCustomSkill(repo, {
      id: "promise_sweep",
      name: "Promise Sweep",
      steps: [{ operationId: "inspect_setups" }, { operationId: "compile_report" }],
    });
    await repo.writeProjectFile(".writer/skills/custom/broken.json", "{oops");

    const loaded = await loadCustomSkills(repo);
    expect(loaded.skills.map((skill) => skill.id)).toEqual(["promise_sweep"]);
    expect(loaded.problems).toHaveLength(1);
    expect(loaded.problems[0]?.path).toMatch(/broken\.json$/);
  });

  it("refuses to write a skill that could not run", async () => {
    const { repo } = await novel();
    await expect(
      saveCustomSkill(repo, {
        id: "bad",
        name: "Bad",
        steps: [{ operationId: "reconstruct_chronology" }],
      }),
    ).rejects.toThrowError(/reads "scenes"/);
    expect(await repo.fileExists(".writer/skills/custom/bad.json")).toBe(false);
  });
});

// ── The promised shape ──────────────────────────────────────────────────────

describe("the output schema is enforced, not decorative", () => {
  it("fails a run that did not produce a section it declared", async () => {
    const { repo } = await novel();
    const skill = defineSkill({
      id: "shape_test",
      command: "/shape-test",
      name: "Shape",
      description: "",
      steps: [{ operationId: "inspect_setups" }, { operationId: "compile_report" }],
    });
    const run = await runnerFor(repo).start(skill);
    expect(run.status).toBe("completed");

    const tampered = { ...run, outputs: { report: run.outputs.report } };
    expect(validateReport(skill, tampered)).toEqual([
      'shape_test_report declares "setups", which no step produced.',
    ]);
  });

  it("allows a section to be absent when its step was skipped and said why", async () => {
    const { repo } = await novel();
    const run = await runnerFor(repo).start(DIALOGUE_PASS);
    expect(run.outputs.subtext).toBeUndefined();
    expect(validateReport(DIALOGUE_PASS, run)).toEqual([]);
  });

  it("reports a run through one summary, whatever produced it", async () => {
    const { repo } = await novel();
    const run = await runnerFor(repo).start(SCENE_PURPOSE_AUDIT);
    const report = run.outputs.report as {
      total: number;
      deterministic: number;
      modelDerived: number;
    };
    expect(report.total).toBe(run.findings.length);
    expect(report.modelDerived).toBe(0);
    expect(report.deterministic).toBe(report.total);
  });
});

// ── The fairness audit ──────────────────────────────────────────────────────

/**
 * A mystery laid over the same three scenes.
 *
 * Two clues the reader is shown, one deduction from them, one solution, and an
 * alibi with nobody to back it up. No prose is touched: the audit reads the
 * clue system (docs/MYSTERY_ENGINE.md).
 */
async function mysteryIn(project: Awaited<ReturnType<typeof novel>>) {
  const { repo, elias, s1, s2, s3 } = project;
  const mystery = await repo.mysteries.addMystery({
    name: "The sealed vault",
    question: "Who sealed the vault?",
    solution: "Elias did.",
    culpritIds: [elias.id],
    revealSceneId: s3.id,
    intendedSolvableFromSceneId: s2.id,
    status: "active",
  });
  const board = await repo.mysteries.addClue({
    mysteryId: mystery.id,
    description: "A key missing from the board",
    source: "absence",
    firstAppearance: s1.id,
  });
  const coat = await repo.mysteries.addClue({
    mysteryId: mystery.id,
    description: "Elias's coat is damp to the elbow",
    firstAppearance: s2.id,
  });
  const step = await repo.mysteries.addDeduction({
    mysteryId: mystery.id,
    statement: "Whoever sealed it went down first",
    premises: [board.id, coat.id],
  });
  await repo.mysteries.addDeduction({
    mysteryId: mystery.id,
    statement: "Elias sealed the vault",
    premises: [step.id],
    isSolution: true,
  });
  await repo.mysteries.setSuspect({
    mysteryId: mystery.id,
    characterId: elias.id,
    motive: "cut out of the will",
    alibi: { claim: "He says he was in the hall.", coversSceneId: s1.id },
    evidenceFor: [board.id, coat.id],
    evidenceAgainst: [],
  });
  return { mystery, board, coat };
}

describe("the fairness audit", () => {
  it("answers the question in named steps against the clue system", async () => {
    const project = await novel();
    const { mystery } = await mysteryIn(project);
    const run = await runnerFor(project.repo).start(FAIRNESS_AUDIT, { mysteryId: mystery.id });

    expect(run.status).toBe("completed");
    expect(run.steps.map((step) => step.title)).toEqual([
      "Load the clue system",
      "Resolve the chain of reasoning",
      "Ask whether the reader could have got there",
      "Estimate the earliest solvable point",
      "Check alibis against the timeline",
      "Check whether simulated readers get there early",
      "Produce report",
    ]);
    expect((run.outputs.fairness as { verdict: string }).verdict).toBe("fair");
    expect((run.outputs.solvability as { earliestPosition: number }).earliestPosition).toBe(2);
    expect(validateReport(FAIRNESS_AUDIT, run)).toEqual([]);
  });

  it("names the premise the reader never got, and says so as a conflict", async () => {
    const project = await novel();
    const { mystery, coat } = await mysteryIn(project);
    // The coat now only appears in the reveal itself.
    await project.repo.mysteries.updateClue(coat.id, {
      firstAppearance: project.s3.id,
      readerExposure: [project.s3.id],
    });

    const run = await runnerFor(project.repo).start(FAIRNESS_AUDIT, { mysteryId: mystery.id });
    const conflicts = run.findings.filter((entry) => entry.kind === "conflict");

    expect((run.outputs.fairness as { verdict: string }).verdict).toBe("unfair");
    expect(conflicts.some((entry) => /at or after the reveal/.test(entry.statement))).toBe(true);
    expect(conflicts.every((entry) => entry.source === "deterministic")).toBe(true);
  });

  it("skips the reader comparison with a reason rather than reporting it clean", async () => {
    const project = await novel();
    const { mystery } = await mysteryIn(project);
    const run = await runnerFor(project.repo).start(FAIRNESS_AUDIT, { mysteryId: mystery.id });

    const step = run.steps.find((entry) => entry.id === "detect_obviousness");
    expect(step?.status).toBe("skipped");
    expect(step?.reason).toMatch(/No completed reader simulations are stored/);
    expect(run.outputs.obviousness).toBeUndefined();
  });

  it("reports an alibi nothing corroborates without calling it a verdict on guilt", async () => {
    const project = await novel();
    const { mystery } = await mysteryIn(project);
    const run = await runnerFor(project.repo).start(FAIRNESS_AUDIT, { mysteryId: mystery.id });

    const alibi = run.findings.find((entry) => /nobody to corroborate/.test(entry.statement));
    expect(alibi?.kind).toBe("attention");
    expect(JSON.stringify(run.outputs)).not.toMatch(/guilty|score|probability/i);
  });

  it("runs the whole workflow with no model at all", async () => {
    const project = await novel();
    const { mystery } = await mysteryIn(project);
    const run = await runnerFor(project.repo).start(FAIRNESS_AUDIT, { mysteryId: mystery.id });
    expect(run.findings.every((entry) => entry.source === "deterministic")).toBe(true);
    expect(
      FAIRNESS_AUDIT.steps.every(
        (step) => operationById(step.operationId).kind === "deterministic",
      ),
    ).toBe(true);
  });

  it("needs a mystery before it will run", async () => {
    const { repo } = await novel();
    await expect(runnerFor(repo).start(FAIRNESS_AUDIT, {})).rejects.toThrowError(/needs Mystery/);
  });
});

// ── Errors ──────────────────────────────────────────────────────────────────

describe("errors", () => {
  it("carries a machine-readable code", () => {
    expect(new SkillError("unknown_skill", "nope").code).toBe("unknown_skill");
  });
});
