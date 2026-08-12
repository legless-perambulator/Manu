import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import {
  ToolExecutor,
  ToolRegistry,
  READ_ONLY_GRANT,
  createProjectTools,
  createRefactorTools,
  type PermissionGrant,
} from "@jellytind/agent-runtime";
import { MockLanguageModel } from "@jellytind/model-router";
import { StoryRepository, sceneMarker } from "@jellytind/story-repository";
import { analyseRefactor } from "./analyse";
import { planRefactor, locate } from "./plan";
import { failedValidation, stageRefactor } from "./execute";
import { renderAnalysis, renderValidation } from "./present";
import { RefactorPlanner } from "./planner";
import { refactorAccess } from "./access";
import { RefactorError, type RefactorRequest } from "./types";

const GRANT: PermissionGrant = {
  permissions: ["read_manuscript", "read_canon", "edit_manuscript"],
};
const READ_ONLY: PermissionGrant = { permissions: ["read_manuscript", "read_canon"] };

/**
 * The populated fixture mystery from the acceptance scenario.
 *
 * Marcus is Elias's brother, and the story is built on it: the inheritance
 * thread turns on the sibling bond, a fact records the family history, the
 * prose says "brother" in two chapters, and a story test asserts the
 * relationship. Everything the refactor must find is here on purpose.
 */
async function mystery() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "Blackthorn" });

  const elias = await repo.addCharacter({ name: "Elias", role: "protagonist" });
  const marcus = await repo.addCharacter({
    name: "Marcus Vale",
    role: "ally",
    goals: ["Keep the estate in the family"],
  });
  const manor = await repo.addLocation({ name: "Blackthorn Manor" });

  const inheritance = await repo.addPlotThread({
    name: "The inheritance",
    description: "Who the estate passes to when the father dies.",
    status: "introduced",
  });
  const family = await repo.addFact({
    statement: "Marcus and Elias share a father.",
  });

  const relationship = await repo.addRelationship({
    characterAId: marcus.id,
    characterBId: elias.id,
    type: "brother",
    status: "close",
    description: "Marcus is Elias's older brother.",
  });

  const four = await repo.addChapter({ title: "The Brothers", status: "drafted" });
  const twelve = await repo.addChapter({ title: "The Vault", status: "drafted" });
  const sixteen = await repo.addChapter({ title: "The Reckoning", status: "drafted" });

  const history = await repo.addScene({
    title: "Sibling history",
    chapterId: four.id,
    locationId: manor.id,
    characterIds: [marcus.id, elias.id],
    plotThreadIds: [inheritance.id],
    factIds: [family.id],
    purpose: ["Establish the brothers"],
    status: "drafted",
  });
  const vault = await repo.addScene({
    title: "The vault discovery",
    chapterId: twelve.id,
    locationId: manor.id,
    characterIds: [elias.id],
    plotThreadIds: [inheritance.id],
    status: "drafted",
  });
  const reckoning = await repo.addScene({
    title: "The reckoning",
    chapterId: sixteen.id,
    locationId: manor.id,
    characterIds: [marcus.id, elias.id],
    plotThreadIds: [inheritance.id],
    status: "drafted",
  });

  await repo.addStateTransitions([
    { sceneId: history.id, kind: "fact_established", subjectId: family.id, value: family.id },
    {
      sceneId: history.id,
      kind: "relationship_event",
      subjectId: relationship.id,
      value: "alliance",
    },
    { sceneId: vault.id, kind: "thread_appearance", subjectId: inheritance.id, value: "advances" },
    {
      sceneId: reckoning.id,
      kind: "thread_appearance",
      subjectId: inheritance.id,
      value: "resolves",
    },
  ]);

  await repo.addDependencies([
    { kind: "enables", fromId: history.id, toId: vault.id },
    { kind: "causes", fromId: vault.id, toId: reckoning.id },
    { kind: "resolves", fromId: reckoning.id, toId: inheritance.id },
  ]);

  await repo.addStoryTest({
    name: "Marcus and Elias must be close entering the reckoning",
    assertion: { kind: "relationship_status", relationshipId: relationship.id, status: "close" },
    scope: { kind: "at", anchorId: reckoning.id },
  });

  const prose = async (filePath: string, sceneId: string, body: string) => {
    const scaffold = (await repo.readProjectFile(filePath)) ?? "";
    await repo.writeProjectFile(filePath, `${scaffold}\n${sceneMarker(sceneId)}\n${body}\n`);
  };
  await prose(
    four.filePath,
    history.id as string,
    "Marcus Vale had been his brother for thirty-one years, and Elias had never once\n" +
      "asked what that cost him. His brother poured the tea. Their father's name sat\n" +
      "between them like a third chair.",
  );
  await prose(
    twelve.filePath,
    vault.id as string,
    "The vault door gave. Elias thought of his brother, and of what Marcus Vale\n" +
      "would say when he learned what lay behind it.",
  );
  await prose(
    sixteen.filePath,
    reckoning.id as string,
    "Marcus Vale was waiting at the top of the stairs.",
  );

  return {
    store,
    repo,
    elias,
    marcus,
    manor,
    inheritance,
    family,
    relationship,
    four,
    twelve,
    sixteen,
    history,
    vault,
    reckoning,
  };
}

