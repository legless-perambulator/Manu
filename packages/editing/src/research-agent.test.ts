import { describe, expect, it } from "vitest";
import type { PermissionGrant } from "@jellytind/agent-runtime";
import { ContextCompiler } from "@jellytind/context-compiler";
import { InMemoryProjectStore } from "@jellytind/persistence";
import {
  MockLanguageModel,
  type GenerateRequest,
  type LanguageModel,
  type RequestOptions,
  type StructuredRequest,
} from "@jellytind/model-router";
import { StoryRepository, openBranch } from "@jellytind/story-repository";
import { ChapterBuilder } from "./chapter-builder";
import { ResearchAgent, type ResearchSource } from "./research-agent";

const GRANT: PermissionGrant = { permissions: ["read_manuscript", "read_canon", "run_research"] };

class ScriptedModel implements LanguageModel {
  readonly capabilities = { streaming: true, structuredOutput: true, tools: true };
  readonly requests: string[] = [];
  private readonly fallback = new MockLanguageModel({ structured: {} });

  constructor(
    private readonly respond: (prompt: string) => unknown,
    readonly id: string = "mock:researcher",
  ) {}

  generateText(request: GenerateRequest, options?: RequestOptions) {
    return this.fallback.generateText(request, options);
  }
  streamText(request: GenerateRequest, options?: RequestOptions) {
    return this.fallback.streamText(request, options);
  }
  runWithTools(request: never, options?: RequestOptions) {
    return this.fallback.runWithTools(request, options);
  }
  generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    const prompt = request.messages.map((m) => String(m.content)).join("\n");
    this.requests.push(prompt);
    return Promise.resolve(request.schema.parse(this.respond(prompt)));
  }
}

async function crimeScene() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Black Thorn" });
  const mara = await repo.addCharacter({ name: "Mara", role: "detective" });
  const chapter = await repo.addChapter({ title: "The Cellar" });
  const scene = await repo.addScene({
    title: "The crime scene",
    chapterId: chapter.id,
    pov: mara.id,
    characterIds: [mara.id],
    purpose: ["The evidence is bagged and logged"],
  });
  // §28's fixture: the placeholder in the prose.
  const file = (await repo.readProjectFile(chapter.filePath)) ?? "";
  await repo.writeProjectFile(
    chapter.filePath,
    `${file}\n<!-- scene: ${scene.id as string} -->\n\nShe knelt by the knife. [RESEARCH: how UK evidence bags are sealed and logged]\n`,
  );
  return { store, repo, mara, chapter, scene };
}

const PROVIDER_SOURCES: ResearchSource[] = [
  {
    title: "Evidence handling guidance",
    url: "https://example.org/evidence",
    snippet: "Tamper-evident bags carry unique seal numbers recorded in the exhibit log.",
  },
  {
    title: "Forensic procedure review",
    url: "https://example.org/review",
    snippet: "Continuity labels are countersigned at every transfer.",
  },
];

function providerFindings(): unknown {
  return {
    findings: [
      {
        title: "Evidence bag sealing",
        summary: "Bags are tamper-evident with unique seal numbers.",
        content: "Tamper-evident bags carry unique seal numbers recorded in the exhibit log.",
        sourceUrl: "https://example.org/evidence",
        facts: [
          { statement: "Evidence bags carry unique numbered seals.", confidence: 0.9 },
          { statement: "Seal numbers are recorded in an exhibit log.", confidence: 0.85 },
        ],
        tags: ["police", "procedure"],
      },
      {
        title: "An invented citation",
        summary: "This one cites a URL the provider never returned.",
        sourceUrl: "https://invented.example.com/nope",
        facts: [{ statement: "Should survive without its fake source.", confidence: 0.4 }],
        tags: [],
      },
    ],
  };
}

