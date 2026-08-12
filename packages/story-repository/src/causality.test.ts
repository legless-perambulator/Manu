import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { describePath } from "@jellytind/story-causality";
import { StoryRepository } from "./story-repository";

/**
 * The causality graph through the whole path: registered as canon, validated
 * against real entities, traversed, and protecting the entities it names.
 *
 * The chain is the one from the spec, with the decisions written down as
 * decisions rather than smuggled into scene titles:
 *
 * ```
 * Elias discovers letter → enables → Elias confronts father
 *   → causes → Father lies → motivates → Elias contacts Mara
 * ```
 */
async function novel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "Blackthorn" });

  const elias = await repo.addCharacter({ name: "Elias" });
  const father = await repo.addCharacter({ name: "Thomas Vance" });
  const mara = await repo.addCharacter({ name: "Mara" });
  const thread = await repo.addPlotThread({ name: "The inheritance" });
  const truth = await repo.addFact({ statement: "The will was altered." });
  const chapter = await repo.addChapter({ title: "The Letter" });

  const discovers = await repo.addScene({
    title: "Elias discovers the letter",
    chapterId: chapter.id,
    characterIds: [elias.id],
  });
  const confronts = await repo.addScene({
    title: "Elias confronts his father",
    chapterId: chapter.id,
    characterIds: [elias.id, father.id],
  });
  const lies = await repo.addScene({
    title: "The father lies",
    chapterId: chapter.id,
    characterIds: [father.id],
  });
  const contacts = await repo.addScene({
    title: "Elias contacts Mara",
    chapterId: chapter.id,
    characterIds: [elias.id, mara.id],
  });

  const decision = await repo.addDecision({
    description: "Elias decides to go to Mara rather than the police",
    characterId: elias.id,
    sceneId: contacts.id,
    reason: "He no longer believes his father.",
  });

  return {
    store,
    repo,
    elias,
    father,
    mara,
    thread,
    truth,
    chapter,
    discovers,
    confronts,
    lies,
    contacts,
    decision,
  };
}

/** The spec's chain, registered. */
async function chained() {
  const fixture = await novel();
  const { repo, discovers, confronts, lies, contacts } = fixture;
  await repo.addDependencies([
    { kind: "enables", fromId: discovers.id, toId: confronts.id },
    { kind: "causes", fromId: confronts.id, toId: lies.id },
    { kind: "motivates", fromId: lies.id, toId: contacts.id },
  ]);
  return fixture;
}

describe("registering a dependency", () => {
  it("stores the writer's sentence and reads it back", async () => {
    const { repo, discovers, confronts } = await novel();

    const [dependency] = await repo.addDependencies([
      {
        kind: "enables",
        fromId: discovers.id,
        toId: confronts.id,
        description: "He would have no reason to confront him otherwise.",
      },
    ]);

    expect(dependency?.id).toBe("DEP_0001");
    expect(dependency?.status).toBe("confirmed");
    expect(dependency?.source).toBe("human");
    expect(await repo.listDependencies()).toHaveLength(1);
  });

  it("refuses an endpoint that does not exist", async () => {
    const { repo, discovers } = await novel();
    await expect(
      repo.addDependencies([{ kind: "causes", fromId: discovers.id, toId: "SCENE_9999" }]),
    ).rejects.toThrow(/SCENE_9999 does not exist/);
  });

  /** A place does not cause anything, and letting it in would fill the graph. */
  it("refuses an entity kind that cannot take part", async () => {
    const { repo, discovers } = await novel();
    const manor = await repo.addLocation({ name: "Blackthorn Manor" });
    await expect(
      repo.addDependencies([{ kind: "causes", fromId: discovers.id, toId: manor.id }]),
    ).rejects.toThrow(/cannot take part/);
  });

  it("refuses a link from something to itself", async () => {
    const { repo, discovers } = await novel();
    await expect(
      repo.addDependencies([{ kind: "causes", fromId: discovers.id, toId: discovers.id }]),
    ).rejects.toThrow(/to itself/);
  });

  /** A model's guess waits for a human. */
  it("keeps an agent's proposals out of the graph until accepted", async () => {
    const { repo, discovers, confronts } = await novel();
    const [proposal] = await repo.addDependencies(
      [{ kind: "causes", fromId: discovers.id, toId: confronts.id, evidence: "He reads it." }],
      { source: "agent", modelId: "mock:test" },
    );

    expect(proposal?.status).toBe("proposed");
    expect(await repo.getTransitiveDependents(discovers.id)).toEqual([]);

    await repo.updateDependency(proposal?.id as string, { status: "confirmed" });
    expect(await repo.getTransitiveDependents(discovers.id)).toEqual([confronts.id]);
  });

  it("survives a reopen", async () => {
    const { store } = await chained();
    const reopened = await StoryRepository.openProject({ store });
    expect(await reopened.listDependencies()).toHaveLength(3);
  });
});