const BROTHERS: RefactorRequest = {
  kind: "change_relationship",
  relationshipId: "REL_0001",
  newType: "childhood friend",
  newStatus: "close",
  newDescription: "Marcus and Elias grew up on the same estate.",
  oldTerms: ["brother"],
  newTerm: "friend",
  instruction: "Make Marcus Elias's childhood friend instead.",
};

describe("analysis finds what the change reaches", () => {
  it("identifies the structured entities and the manuscript, without a model", async () => {
    const { repo, relationship, inheritance, family, history, reckoning } = await mystery();

    const analysis = await analyseRefactor(repo, {
      ...BROTHERS,
      relationshipId: relationship.id as string,
    });

    const affected = analysis.affected.map((a) => a.id);
    expect(affected).toContain(inheritance.id);
    expect(affected).toContain(family.id);
    expect(affected).toContain(history.id);
    expect(affected).toContain(reckoning.id);

    // The prose that says the word, counted per chapter.
    expect(analysis.manuscriptReferences.map((r) => r.occurrences).reduce((a, b) => a + b, 0)).toBe(
      3,
    );
    expect(analysis.knowledgeTransitionIds.length).toBeGreaterThan(0);
    expect(analysis.storyTestIds).toHaveLength(1);
  });

  it("names the high risks by ID", async () => {
    const { repo, relationship, inheritance, family } = await mystery();
    const analysis = await analyseRefactor(repo, {
      ...BROTHERS,
      relationshipId: relationship.id as string,
    });

    expect(analysis.highRisk).toContain(inheritance.id);
    expect(analysis.highRisk).toContain(family.id);
  });

  /** A risk the project found and a risk a model raised are different things. */
  it("labels every risk with where it came from", async () => {
    const { repo, relationship } = await mystery();
    const analysis = await analyseRefactor(repo, {
      ...BROTHERS,
      relationshipId: relationship.id as string,
    });

    expect(analysis.risks.every((r) => r.source === "structured")).toBe(true);
    expect(renderAnalysis(analysis)).toContain("[RECORDED]");
  });

  it("refuses a target that is not in the project", async () => {
    const { repo } = await mystery();
    await expect(
      analyseRefactor(repo, { ...BROTHERS, relationshipId: "REL_9999" }),
    ).rejects.toBeInstanceOf(RefactorError);
  });
});