describe("the research agent (§6–8, §24–25)", () => {
  it("turns a task into sourced library items — never chat output", async () => {
    const { repo, scene } = await crimeScene();
    const model = new ScriptedModel(() => providerFindings());
    const agent = new ResearchAgent({
      repo,
      model,
      grant: GRANT,
      searchProvider: { name: "mock", search: () => Promise.resolve(PROVIDER_SOURCES) },
    });
    const task = await repo.addResearchTask({
      question: "How are UK evidence bags sealed and logged?",
      scope: { sceneId: scene.id as string },
    });
    const { task: done, items } = await agent.run(task.id);

    expect(done.status).toBe("awaiting_review");
    expect(done.findingItemIds).toHaveLength(2);
    expect(items[0]?.sourceUrl).toBe("https://example.org/evidence");
    expect(items[0]?.sourceTitle).toBe("Evidence handling guidance");
    expect(items[0]?.provenance.origin).toBe("agent");
    expect(items[0]?.provenance.retrievalMethod).toContain("web_search");
    expect(items[0]?.provenance.taskId).toBe(task.id);
    // Linked to the scene the task was about (§11, §28.5).
    expect(items[0]?.linkedSceneIds).toContain(scene.id as string);
    // Model claims stay labelled as the model's (§1).
    expect(items[0]?.facts.every((fact) => fact.proposedBy === "model")).toBe(true);
    // Trust is never automatic (§4).
    expect(items.every((item) => item.status === "unreviewed")).toBe(true);
  });

  it("refuses invented citations: a URL the provider never returned is dropped (§8)", async () => {
    const { repo, scene } = await crimeScene();
    const agent = new ResearchAgent({
      repo,
      model: new ScriptedModel(() => providerFindings()),
      grant: GRANT,
      searchProvider: { name: "mock", search: () => Promise.resolve(PROVIDER_SOURCES) },
    });
    const task = await repo.addResearchTask({
      question: "Evidence bags?",
      scope: { sceneId: scene.id as string },
    });
    const { items } = await agent.run(task.id);
    const invented = items.find((item) => item.title === "An invented citation");
    expect(invented).toBeDefined();
    expect(invented?.sourceUrl).toBeUndefined();
    expect(invented?.sourceTitle).toBeUndefined();
  });

  it("with no provider, uses model knowledge honestly: no URL survives at all", async () => {
    const { repo, scene } = await crimeScene();
    const agent = new ResearchAgent({
      repo,
      model: new ScriptedModel(() => providerFindings()),
      grant: GRANT,
    });
    const task = await repo.addResearchTask({
      question: "Evidence bags?",
      scope: { sceneId: scene.id as string },
    });
    const { items } = await agent.run(task.id);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.sourceUrl === undefined)).toBe(true);
    expect(items.every((item) => item.provenance.retrievalMethod === "model_knowledge")).toBe(true);
  });

  it("sends only the minimal scope, never the manuscript (§24)", async () => {
    const { repo, scene } = await crimeScene();
    // A second chapter of sensitive prose that must never leave the project.
    const secret = await repo.addChapter({ title: "The Reveal" });
    const secretFile = (await repo.readProjectFile(secret.filePath)) ?? "";
    await repo.writeProjectFile(
      secretFile === "" ? secret.filePath : secret.filePath,
      `${secretFile}\nThe killer is Marcus and always was.\n`,
    );

    const model = new ScriptedModel(() => providerFindings());
    const agent = new ResearchAgent({
      repo,
      model,
      grant: GRANT,
      searchProvider: { name: "mock", search: () => Promise.resolve(PROVIDER_SOURCES) },
    });
    const task = await repo.addResearchTask({
      question: "How are UK evidence bags sealed?",
      scope: { sceneId: scene.id as string },
    });
    await agent.run(task.id);

    const prompt = model.requests.join("\n");
    // The scope's own material travels…
    expect(prompt).toContain("The crime scene");
    // …and nothing else does: no other chapter's prose, no manuscript text.
    expect(prompt).not.toContain("The killer is Marcus");
    expect(prompt).not.toContain("She knelt by the knife");
  });

  it("refuses to run without the run_research permission (§25)", async () => {
    const { repo, scene } = await crimeScene();
    const agent = new ResearchAgent({
      repo,
      model: new ScriptedModel(() => providerFindings()),
      grant: { permissions: ["read_manuscript", "read_canon"] },
    });
    const task = await repo.addResearchTask({
      question: "?",
      scope: { sceneId: scene.id as string },
    });
    await expect(agent.run(task.id)).rejects.toMatchObject({ editCode: "permission_denied" });
  });

  it("cross-references conflicting findings instead of merging them (§16)", async () => {
    const { repo, scene } = await crimeScene();
    const agent = new ResearchAgent({
      repo,
      model: new ScriptedModel(() => ({
        findings: [
          {
            title: "Account A",
            summary: "A trace took under a minute.",
            sourceUrl: "https://example.org/evidence",
            facts: [{ statement: "Traces were near-instant.", confidence: 0.5 }],
            tags: [],
          },
          {
            title: "Account B",
            summary: "A trace took several minutes of open line.",
            sourceUrl: "https://example.org/review",
            facts: [{ statement: "Traces took minutes.", confidence: 0.5 }],
            tags: [],
            conflictsWithFinding: 0,
          },
        ],
      })),
      grant: GRANT,
      searchProvider: { name: "mock", search: () => Promise.resolve(PROVIDER_SOURCES) },
    });
    const task = await repo.addResearchTask({
      question: "1990s landline traces?",
      scope: { sceneId: scene.id as string },
    });
    const { items } = await agent.run(task.id);
    expect(items).toHaveLength(2);
    const b = await repo.getResearchItem(items[1]?.id as string);
    expect(b?.facts[0]?.conflictsWithItemId).toBe(items[0]?.id);
  });
});