describe("queries", () => {
  it("separates what rests on a scene from what it rests on", async () => {
    const { repo, discovers, confronts, lies } = await chained();

    expect((await repo.getDependentsOf(confronts.id)).map((s) => s.effectId)).toEqual([lies.id]);
    expect((await repo.getDependenciesOf(confronts.id)).map((s) => s.causeId)).toEqual([
      discovers.id,
    ]);
  });

  it("walks the whole chain", async () => {
    const { repo, discovers, confronts, lies, contacts } = await chained();
    expect(await repo.getTransitiveDependents(discovers.id)).toEqual([
      confronts.id,
      lies.id,
      contacts.id,
    ]);
  });

  it("explains how one scene leads to another", async () => {
    const { repo, discovers, contacts } = await chained();
    const path = await repo.getDependencyPath(discovers.id, contacts.id);

    expect(path?.steps).toHaveLength(3);
    expect(describePath(path as never)).toBe(
      `${discovers.id} → enables → ${"SCENE_0002"} → causes → ${"SCENE_0003"} → motivates → ${contacts.id}`,
    );
  });

  /** The acceptance question of the whole subsystem. */
  it("answers what depends on a scene, and why", async () => {
    const { repo, discovers, contacts, thread, truth, decision } = await chained();
    await repo.addDependencies([
      { kind: "reveals", fromId: contacts.id, toId: truth.id },
      { kind: "resolves", fromId: contacts.id, toId: thread.id },
      { kind: "requires", fromId: decision.id, toId: contacts.id },
    ]);

    const radius = await repo.calculateBlastRadius(discovers.id);

    expect(radius.total).toBe(6);
    expect(radius.affected.map((a) => a.id)).toContain(truth.id);
    expect(radius.affected.map((a) => a.id)).toContain(thread.id);
    expect(radius.affected.map((a) => a.id)).toContain(decision.id);

    const far = radius.affected.find((a) => a.id === thread.id);
    expect(far?.direct).toBe(false);
    expect(describePath(far?.paths[0] as never)).toContain("resolves");
  });
});

describe("dependencies and the entities they name", () => {
  it("refuses to delete a scene the graph depends on, and says how much", async () => {
    const { repo, discovers } = await chained();

    await expect(repo.deleteEntity(discovers.id)).rejects.toThrow(
      /3 story element\(s\) depend on it/,
    );
  });

  it("removes the dependencies along with the entity when the writer unlinks", async () => {
    const { repo, confronts } = await chained();

    await repo.deleteEntity(confronts.id, { mode: "unlink" });
    const left = await repo.listDependencies();

    expect(left).toHaveLength(1);
    expect(left[0]?.fromId).not.toBe(confronts.id);
    expect(left[0]?.toId).not.toBe(confronts.id);
  });

  /** A registered link is authored content, so losing one is undoable. */
  it("journals registering and deleting a dependency", async () => {
    const { repo, discovers, confronts } = await novel();
    const [dependency] = await repo.addDependencies([
      { kind: "enables", fromId: discovers.id, toId: confronts.id },
    ]);

    const added = (await repo.listChangeSets()).find((c) => c.operation === "add_dependencies");
    expect(added).toBeDefined();

    await repo.deleteDependency(dependency?.id as string);
    expect(await repo.listDependencies()).toEqual([]);

    const removal = (await repo.listChangeSets()).find((c) => c.operation === "delete_dependency");
    await repo.revertChangeSet((removal as { id: string }).id);
    expect(await repo.listDependencies()).toHaveLength(1);
  });

  it("says plainly when a dependency does not exist", async () => {
    const { repo } = await novel();
    await expect(repo.deleteDependency("DEP_9999")).rejects.toThrow(/DEP_9999/);
    await expect(repo.updateDependency("DEP_9999", { status: "rejected" })).rejects.toThrow(
      /DEP_9999/,
    );
  });
});

describe("checking the graph in a build", () => {
  it("reports an endpoint that was deleted from outside the graph", async () => {
    const { repo, discovers, confronts } = await chained();
    // Unlinking removes the dependencies too, so the only way to strand one is
    // to delete an entity a dependency names *without* going through deletion —
    // which is what an external edit or a bad merge does.
    await repo.deleteDependency("DEP_0001");
    await repo.addDependencies([{ kind: "enables", fromId: discovers.id, toId: confronts.id }]);
    await breakScene(repo, confronts.id as string);

    const findings = await repo.checkDependencyGraph();
    const dangling = findings.find((f) => f.kind === "dangling_endpoint");
    expect(dangling?.severity).toBe("error");

    const build = await repo.buildStory();
    const diagnostic = build.diagnostics.find((d) => d.ruleId === "dependency_integrity");
    expect(diagnostic?.severity).toBe("error");
    expect(build.status).toBe("failed");
  });

  it("reports a loop as a warning and keeps building", async () => {
    const { repo, discovers, contacts } = await chained();
    await repo.addDependencies([{ kind: "causes", fromId: contacts.id, toId: discovers.id }]);

    const build = await repo.buildStory();
    const diagnostic = build.diagnostics.find((d) => d.ruleId === "dependency_integrity");

    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.message).toContain("→");
    expect(build.rules.find((r) => r.ruleId === "dependency_integrity")?.status).not.toBe(
      "skipped",
    );
  });

  it("reports an effect that comes before its cause", async () => {
    const { repo, discovers, contacts } = await novel();
    await repo.addDependencies([{ kind: "causes", fromId: contacts.id, toId: discovers.id }]);

    const build = await repo.buildStory();
    const diagnostic = build.diagnostics.find((d) => d.ruleId === "dependency_integrity");

    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.suggestedAction).toContain("flashback");
  });

  it("passes a project whose graph is sound", async () => {
    const { repo } = await chained();
    const build = await repo.buildStory();
    expect(build.diagnostics.filter((d) => d.ruleId === "dependency_integrity")).toEqual([]);
  });
});

/** Corrupt the scenes file the way an external edit would. */
async function breakScene(repo: StoryRepository, sceneId: string): Promise<void> {
  const raw = await repo.readProjectFile("scenes/scenes.json");
  const parsed = JSON.parse(raw ?? "{}") as { items: Array<{ id: string }> };
  await repo.writeProjectFile(
    "scenes/scenes.json",
    JSON.stringify({ items: parsed.items.filter((s) => s.id !== sceneId) }, null, 2),
  );
}
