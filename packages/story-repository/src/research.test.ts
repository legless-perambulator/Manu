import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "./story-repository";
import { openBranch } from "./branches";

/**
 * The research layer (Phase 35): persistent, sourced, and structurally apart
 * from canon. These tests hold the §1 boundary — nothing in the library can
 * become story truth except the writer's explicit "Use in story".
 */

async function project() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Black Thorn" });
  const mara = await repo.addCharacter({ name: "Mara", role: "protagonist" });
  const chapter = await repo.addChapter({ title: "The Cellar" });
  const scene = await repo.addScene({
    title: "Evidence room",
    chapterId: chapter.id,
    characterIds: [mara.id],
    purpose: ["The evidence is logged"],
  });
  return { store, repo, mara, chapter, scene };
}

describe("research items are sourced, linked and persistent", () => {
  it("stores an item with provenance and finds it again after a real reopen", async () => {
    const { store, repo, mara, scene } = await project();
    const item = await repo.addResearchItem({
      title: "UK evidence bag sealing",
      type: "web",
      status: "unreviewed",
      summary: "Tamper-evident bags, signed continuity labels.",
      content: "Each bag carries a unique seal number recorded in the exhibit log…",
      sourceUrl: "https://example.org/evidence-handling",
      sourceTitle: "Evidence handling guidance",
      accessedAt: "2026-08-14T10:00:00Z",
      tags: ["police", "procedure"],
      linkedEntityIds: [mara.id as string],
      linkedSceneIds: [scene.id as string],
      facts: [{ statement: "Evidence bags use numbered tamper seals.", proposedBy: "author" }],
      provenance: { origin: "manual", retrievalMethod: "pasted" },
    });
    expect(item.id).toMatch(/^RES_/);

    // §28.9: provenance survives restart — it is simply part of the record.
    const reopened = await openBranch(store);
    const held = await reopened.getResearchItem(item.id);
    expect(held?.provenance).toEqual({ origin: "manual", retrievalMethod: "pasted" });
    expect(held?.sourceUrl).toBe("https://example.org/evidence-handling");
    expect(held?.content).toContain("unique seal number");
    expect(held?.summary).toContain("Tamper-evident");
  });

  it("refuses links to things the project does not contain", async () => {
    const { repo } = await project();
    await expect(
      repo.addResearchItem({
        title: "Bad link",
        type: "manual_note",
        status: "unreviewed",
        tags: [],
        linkedEntityIds: ["CHAR_9999"],
        linkedSceneIds: [],
        facts: [],
        provenance: { origin: "manual" },
      }),
    ).rejects.toMatchObject({ code: "entity_not_found" });
  });

  it("keeps provenance immutable and agent items unreviewed, whatever they claim", async () => {
    const { repo } = await project();
    const item = await repo.addResearchItem(
      {
        title: "From the agent",
        type: "web",
        status: "trusted", // an agent cannot pre-trust its own output (§4)
        tags: [],
        linkedEntityIds: [],
        linkedSceneIds: [],
        facts: [],
        provenance: { origin: "agent", retrievalMethod: "model_knowledge", modelId: "mock:m" },
      },
      { actor: "agent" },
    );
    expect(item.status).toBe("unreviewed");

    const updated = await repo.updateResearchItem(item.id, {
      summary: "edited",
      // provenance is not part of the patch type; verify it cannot drift
    });
    expect(updated.provenance.retrievalMethod).toBe("model_knowledge");
    expect(updated.summary).toBe("edited");
  });

  it("searches by text, tag, link and source — apart from manuscript search", async () => {
    const { repo, scene } = await project();
    await repo.addResearchItem({
      title: "Victorian railway times",
      type: "book",
      status: "reviewed",
      summary: "London to York was roughly five hours by 1890.",
      sourceTitle: "Bradshaw's Guide",
      tags: ["travel", "victorian"],
      linkedEntityIds: [],
      linkedSceneIds: [scene.id as string],
      facts: [],
      provenance: { origin: "manual" },
    });
    await repo.addResearchItem({
      title: "Luminol basics",
      type: "article",
      status: "unreviewed",
      tags: ["forensics"],
      linkedEntityIds: [],
      linkedSceneIds: [],
      facts: [],
      provenance: { origin: "manual" },
    });

    expect(await repo.searchResearch({ text: "york" })).toHaveLength(1);
    expect(await repo.searchResearch({ tag: "forensics" })).toHaveLength(1);
    expect(await repo.searchResearch({ linkedId: scene.id as string })).toHaveLength(1);
    expect(await repo.searchResearch({ source: "bradshaw" })).toHaveLength(1);
    expect(await repo.searchResearch({ status: "reviewed" })).toHaveLength(1);
  });
});