describe("the acceptance scenario (§28)", () => {
  it("placeholder → task → sourced findings → context → explicit canonisation → restart", async () => {
    const { store, repo, scene, chapter } = await crimeScene();

    // §28.1: the placeholder becomes a research task (via the research pass).
    const model = new ScriptedModel(() => providerFindings());
    const agent = new ResearchAgent({
      repo,
      model,
      grant: GRANT,
      searchProvider: { name: "mock", search: () => Promise.resolve(PROVIDER_SOURCES) },
    });
    const pass = await agent.researchPass();
    expect(pass.created).toHaveLength(1);
    expect(pass.created[0]?.question).toBe("how UK evidence bags are sealed and logged");
    expect(pass.created[0]?.scope?.sceneId).toBe(scene.id as string);

    // §28.2–4: the agent investigated; sources preserved; library holds it.
    const result = pass.results[0];
    expect(result?.task.status).toBe("awaiting_review");
    const library = await repo.listResearchItems();
    expect(library.length).toBeGreaterThan(0);
    expect(library[0]?.sourceUrl).toBe("https://example.org/evidence");

    // §28.5: linked to the scene.
    expect(library[0]?.linkedSceneIds).toContain(scene.id as string);

    // §28.6: the Context Compiler includes the findings for that scene, with
    // the reason on the item — and its rendering says what research is.
    const compiler = new ContextCompiler(repo);
    const pkg = await compiler.compile({
      recipe: "scene_rewrite",
      targetId: scene.id as string,
      instruction: "Draft the scene.",
    });
    const research = pkg.sections.find((section) => section.name === "research");
    expect(research?.items.length).toBeGreaterThan(0);
    expect(research?.items[0]?.provenance.reason).toContain(scene.id as string);
    expect(research?.items[0]?.text).toContain("not story canon");
    expect(research?.items[0]?.text).toContain("Source:");

    // §28.7: research stayed research — canon is untouched.
    expect(await repo.listFacts()).toHaveLength(0);

    // §28.8: the writer promotes exactly one fact.
    const item = library[0];
    const { entityId } = await repo.canoniseResearchFact(item?.id as string, 0, { kind: "fact" });
    expect((await repo.listFacts()).map((f) => f.id as string)).toContain(entityId);

    // §28.9: provenance and the promotion survive a real restart.
    const reopened = await openBranch(store);
    const held = await reopened.getResearchItem(item?.id as string);
    expect(held?.provenance.retrievalMethod).toContain("web_search");
    expect(held?.facts[0]?.canonisedAs).toBe(entityId);
    expect(held?.sourceUrl).toBe("https://example.org/evidence");

    // §20–21: a build over the chapter sees the remaining placeholder and,
    // under the pause policy, waits for the research instead of drafting.
    const drafting = new ScriptedModel(() => ({ text: "Prose.", rationale: "", warnings: [] }));
    const builder = new ChapterBuilder({
      repo: reopened,
      models: { drafting },
      grant: {
        permissions: ["read_manuscript", "read_canon", "edit_manuscript", "edit_story_state"],
      },
    });
    const paused = await builder.start({
      chapterId: chapter.id as string,
      researchGapPolicy: "pause",
    });
    expect(paused.status).toBe("paused");
    expect(
      paused.diagnostics.some((d) => d.message.includes("research question(s) unresolved")),
    ).toBe(true);
    expect(drafting.requests).toHaveLength(0);
  });
});