describe("the acceptance scenario", () => {
  it("stages, validates, shows diffs, and commits only on approval", async () => {
    const fixture = await mystery();
    const { repo, relationship, marcus, elias, four } = fixture;
    const request = { ...BROTHERS, relationshipId: relationship.id as string };

    const before = await repo.listChangeSets();
    const staged = await stageRefactor(request, { repo, grant: GRANT });

    // 4–6: what it found, what it risks, what it plans.
    expect(staged.run.analysis.affected.length).toBeGreaterThan(0);
    expect(staged.run.analysis.highRisk.length).toBeGreaterThan(0);
    expect(staged.run.plan.steps.some((s) => s.kind === "update_entity")).toBe(true);
    expect(staged.run.plan.steps.some((s) => s.kind === "replace_text")).toBe(true);
    // The consequences it will not fix for you, said out loud.
    expect(staged.run.plan.steps.some((s) => s.kind === "manual")).toBe(true);

    // 7–8: staged, with a checkpoint, and the diffs are real.
    expect(staged.run.checkpointId).toBeDefined();
    expect(staged.run.stagedFiles.length).toBeGreaterThan(1);
    const chapterDiff = staged.run.stagedFiles.find((f) => f.path === four.filePath);
    expect(chapterDiff?.before).toContain("his brother");
    expect(chapterDiff?.after).toContain("his friend");

    // 9–10: the compiler and the writer's own tests ran, before anything moved.
    expect(staged.run.before?.testsTotal).toBe(1);
    expect(staged.run.after).toBeDefined();

    // Nothing has happened yet: no change set, and the record still says brother.
    expect((await repo.getEntity<{ type: string }>(relationship.id))?.type).toBe("brother");
    expect(await repo.listChangeSets()).toHaveLength(before.length);

    // 11: the writer accepts.
    const committed = await staged.commit("Looks right.");
    expect(committed.status).toBe("committed");
    expect(committed.changeSetId).toBeDefined();
    expect(committed.approvedAt).toBeDefined();

    // 12: stable IDs are untouched.
    expect((await repo.getEntity<{ id: string; type: string }>(relationship.id))?.id).toBe(
      relationship.id,
    );
    expect((await repo.getEntity<{ type: string }>(relationship.id))?.type).toBe(
      "childhood friend",
    );
    expect(await repo.getEntity(marcus.id)).not.toBeNull();
    expect(await repo.getEntity(elias.id)).not.toBeNull();

    // The prose moved with it.
    expect(await repo.readProjectFile(four.filePath)).toContain("his friend");
    expect(await repo.readProjectFile(four.filePath)).not.toContain("his brother");

    // 13: the whole operation is in the history, as one change set.
    const history = await repo.listChangeSets();
    const change = history.find((c) => c.id === committed.changeSetId);
    expect(change?.operation).toBe("refactor_change_relationship");
    // Exactly one: a structural change to a novel is one entry, not eleven.
    expect(history).toHaveLength(before.length + 1);
    expect((await repo.listCheckpoints()).some((c) => c.label.startsWith("Before refactor"))).toBe(
      true,
    );

    // …and in the audit trail, with everything it did.
    const record = await repo.getRefactorRun<typeof committed>(committed.id);
    expect(record?.instruction).toBe("Make Marcus Elias's childhood friend instead.");
    expect(record?.analysis.targets).toContain(relationship.id);
    expect(record?.plan.steps.length).toBeGreaterThan(0);
    expect(record?.stagedFiles.length).toBeGreaterThan(0);
    expect(record?.before).toBeDefined();
    expect(record?.after).toBeDefined();
    expect(record?.checkpointId).toBeDefined();
  });

  /** 14: the project is still a project. */
  it("leaves a project that reopens and builds", async () => {
    const { store, repo, relationship } = await mystery();
    const staged = await stageRefactor(
      { ...BROTHERS, relationshipId: relationship.id as string },
      { repo, grant: GRANT },
    );
    await staged.commit();

    const reopened = await StoryRepository.openProject({ store });
    expect(reopened.project.title).toBe("Blackthorn");
    expect((await reopened.getEntity<{ type: string }>(relationship.id))?.type).toBe(
      "childhood friend",
    );
    const build = await reopened.buildStory({ persist: false });
    expect(build.counts.error).toBe(0);
    expect((await reopened.runStoryTests()).deterministic.failed).toBe(0);
  });
});

describe("discarding", () => {
  it("touches nothing", async () => {
    const { repo, relationship, four } = await mystery();
    const proseBefore = await repo.readProjectFile(four.filePath);

    const staged = await stageRefactor(
      { ...BROTHERS, relationshipId: relationship.id as string },
      { repo, grant: GRANT, checkpoint: false },
    );
    const discarded = await staged.discard("Not yet.");

    expect(discarded.status).toBe("discarded");
    expect((await repo.getEntity<{ type: string }>(relationship.id))?.type).toBe("brother");
    expect(await repo.readProjectFile(four.filePath)).toBe(proseBefore);
    // The record survives: a refactor considered and rejected is worth knowing.
    expect((await repo.listRefactorRuns())[0]?.status).toBe("discarded");
  });

  it("cannot be decided twice", async () => {
    const { repo, relationship } = await mystery();
    const staged = await stageRefactor(
      { ...BROTHERS, relationshipId: relationship.id as string },
      { repo, grant: GRANT, checkpoint: false },
    );
    await staged.discard();
    await expect(staged.commit()).rejects.toThrow(/already been decided/);
  });

  /** The checkpoint is the escape hatch after the fact. */
  it("can be undone after committing, by reverting or by checkpoint", async () => {
    const { repo, relationship, four } = await mystery();
    const staged = await stageRefactor(
      { ...BROTHERS, relationshipId: relationship.id as string },
      { repo, grant: GRANT },
    );
    const committed = await staged.commit();

    await repo.revertChangeSet(committed.changeSetId as string);

    expect((await repo.getEntity<{ type: string }>(relationship.id))?.type).toBe("brother");
    expect(await repo.readProjectFile(four.filePath)).toContain("his brother");
  });
});