describe("research is not canon (§1)", () => {
  it("a research fact changes nothing in the story until the writer promotes it", async () => {
    const { repo } = await project();
    const before = await repo.listFacts();
    await repo.addResearchItem({
      title: "Carbon monoxide symptoms",
      type: "paper",
      status: "reviewed",
      tags: [],
      linkedEntityIds: [],
      linkedSceneIds: [],
      facts: [
        {
          statement: "Early CO poisoning presents as headache and confusion.",
          proposedBy: "model",
        },
      ],
      provenance: { origin: "agent", retrievalMethod: "model_knowledge" },
    });
    // No Fact, no World Rule, no state — the library holds it, canon ignores it.
    expect(await repo.listFacts()).toHaveLength(before.length);
    expect(await repo.listWorldRules()).toHaveLength(0);
  });

  it("Use in story promotes one fact explicitly, carrying its source (§15, §28.8)", async () => {
    const { repo } = await project();
    const item = await repo.addResearchItem({
      title: "Evidence bags",
      type: "web",
      status: "trusted",
      sourceTitle: "Evidence handling guidance",
      sourceUrl: "https://example.org/evidence",
      tags: [],
      linkedEntityIds: [],
      linkedSceneIds: [],
      facts: [{ statement: "Evidence bags use numbered tamper seals.", proposedBy: "model" }],
      provenance: { origin: "agent", retrievalMethod: "web_search (mock)" },
    });

    const { item: updated, entityId } = await repo.canoniseResearchFact(item.id, 0, {
      kind: "fact",
    });
    const fact = (await repo.listFacts()).find((f) => (f.id as string) === entityId);
    expect(fact?.statement).toBe("Evidence bags use numbered tamper seals.");
    // The canonical fact names where it came from — the bridge is visible.
    expect(fact?.source).toContain("Evidence handling guidance");
    expect(fact?.source).toContain(item.id);
    // …and the research fact records what it became.
    expect(updated.facts[0]?.canonisedAs).toBe(entityId);
    expect(updated.linkedEntityIds).toContain(entityId);
  });

  it("can promote into a world rule, or into an entity's notes", async () => {
    const { repo, mara } = await project();
    const item = await repo.addResearchItem({
      title: "Luminol",
      type: "article",
      status: "reviewed",
      tags: [],
      linkedEntityIds: [],
      linkedSceneIds: [],
      facts: [
        { statement: "Luminol reveals trace blood under UV.", proposedBy: "model" },
        { statement: "Mara trained in forensics at Hendon.", proposedBy: "author" },
      ],
      provenance: { origin: "manual" },
    });
    const rule = await repo.canoniseResearchFact(item.id, 0, {
      kind: "world_rule",
      name: "Forensics work like the real world",
    });
    expect((await repo.listWorldRules()).some((r) => (r.id as string) === rule.entityId)).toBe(
      true,
    );

    await repo.canoniseResearchFact(item.id, 1, {
      kind: "entity_note",
      entityId: mara.id as string,
    });
    const character = await repo.getEntity(mara.id as string);
    expect((character as { notes: string }).notes).toContain("Hendon");
  });

  it("keeps conflicting sources side by side, never merged (§16)", async () => {
    const { repo } = await project();
    const a = await repo.addResearchItem({
      title: "Source A on landline traces",
      type: "web",
      status: "unreviewed",
      tags: [],
      linkedEntityIds: [],
      linkedSceneIds: [],
      facts: [{ statement: "A 1990s trace took under a minute.", proposedBy: "model" }],
      provenance: { origin: "agent" },
    });
    const b = await repo.addResearchItem({
      title: "Source B on landline traces",
      type: "web",
      status: "unreviewed",
      tags: [],
      linkedEntityIds: [],
      linkedSceneIds: [],
      facts: [
        {
          statement: "A trace required minutes of continuous connection.",
          proposedBy: "model",
          conflictsWithItemId: a.id,
        },
      ],
      provenance: { origin: "agent" },
    });
    const held = await repo.getResearchItem(b.id);
    expect(held?.facts[0]?.conflictsWithItemId).toBe(a.id);
    // Both accounts survive; deciding between them is authorship.
    expect(await repo.getResearchItem(a.id)).not.toBeNull();
  });
});

describe("research tasks and placeholders (§17, §19, §21)", () => {
  it("tracks a task through its life, scoped to real story elements", async () => {
    const { repo, scene } = await project();
    const task = await repo.addResearchTask({
      question: "How are UK evidence bags sealed and logged?",
      scope: { sceneId: scene.id as string },
    });
    expect(task.id).toMatch(/^RTASK_/);
    expect(task.status).toBe("pending");

    const updated = await repo.updateResearchTask(task.id, { status: "researching" });
    expect(updated.status).toBe("researching");

    await expect(
      repo.addResearchTask({ question: "?", scope: { sceneId: "SCENE_9999" } }),
    ).rejects.toMatchObject({ code: "entity_not_found" });
  });

  it("finds [RESEARCH: …] placeholders in the manuscript, attributed to scenes", async () => {
    const { repo, chapter, scene } = await project();
    const file = (await repo.readProjectFile(chapter.filePath)) ?? "";
    await repo.writeProjectFile(
      chapter.filePath,
      `${file}\n<!-- scene: ${scene.id as string} -->\n\nShe bagged the knife. [RESEARCH: how UK evidence bags are sealed and logged]\n`,
    );
    const gaps = await repo.findResearchGaps();
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.question).toBe("how UK evidence bags are sealed and logged");
    expect(gaps[0]?.sceneId).toBe(scene.id as string);
    expect(gaps[0]?.chapterId).toBe(chapter.id as string);
  });
});
