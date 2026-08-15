import { describe, expect, it } from "vitest";
import type { StoryRepository } from "@jellytind/story-repository";
import { buildCommandSet, paletteEntries, type CommandEnvironment } from "./commands";

/**
 * Phase 39 §17 — the acceptance scenario.
 *
 * Each command must launch its *real* corresponding workflow: the entity is
 * resolved to its stable ID, the owning panel opens, and the workflow's own
 * input is seeded. The terminal itself never applies anything.
 */

const ENTITIES = [
  { id: "CHAR_0019", kind: "character", name: "Mara" },
  { id: "CHAR_0002", kind: "character", name: "Marcus Webb" },
  { id: "THREAD_0004", kind: "plot_thread", name: "Missing Photograph" },
  { id: "FACT_0007", kind: "fact", name: "vault_exists" },
  { id: "SCENE_0003", kind: "scene", name: "The Vault Opens" },
];

const CHAPTERS = [
  { id: "CHAPTER_0001", title: "The Fire", order: 0, filePath: "manuscript/CHAPTER_0001.md" },
  { id: "CHAPTER_0017", title: "The Vault", order: 16, filePath: "manuscript/CHAPTER_0017.md" },
];

function fakeRepo(): StoryRepository {
  const repo = {
    listEntitySummaries: () => Promise.resolve(ENTITIES),
    listChapters: () => Promise.resolve(CHAPTERS),
    listProjectFiles: () => Promise.resolve([]),
    readProjectFile: (path: string) =>
      Promise.resolve(path === "manuscript/CHAPTER_0001.md" ? "One two three four five" : "Six"),
    addScene: (input: { title: string }) =>
      Promise.resolve({ id: "SCENE_0099", title: input.title }),
  };
  return repo as unknown as StoryRepository;
}

interface Effects {
  panels: string[];
  files: string[];
  scenes: string[];
  selected: string[];
  debug: string[];
  refactor: string[];
  search: string[];
  version: string[];
  chapterBuild: string[];
  skill: string[];
  map: unknown[];
  focusToggles: number;
}

function environment(overrides: Partial<CommandEnvironment> = {}): {
  env: CommandEnvironment;
  effects: Effects;
} {
  const effects: Effects = {
    panels: [],
    files: [],
    scenes: [],
    selected: [],
    debug: [],
    refactor: [],
    search: [],
    version: [],
    chapterBuild: [],
    skill: [],
    map: [],
    focusToggles: 0,
  };
  const env: CommandEnvironment = {
    repo: fakeRepo(),
    enabledModules: [],
    openPath: null,
    showPanel: (id) => effects.panels.push(id),
    openFile: (path) => effects.files.push(path),
    selectEntity: (id) => effects.selected.push(id),
    openScene: (id) => effects.scenes.push(id),
    seedDebug: (line) => effects.debug.push(line),
    seedRefactor: (instruction) => effects.refactor.push(instruction),
    seedSearch: (query) => effects.search.push(query),
    seedVersionName: (name) => effects.version.push(name),
    seedChapterBuild: (id) => effects.chapterBuild.push(id),
    seedSkill: (line) => effects.skill.push(line),
    focusMap: (focus) => effects.map.push(focus),
    toggleFocusMode: () => {
      effects.focusToggles += 1;
    },
    ...overrides,
  };
  return { env, effects };
}

describe("the §17 acceptance scenario", () => {
  it("/inspect Mara resolves the name and opens her record", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const { env, effects } = environment();
    const [step] = await commands.execute("/inspect Mara", env);
    expect(step?.outcome).toMatchObject({ kind: "opened", panel: "characters" });
    expect(effects.selected).toEqual(["CHAR_0019"]);
  });

  it("/trace thread missing_photograph selects the real thread", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const { env, effects } = environment();
    const [step] = await commands.execute("/trace thread missing_photograph", env);
    expect(step?.outcome).toMatchObject({ kind: "opened", panel: "threads" });
    expect(effects.selected).toEqual(["THREAD_0004"]);
  });

  it("/debug betrayal Marcus hands the debugger its own fast path", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const { env, effects } = environment();
    const [step] = await commands.execute("/debug betrayal Marcus", env);
    expect(step?.outcome).toMatchObject({ kind: "opened", panel: "debug" });
    expect(effects.debug).toEqual(["/debug betrayal Marcus"]);
  });

  it("/build chapter 17 launches the persistent chapter builder on that chapter", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const { env, effects } = environment();
    const [step] = await commands.execute("/build chapter 17", env);
    expect(step?.outcome).toMatchObject({ kind: "opened", panel: "chapterbuild" });
    expect(effects.chapterBuild).toEqual(["CHAPTER_0017"]);
  });

  it("/branch darker-ending opens Versions with the name ready", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const { env, effects } = environment();
    const [step] = await commands.execute("/branch darker-ending", env);
    expect(step?.outcome).toMatchObject({ kind: "opened", panel: "versions" });
    expect(effects.version).toEqual(["darker-ending"]);
  });

  it("/refactor hands the sentence to the staged workflow, applying nothing", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const { env, effects } = environment();
    const [step] = await commands.execute("/refactor Move vault discovery to Chapter 18", env);
    expect(step?.outcome).toMatchObject({ kind: "opened", panel: "refactor" });
    expect(effects.refactor).toEqual(["Move vault discovery to Chapter 18"]);
    expect(commands.registry.find("refactor")?.permission).toBe("stage");
  });
});