describe("renaming", () => {
  it("changes the display name and the prose, never the ID", async () => {
    const { repo, marcus, four } = await mystery();
    const staged = await stageRefactor(
      {
        kind: "rename_entity",
        entityId: marcus.id as string,
        newName: "Marcus Kane",
        instruction: "Rename Marcus Vale to Marcus Kane.",
      },
      { repo, grant: GRANT, checkpoint: false },
    );
    const committed = await staged.commit();

    const after = await repo.getEntity<{ id: string; name: string; aliases: string[] }>(marcus.id);
    expect(after?.id).toBe(marcus.id);
    expect(after?.name).toBe("Marcus Kane");
    // The old name stays findable.
    expect(after?.aliases).toContain("Marcus Vale");

    expect(await repo.readProjectFile(four.filePath)).toContain("Marcus Kane");
    expect(await repo.readProjectFile(four.filePath)).not.toContain("Marcus Vale");
    expect(committed.status).toBe("committed");
  });

  /** Whole-word only: renaming must not rewrite the middle of another word. */
  it("replaces whole words only", () => {
    const found = locate("Marcus and Marcuses and Marcus.", "Marcus", "Kane");
    expect(found).toHaveLength(2);
    expect(found[0]?.after).toContain("Kane and Marcuses");
  });

  it("refuses a rename that changes nothing", async () => {
    const { repo, marcus } = await mystery();
    await expect(
      stageRefactor(
        { kind: "rename_entity", entityId: marcus.id as string, newName: "Marcus Vale" },
        { repo, grant: GRANT, checkpoint: false },
      ),
    ).rejects.toThrow(/already called that/);
  });
});

describe("changing an attribute", () => {
  it("moves the field and the word the prose uses", async () => {
    const { repo, elias, four } = await mystery();
    const scaffold = (await repo.readProjectFile(four.filePath)) ?? "";
    await repo.writeProjectFile(four.filePath, `${scaffold}\nElias was a journalist, once.\n`);

    const staged = await stageRefactor(
      {
        kind: "change_character_attribute",
        characterId: elias.id as string,
        field: "role",
        newValue: "detective",
        oldTerms: ["journalist"],
        newTerm: "detective",
        instruction: "Make Elias a detective instead of a journalist.",
      },
      { repo, grant: GRANT, checkpoint: false },
    );
    await staged.commit();

    expect((await repo.getEntity<{ role: string }>(elias.id))?.role).toBe("detective");
    expect(await repo.readProjectFile(four.filePath)).toContain("Elias was a detective");
  });
});

describe("moving a scene", () => {
  it("re-chapters the scene and says what it will not fix", async () => {
    const { repo, vault, sixteen } = await mystery();

    const analysis = await analyseRefactor(repo, {
      kind: "move_story_event",
      sceneId: vault.id as string,
      toChapterId: sixteen.id as string,
    });
    // Moving a scene moves everything anchored to it — stated as a risk.
    expect(analysis.risks.some((r) => r.summary.includes("moves everything anchored"))).toBe(true);

    const staged = await stageRefactor(
      {
        kind: "move_story_event",
        sceneId: vault.id as string,
        toChapterId: sixteen.id as string,
        instruction: "Move the vault discovery from chapter 12 to chapter 16.",
      },
      { repo, grant: GRANT, checkpoint: false },
    );
    expect(staged.run.plan.steps.some((s) => s.kind === "manual")).toBe(true);
    await staged.commit();

    expect((await repo.getEntity<{ chapterId: string }>(vault.id))?.chapterId).toBe(sixteen.id);
  });
});

describe("validation", () => {
  /**
   * The refactor that breaks a story test the writer set. Nothing is committed
   * on the strength of a green build the writer never saw.
   */
  it("reports what the change would break, before anything moves", async () => {
    const { repo, relationship } = await mystery();

    const staged = await stageRefactor(
      {
        kind: "change_relationship",
        relationshipId: relationship.id as string,
        newType: "childhood friend",
        newStatus: "estranged",
        instruction: "Make them estranged childhood friends.",
      },
      { repo, grant: GRANT, checkpoint: false },
    );

    // The story test asserted "close" at the reckoning; it does not hold now.
    expect(staged.run.after?.failedTestIds.length).toBe(1);
    expect(failedValidation(staged.run)).toBe(true);
    expect(renderValidation(staged.run)).toContain("newly failing");

    // And it still has not touched the project.
    expect((await repo.getEntity<{ status: string }>(relationship.id))?.status).toBe("close");
    await staged.discard();
  });

  it("compares diagnostics by fingerprint, so a rewording is not a new problem", async () => {
    const { repo, marcus } = await mystery();
    const staged = await stageRefactor(
      { kind: "rename_entity", entityId: marcus.id as string, newName: "Marcus Kane" },
      { repo, grant: GRANT, checkpoint: false },
    );
    // A rename breaks nothing structural: no new diagnostics at all.
    expect(staged.run.introduced).toEqual([]);
    expect(failedValidation(staged.run)).toBe(false);
    await staged.discard();
  });
});

describe("permissions", () => {
  it("refuses to stage without permission to edit the manuscript", async () => {
    const { repo, relationship } = await mystery();
    await expect(
      stageRefactor(
        { ...BROTHERS, relationshipId: relationship.id as string },
        { repo, grant: READ_ONLY },
      ),
    ).rejects.toThrow(/permission/i);
  });

  /** Analysis is read-only, and safe to run on anything. */
  it("allows analysis and planning with no write permission at all", async () => {
    const { repo, relationship } = await mystery();
    const request = { ...BROTHERS, relationshipId: relationship.id as string };
    const analysis = await analyseRefactor(repo, request);
    const plan = await planRefactor(repo, request, analysis);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.modelId).toBeUndefined();
  });
});

/**
 * The model's part of a plan.
 *
 * It is never asked what is affected. It is asked what stops working, and for
 * sentence rewrites a word substitution would leave wrong — and it must quote
 * the sentence it wants to change, verbatim, or it does not get to change it.
 */
describe("model-assisted planning", () => {
  const planning = (structured: unknown) =>
    new MockLanguageModel({ structured: structured as Record<string, unknown> });

  async function planned(model: MockLanguageModel) {
    const { repo, relationship, four } = await mystery();
    const request = { ...BROTHERS, relationshipId: relationship.id as string };
    const analysis = await analyseRefactor(repo, request);
    const base = await planRefactor(repo, request, analysis);
    const planner = new RefactorPlanner({ repo, model });
    return { repo, four, analysis, enriched: await planner.enrich(analysis, base) };
  }

  it("adds labelled consequences and keeps the deterministic plan", async () => {
    const { enriched } = await planned(
      planning({
        consequences: ["The inheritance motive rests on them being brothers (THREAD_0001)."],
        manual: ["Decide how Marcus has access to the estate."],
        rewrites: [],
      }),
    );

    expect(enriched.modelId).toBe("mock:test");
    expect(enriched.modelNotes[0]).toContain("inheritance motive");
    expect(enriched.steps.some((s) => s.kind === "update_entity")).toBe(true);
    expect(
      enriched.steps.some((s) => s.kind === "manual" && s.description.includes("access")),
    ).toBe(true);
  });

  it("applies a rewrite it quoted exactly", async () => {
    const { repo, four, analysis, enriched } = await planned(
      planning({
        consequences: [],
        rewrites: [
          {
            path: "manuscript/CHAPTER_0001.md",
            original: "Marcus Vale had been his brother for thirty-one years",
            replacement: "Marcus Vale had been his closest friend for thirty-one years",
          },
        ],
      }),
    );
    expect(enriched.rejectedRewrites).toEqual([]);

    const staged = await stageRefactor(
      { ...BROTHERS, relationshipId: "REL_0001" },
      { repo, grant: GRANT, checkpoint: false },
      enriched,
    );
    await staged.commit();

    expect(await repo.readProjectFile(four.filePath)).toContain("his closest friend");
    expect(analysis.targets).toContain("REL_0001");
  });

  /** The failure worth catching: a model changing prose it cannot quote. */
  it("refuses a rewrite whose original is not in the file, and says why", async () => {
    const { enriched } = await planned(
      planning({
        consequences: [],
        rewrites: [
          {
            path: "manuscript/CHAPTER_0001.md",
            original: "A sentence that was never written.",
            replacement: "Something else entirely.",
          },
          { path: "manuscript/CHAPTER_0099.md", original: "x", replacement: "y" },
          { path: "manuscript/CHAPTER_0001.md", original: "", replacement: "y" },
        ],
      }),
    );

    expect(enriched.steps.some((s) => s.kind === "rewrite_passage")).toBe(false);
    expect(enriched.rejectedRewrites).toHaveLength(3);
    expect(enriched.rejectedRewrites[0]?.problem).toContain("character for character");
    expect(enriched.rejectedRewrites[1]?.problem).toContain("not a file");
    expect(enriched.rejectedRewrites[2]?.problem).toContain("Incomplete");
  });

  it("refuses a rewrite whose sentence appears more than once", async () => {
    const { repo, relationship, four } = await mystery();
    const scaffold = (await repo.readProjectFile(four.filePath)) ?? "";
    await repo.writeProjectFile(four.filePath, `${scaffold}\nHis brother poured the tea.\n`);

    const request = { ...BROTHERS, relationshipId: relationship.id as string };
    const analysis = await analyseRefactor(repo, request);
    const base = await planRefactor(repo, request, analysis);
    const planner = new RefactorPlanner({
      repo,
      model: planning({
        rewrites: [
          {
            path: four.filePath,
            original: "His brother poured the tea.",
            replacement: "His oldest friend poured the tea.",
          },
        ],
      }),
    });

    const enriched = await planner.enrich(analysis, base);
    expect(enriched.rejectedRewrites[0]?.problem).toContain("ambiguous");
  });

  /** A provider outage must not make a refactor impossible. */
  it("survives the model failing, and says the plan is unchanged", async () => {
    const { enriched } = await planned(new MockLanguageModel({ failWith: "provider_error" }));

    expect(enriched.steps.some((s) => s.kind === "update_entity")).toBe(true);
    expect(enriched.modelNotes[0]).toContain("could not be reached");
    expect(enriched.rejectedRewrites).toEqual([]);
  });
});