describe("resolution and ambiguity (§3)", () => {
  it("offers candidates when two names match, and accepts the chosen ID", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const two = [
      ...ENTITIES.filter((entry) => entry.id !== "CHAR_0019"),
      { id: "CHAR_0019", kind: "character", name: "Mara Ellison" },
      { id: "CHAR_0021", kind: "character", name: "Mara Vance" },
    ];
    const repo = {
      ...(fakeRepo() as unknown as Record<string, unknown>),
      listEntitySummaries: () => Promise.resolve(two),
    } as unknown as StoryRepository;
    const { env, effects } = environment({ repo });
    const [ambiguous] = await commands.execute("/inspect Mara", env);
    expect(ambiguous?.outcome.kind).toBe("ambiguous");
    if (ambiguous?.outcome.kind === "ambiguous") {
      expect(ambiguous.outcome.candidates.map((held) => held.name)).toEqual([
        "Mara Ellison",
        "Mara Vance",
      ]);
    }
    const [chosen] = await commands.execute("/inspect CHAR_0021", env);
    expect(chosen?.outcome).toMatchObject({ kind: "opened", panel: "characters" });
    expect(effects.selected).toEqual(["CHAR_0021"]);
  });
});

describe("output kinds and writing commands (§13, §14)", () => {
  it("/help and /word-count answer as reports, not as opened views", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const { env } = environment();
    const [help] = await commands.execute("/help", env);
    expect(help?.outcome.kind).toBe("report");
    const [wc] = await commands.execute("/word-count", env);
    expect(wc?.outcome.kind).toBe("report");
    if (wc?.outcome.kind === "report") {
      expect(wc.outcome.lines.at(-1)).toContain("6 words across 2 chapters");
    }
  });

  it("/open chapter 12 style references open the manuscript file", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const { env, effects } = environment();
    await commands.execute("/open chapter 17", env);
    expect(effects.files).toEqual(["manuscript/CHAPTER_0017.md"]);
  });

  it("/new scene creates a real scene in the open chapter", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const { env, effects } = environment({ openPath: "manuscript/CHAPTER_0001.md" });
    const [step] = await commands.execute("/new scene The Cellar Door", env);
    expect(step?.outcome.kind).toBe("report");
    expect(effects.selected).toEqual(["SCENE_0099"]);
    const { env: bare } = environment();
    const [refused] = await commands.execute("/new scene Nowhere", bare);
    expect(refused?.outcome.kind).toBe("error");
  });

  it("/find seeds the search panel and /story-map Mara focuses her arc", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const { env, effects } = environment();
    await commands.execute("/find brass key", env);
    expect(effects.search).toEqual(["brass key"]);
    await commands.execute("/story-map Mara", env);
    expect(effects.map).toEqual([{ view: "arc", focusId: "CHAR_0019" }]);
  });
});

describe("skills and modules share the registry (§12)", () => {
  it("registers built-in passes as commands that seed the Passes panel", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const { env, effects } = environment();
    const [step] = await commands.execute("/character-pass Mara", env);
    expect(step?.outcome).toMatchObject({ kind: "opened", panel: "skills" });
    expect(effects.skill).toEqual(["/character-pass Mara"]);
    expect(commands.registry.find("dialogue-pass")).not.toBeNull();
    expect(commands.registry.find("pacing-audit")).not.toBeNull();
    expect(commands.registry.find("continuity")?.id).toBe("continuity-audit");
  });

  it("gates /trace clue on the Mystery module", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const { env } = environment();
    const [refused] = await commands.execute("/trace clue bloody_watch", env);
    expect(refused?.outcome.kind).toBe("error");
    const { env: withMystery } = environment({ enabledModules: ["mystery"] });
    const [step] = await commands.execute("/trace clue bloody_watch", withMystery);
    expect(step?.outcome).toMatchObject({ kind: "opened", panel: "mystery" });
  });
});

describe("chains stop where approval starts (§8, §11)", () => {
  it("runs read/workflow steps in order", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const { env } = environment();
    const steps = await commands.execute("/word-count then /compare", env);
    expect(steps.map((held) => held.outcome.kind)).toEqual(["report", "opened"]);
  });

  it("refuses to chain the staged refactor", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const { env } = environment();
    const steps = await commands.execute("/build then /refactor Rename Mara", env);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.outcome.kind).toBe("error");
    expect(steps[0]?.outcome.kind === "error" && steps[0].outcome.message).toContain("/refactor");
  });
});

describe("the palette shares the registry (§6)", () => {
  it("lists every no-argument command and runs through the same executor", async () => {
    const commands = await buildCommandSet(fakeRepo());
    const ran: string[] = [];
    const entries = paletteEntries(commands, (line) => ran.push(line));
    const labels = entries.map((entry) => entry.label);
    expect(labels).toContain("/word-count");
    expect(labels).toContain("/build");
    expect(labels).not.toContain("/open"); // Needs an argument only a keyboard can give.
    entries.find((entry) => entry.label === "/word-count")?.run();
    expect(ran).toEqual(["/word-count"]);
  });
});