/**
 * The agent surface.
 *
 * An agent may work out what a change would reach. It may not stage one and it
 * may not apply one: a refactor rewrites a novel's architecture across files
 * the writer is not looking at, and that decision is theirs.
 */
describe("the agent tool", () => {
  async function runtime() {
    const { repo, relationship } = await mystery();
    const access = refactorAccess(repo);
    const registry = new ToolRegistry().register(
      ...createProjectTools(access),
      ...createRefactorTools(access),
    );
    const executor = new ToolExecutor({ registry, grant: READ_ONLY_GRANT, store: repo.agents });
    return { repo, relationship, registry, executor };
  }

  it("analyses a change and returns what it reaches", async () => {
    const { relationship, executor } = await runtime();

    const outcome = await executor.execute("TASK_0001", "analyse_story_refactor", {
      kind: "change_relationship",
      relationshipId: relationship.id as string,
      newType: "childhood friend",
      oldTerms: "brother, sibling",
      instruction: "Make Marcus Elias's childhood friend instead.",
    });

    expect(outcome.ok).toBe(true);
    const output = outcome.output as {
      summary: string;
      affected: unknown[];
      risks: unknown[];
      highRisk: string[];
      manuscriptReferences: Array<{ term: string }>;
    };
    expect(output.affected.length).toBeGreaterThan(0);
    expect(output.highRisk.length).toBeGreaterThan(0);
    expect(output.manuscriptReferences.some((r) => r.term === "brother")).toBe(true);
  });

  it("reports an unknown target rather than guessing", async () => {
    const { executor } = await runtime();
    const outcome = await executor.execute("TASK_0001", "analyse_story_refactor", {
      kind: "change_relationship",
      relationshipId: "REL_9999",
      newType: "friend",
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("REL_9999");
  });

  /** The boundary that matters. */
  it("offers no tool that stages or applies a refactor", async () => {
    const { registry } = await runtime();
    const names = registry.list().map((tool) => tool.name);

    expect(names).toContain("analyse_story_refactor");
    expect(names.some((name) => /stage|apply|commit|execute_refactor/.test(name))).toBe(false);
    expect(
      registry
        .list()
        .every((tool) => tool.permission === "read_canon" || tool.permission === "read_manuscript"),
    ).toBe(true);
  });
});
