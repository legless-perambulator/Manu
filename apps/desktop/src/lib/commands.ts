import {
  CommandRegistry,
  helpFor,
  helpOverview,
  isChain,
  parseChain,
  parseCommandLine,
  resolveChapter,
  resolveEntity,
  type CatalogEntry,
  type ChapterRef,
  type CommandSpec,
  type Invocation,
  type Resolution,
} from "@jellytind/command-language";
import { BUILT_IN_SKILLS, loadCustomSkills, type SkillDefinition } from "@jellytind/skills";
import type { StoryRepository } from "@jellytind/story-repository";
import type { LeftPanelId } from "./panels";
import type { MapFocus } from "../components/StoryMapPanel";

/**
 * Manu's command set: concise access to real structured operations.
 *
 * Every command here is backed by an existing workflow — a panel, a builder, a
 * tracer, a staged refactor. Nothing in this file forwards text to a model,
 * and nothing applies a significant change: a command that reaches project
 * state opens the workflow that owns the analyse → preview → stage → approve
 * path, exactly as if the writer had clicked their way there
 * (docs/COMMAND_LANGUAGE.md).
 */

/** The side effects a command may ask the workbench for. */
export interface CommandEnvironment {
  readonly repo: StoryRepository;
  readonly enabledModules: readonly string[];
  /** The document open in the editor, for commands that act "here". */
  readonly openPath: string | null;
  showPanel(id: LeftPanelId): void;
  openFile(path: string): void;
  selectEntity(id: string): void;
  openScene(sceneId: string): void;
  /** Pre-fill and run the Story Debugger's own `/debug` fast path. */
  seedDebug(commandLine: string): void;
  /** Pre-fill the Restructure workflow's instruction. Never applies anything. */
  seedRefactor(instruction: string): void;
  seedSearch(query: string): void;
  /** Pre-fill the new-version name in Versions. */
  seedVersionName(name: string): void;
  /** Pre-select the chapter in the persistent chapter builder. */
  seedChapterBuild(chapterId: string): void;
  /** Pre-fill the Passes panel's command line, e.g. "/character-pass Mara". */
  seedSkill(commandLine: string): void;
  focusMap(focus: MapFocus): void;
  toggleFocusMode(): void;
}

/**
 * What a command produced (§13). The terminal renders reports and errors as
 * text; everything else is a view that opened, a workflow that started — the
 * outcome lives where the workflow lives, not squeezed into terminal text.
 */
export type CommandOutcome =
  | { readonly kind: "report"; readonly title: string; readonly lines: readonly string[] }
  | { readonly kind: "opened"; readonly panel: LeftPanelId; readonly note: string }
  | { readonly kind: "error"; readonly message: string; readonly usage?: string }
  | {
      readonly kind: "ambiguous";
      readonly query: string;
      readonly candidates: readonly CatalogEntry[];
    };

/** One executed step: the line as run, and what came of it. */
export interface StepOutcome {
  readonly line: string;
  readonly outcome: CommandOutcome;
}

/** Project data handlers resolve against, fetched fresh per execution. */
interface ResolveContext {
  readonly catalog: readonly CatalogEntry[];
  readonly chapters: readonly ChapterRef[];
}

type Handler = (
  invocation: Invocation,
  env: CommandEnvironment,
  ctx: ResolveContext,
) => Promise<CommandOutcome> | CommandOutcome;

const CORE = "core";

/** The registry plus what each command actually does. */
export class ManuCommands {
  readonly registry = new CommandRegistry();
  private readonly handlers = new Map<string, Handler>();

  /** One door for built-ins, skills and future plugins alike (§12). */
  register(spec: CommandSpec, run: Handler): void {
    this.registry.register(spec);
    this.handlers.set(spec.id, run);
  }

  /**
   * Execute a line, which may be a bounded chain (§11). Steps run in order;
   * an error or an ambiguity stops the chain, and a step that opens a staged
   * workflow ends it too — approval belongs to the writer, not to step three.
   */
  async execute(line: string, env: CommandEnvironment): Promise<StepOutcome[]> {
    const ctx: ResolveContext = {
      catalog: await env.repo.listEntitySummaries(),
      chapters: (await env.repo.listChapters())
        .map((chapter) => ({
          id: chapter.id as string,
          title: chapter.title,
          order: chapter.order,
        }))
        .sort((a, b) => a.order - b.order),
    };

    if (isChain(line)) {
      const chain = parseChain(line, this.registry);
      if (!chain.ok) return [{ line, outcome: { kind: "error", message: chain.error } }];
      const out: StepOutcome[] = [];
      for (const step of chain.chain.steps) {
        const rendered = renderStep(step);
        const outcome = await this.run(step, env, ctx);
        out.push({ line: rendered, outcome });
        if (outcome.kind === "error" || outcome.kind === "ambiguous") break;
        if (step.spec.permission === "stage") break;
      }
      return out;
    }

    const parsed = parseCommandLine(line, this.registry);
    if (!parsed.ok) {
      return [
        {
          line,
          outcome: {
            kind: "error",
            message: parsed.error,
            ...(parsed.usage !== undefined ? { usage: parsed.usage } : {}),
          },
        },
      ];
    }
    return [{ line, outcome: await this.run(parsed.invocation, env, ctx) }];
  }

  private async run(
    invocation: Invocation,
    env: CommandEnvironment,
    ctx: ResolveContext,
  ): Promise<CommandOutcome> {
    const handler = this.handlers.get(invocation.spec.id);
    /* istanbul ignore next — register() keeps spec and handler together. */
    if (handler === undefined) {
      return { kind: "error", message: `/${invocation.spec.id} has no handler.` };
    }
    try {
      return await handler(invocation, env, ctx);
    } catch (cause) {
      return {
        kind: "error",
        message: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }
}

function renderStep(invocation: Invocation): string {
  const parts = [`/${invocation.spec.id}`];
  for (const arg of invocation.spec.args) {
    const value = invocation.args[arg.name];
    if (value !== undefined) parts.push(value);
  }
  return parts.join(" ");
}

/** Turn a Resolution into an outcome, or hand back the entry to act on. */
function unwrap(
  resolution: Resolution,
  query: string,
): { entry: CatalogEntry } | { outcome: CommandOutcome } {
  if (resolution.kind === "resolved") return { entry: resolution.entry };
  if (resolution.kind === "ambiguous") {
    return { outcome: { kind: "ambiguous", query, candidates: resolution.candidates } };
  }
  return {
    outcome: {
      kind: "error",
      message: `Nothing in this project is called "${query}".`,
    },
  };
}

const opened = (panel: LeftPanelId, note: string): CommandOutcome => ({
  kind: "opened",
  panel,
  note,
});

/**
 * Build the standard command set over a project.
 *
 * Skills — built-in and the project's own custom ones — register their
 * `/command` names into the same registry, which is how `/character-pass`
 * and a custom `/murder-mystery-audit` exist on equal terms (§12).
 */
export async function buildCommandSet(
  repo: StoryRepository,
  enabledModules: readonly string[] = [],
): Promise<ManuCommands> {
  const commands = new ManuCommands();

  commands.register(
    {
      id: "help",
      aliases: [],
      group: "Help",
      summary: "List every command, or explain one",
      usage: "/help [command]",
      args: [{ name: "topic", summary: "a command name", required: false, kind: "word" }],
      options: [],
      permission: "read",
      chainable: false,
      source: CORE,
    },
    (invocation) => {
      const topic = invocation.args["topic"];
      if (topic !== undefined) {
        const lines = helpFor(commands.registry, topic);
        if (lines === null) {
          return { kind: "error", message: `"${topic}" is not a command. /help lists them.` };
        }
        return { kind: "report", title: `/${topic.replace(/^\//, "")}`, lines };
      }
      return { kind: "report", title: "Commands", lines: helpOverview(commands.registry) };
    },
  );

  commands.register(
    {
      id: "build",
      aliases: [],
      group: "Check",
      summary: "Run the Story Build, or launch a chapter, act or book build",
      usage: "/build [chapter|act|book] [which]",
      args: [
        {
          name: "target",
          summary: "what to build",
          required: false,
          kind: "choice",
          choices: ["chapter", "act", "book"],
        },
        { name: "which", summary: "which chapter", required: false, kind: "rest" },
      ],
      options: [],
      permission: "workflow",
      chainable: true,
      source: CORE,
    },
    (invocation, env, ctx) => {
      const target = invocation.args["target"];
      if (target === undefined) return opened("build", "Story Build opened. Run it from there.");
      if (target === "act") return opened("actbuild", "The act builder is open.");
      if (target === "book") return opened("bookbuild", "The book builder is open.");
      const which = invocation.args["which"];
      if (which === undefined) return opened("chapterbuild", "The chapter builder is open.");
      const found = unwrap(resolveChapter(which, ctx.chapters), which);
      if ("outcome" in found) return found.outcome;
      env.seedChapterBuild(found.entry.id);
      return opened("chapterbuild", `Chapter builder opened on ${found.entry.name}.`);
    },
  );

  commands.register(
    {
      id: "inspect",
      aliases: ["i"],
      group: "Story",
      summary: "Open an entity's record by name",
      usage: "/inspect <name>",
      args: [
        {
          name: "who",
          summary: "an entity name, e.g. Mara",
          required: false,
          kind: "rest",
          entityKinds: [],
        },
      ],
      options: [],
      permission: "open",
      chainable: true,
      source: CORE,
    },
    (invocation, env, ctx) => {
      const who = invocation.args["who"];
      if (who === undefined) return opened("entities", "The story bible is open.");
      const found = unwrap(resolveEntity(who, ctx.catalog), who);
      if ("outcome" in found) return found.outcome;
      env.selectEntity(found.entry.id);
      const panel: LeftPanelId = found.entry.kind === "character" ? "characters" : "inspector";
      return opened(panel, `${found.entry.name} is open.`);
    },
  );

  commands.register(
    {
      id: "open",
      aliases: ["o"],
      group: "Write",
      summary: "Open a chapter by number or title, or an entity by name",
      usage: "/open <chapter 12 | name>",
      args: [{ name: "what", summary: "a chapter or an entity", required: true, kind: "rest" }],
      options: [],
      permission: "open",
      chainable: true,
      source: CORE,
    },
    async (invocation, env, ctx) => {
      const what = (invocation.args["what"] ?? "").replace(/^chapter\s+/i, "");
      const chapter = resolveChapter(what, ctx.chapters);
      if (chapter.kind === "resolved") {
        const record = (await env.repo.listChapters()).find(
          (held) => (held.id as string) === chapter.entry.id,
        );
        if (record !== undefined) {
          env.openFile(record.filePath);
          return { kind: "report", title: "Open", lines: [`${chapter.entry.name} is open.`] };
        }
      }
      const found = unwrap(resolveEntity(what, ctx.catalog), what);
      if ("outcome" in found) return found.outcome;
      if (found.entry.kind === "scene") {
        env.openScene(found.entry.id);
        return { kind: "report", title: "Open", lines: [`${found.entry.name} is open.`] };
      }
      env.selectEntity(found.entry.id);
      return opened(
        found.entry.kind === "character" ? "characters" : "inspector",
        `${found.entry.name} is open.`,
      );
    },
  );

  commands.register(
    {
      id: "find",
      aliases: ["search"],
      group: "Story",
      summary: "Search every chapter, note and record",
      usage: "/find <text>",
      args: [{ name: "text", summary: "text to search for", required: true, kind: "rest" }],
      options: [],
      permission: "open",
      chainable: true,
      source: CORE,
    },
    (invocation, env) => {
      const text = invocation.args["text"] as string;
      env.seedSearch(text);
      return opened("search", `Searching for “${text}”.`);
    },
  );

  commands.register(
    {
      id: "debug",
      aliases: [],
      group: "Check",
      summary: "Investigate why something is not landing",
      usage: "/debug <problem — e.g. betrayal Marcus>",
      args: [
        {
          name: "problem",
          summary: "what to investigate",
          required: false,
          kind: "rest",
          entityKinds: ["character", "plot_thread", "fact", "scene"],
        },
      ],
      options: [],
      permission: "workflow",
      chainable: true,
      source: CORE,
    },
    (invocation, env) => {
      const problem = invocation.args["problem"];
      if (problem === undefined) return opened("debug", "The Story Debugger is open.");
      env.seedDebug(`/debug ${problem}`);
      return opened("debug", `Tracing “${problem}” — the evidence run uses no model.`);
    },
  );

  commands.register(
    {
      id: "refactor",
      aliases: ["restructure"],
      group: "Change",
      summary: "Plan a structural change — analysed, previewed, staged, approved",
      usage: "/refactor <describe the change>",
      args: [
        { name: "change", summary: "the change in your own words", required: false, kind: "rest" },
      ],
      options: [],
      permission: "stage",
      chainable: false,
      source: CORE,
    },
    (invocation, env) => {
      const change = invocation.args["change"];
      if (change !== undefined) env.seedRefactor(change);
      return opened(
        "refactor",
        change === undefined
          ? "Restructure is open."
          : "Restructure is open with your instruction. Nothing applies until you approve it.",
      );
    },
  );

  commands.register(
    {
      id: "branch",
      aliases: ["version"],
      group: "Change",
      summary: "Start an alternative version of the story",
      usage: "/branch <name>",
      args: [{ name: "name", summary: "a name for the version", required: false, kind: "rest" }],
      options: [],
      permission: "workflow",
      chainable: false,
      source: CORE,
    },
    (invocation, env) => {
      const name = invocation.args["name"];
      if (name !== undefined) env.seedVersionName(name);
      return opened(
        "versions",
        name === undefined
          ? "Versions is open."
          : `Versions is open with “${name}” ready to create.`,
      );
    },
  );

  commands.register(
    {
      id: "compare",
      aliases: [],
      group: "Change",
      summary: "Compare story versions",
      usage: "/compare",
      args: [],
      options: [],
      permission: "open",
      chainable: true,
      source: CORE,
    },
    () => opened("versions", "Versions is open — pick one to compare."),
  );

  commands.register(
    {
      id: "trace",
      aliases: [],
      group: "Story",
      summary: "Follow a thread, a fact or a clue through the story",
      usage: "/trace <thread|fact|clue> <name>",
      args: [
        {
          name: "what",
          summary: "what kind of thing to trace",
          required: true,
          kind: "choice",
          choices: ["thread", "fact", "clue"],
        },
        {
          name: "name",
          summary: "its name",
          required: true,
          kind: "rest",
          entityKinds: ["plot_thread", "fact"],
        },
      ],
      options: [],
      permission: "open",
      chainable: true,
      source: CORE,
    },
    (invocation, env, ctx) => {
      const what = invocation.args["what"] as string;
      const name = invocation.args["name"] as string;
      if (what === "clue") {
        if (!env.enabledModules.includes("mystery")) {
          return {
            kind: "error",
            message: "Tracing clues needs the Mystery module (Modules panel).",
          };
        }
        return opened("mystery", `Mystery is open — trace “${name}” there.`);
      }
      const kinds = what === "thread" ? ["plot_thread"] : ["fact"];
      const found = unwrap(resolveEntity(name, ctx.catalog, kinds), name);
      if ("outcome" in found) return found.outcome;
      env.selectEntity(found.entry.id);
      return what === "thread"
        ? opened("threads", `${found.entry.name} is selected in Plot threads.`)
        : opened("knowledge", `${found.entry.name} is selected in Knowledge.`);
    },
  );

  commands.register(
    {
      id: "story-map",
      aliases: ["map"],
      group: "Story",
      summary: "Explore the story visually, optionally focused on an entity",
      usage: "/story-map [name]",
      args: [
        {
          name: "focus",
          summary: "an entity to focus on",
          required: false,
          kind: "rest",
          entityKinds: [],
        },
      ],
      options: [],
      permission: "open",
      chainable: true,
      source: CORE,
    },
    (invocation, env, ctx) => {
      const focus = invocation.args["focus"];
      if (focus === undefined) {
        env.focusMap({});
        return opened("storymap", "The Story Map is open.");
      }
      const found = unwrap(resolveEntity(focus, ctx.catalog), focus);
      if ("outcome" in found) return found.outcome;
      const view =
        found.entry.kind === "character"
          ? ("arc" as const)
          : found.entry.kind === "plot_thread"
            ? ("threads" as const)
            : found.entry.kind === "fact"
              ? ("knowledge" as const)
              : ("causality" as const);
      env.focusMap({ view, focusId: found.entry.id });
      return opened("storymap", `The Story Map is open on ${found.entry.name}.`);
    },
  );

  commands.register(
    {
      id: "map-manuscript",
      aliases: [],
      group: "Story",
      summary: "Reconstruct structured story data from the manuscript",
      usage: "/map-manuscript",
      args: [],
      options: [],
      permission: "workflow",
      chainable: false,
      source: CORE,
    },
    () => opened("mapping", "Map Manuscript is open. Everything lands as reviewable proposals."),
  );

  commands.register(
    {
      id: "export",
      aliases: [],
      group: "Write",
      summary: "Export the manuscript, or the whole project as an archive",
      usage: "/export",
      args: [],
      options: [],
      permission: "open",
      chainable: false,
      source: CORE,
    },
    () => opened("export", "Export is open."),
  );

  commands.register(
    {
      id: "research",
      aliases: [],
      group: "Assist",
      summary: "Open the research library",
      usage: "/research",
      args: [],
      options: [],
      permission: "open",
      chainable: true,
      source: CORE,
    },
    () => opened("research", "Research is open."),
  );

  commands.register(
    {
      id: "reader-sim",
      aliases: ["readers"],
      group: "Check",
      summary: "How a reader experiences the book, chapter by chapter",
      usage: "/reader-sim",
      args: [],
      options: [],
      permission: "workflow",
      chainable: true,
      source: CORE,
    },
    () => opened("readers", "Readers is open."),
  );

  commands.register(
    {
      id: "voice-check",
      aliases: ["voice"],
      group: "Check",
      summary: "Your style rules and what Manu thinks your voice is",
      usage: "/voice-check",
      args: [],
      options: [],
      permission: "open",
      chainable: true,
      source: CORE,
    },
    () => opened("voice", "Voice is open."),
  );

  commands.register(
    {
      id: "word-count",
      aliases: ["wc"],
      group: "Write",
      summary: "Word counts for the manuscript",
      usage: "/word-count",
      args: [],
      options: [],
      permission: "read",
      chainable: true,
      source: CORE,
    },
    async (_invocation, env) => {
      const chapters = [...(await env.repo.listChapters())].sort((a, b) => a.order - b.order);
      let total = 0;
      const lines: string[] = [];
      for (const chapter of chapters) {
        const text = (await env.repo.readProjectFile(chapter.filePath)) ?? "";
        const words = countWords(text);
        total += words;
        lines.push(`${chapter.title}: ${words.toLocaleString()}`);
      }
      lines.push(`Total: ${total.toLocaleString()} words across ${chapters.length} chapters.`);
      return { kind: "report", title: "Word count", lines };
    },
  );

  commands.register(
    {
      id: "focus",
      aliases: [],
      group: "Write",
      summary: "Toggle Focus Mode — the manuscript alone",
      usage: "/focus",
      args: [],
      options: [],
      permission: "open",
      chainable: false,
      source: CORE,
    },
    (_invocation, env) => {
      env.toggleFocusMode();
      return { kind: "report", title: "Focus", lines: ["Focus Mode toggled."] };
    },
  );

  commands.register(
    {
      id: "new",
      aliases: [],
      group: "Write",
      summary: "Create a scene in the open chapter",
      usage: "/new scene <title>",
      args: [
        {
          name: "what",
          summary: "what to create",
          required: true,
          kind: "choice",
          choices: ["scene"],
        },
        { name: "title", summary: "a title for it", required: true, kind: "rest" },
      ],
      options: [],
      permission: "workflow",
      chainable: false,
      source: CORE,
    },
    async (invocation, env) => {
      const title = invocation.args["title"] as string;
      const chapters = await env.repo.listChapters();
      const chapter = chapters.find((held) => held.filePath === env.openPath);
      if (chapter === undefined) {
        return {
          kind: "error",
          message: "Open a chapter first — the scene is created in the open chapter.",
        };
      }
      const scene = await env.repo.addScene({ title, chapterId: chapter.id });
      env.selectEntity(scene.id as string);
      return {
        kind: "report",
        title: "New scene",
        lines: [`“${title}” created in ${chapter.title}. It is journaled and revertible.`],
      };
    },
  );

  // Every skill with a /command becomes a command — the same registry, the
  // same parser, whether Manu shipped it or the writer wrote it (§12).
  const custom = await loadCustomSkills(repo);
  const skills: readonly SkillDefinition[] = [...BUILT_IN_SKILLS, ...custom.skills];
  for (const skill of skills) {
    // A module's skill arrives and leaves with its module, like its panel does.
    if (skill.module !== undefined && !enabledModules.includes(skill.module)) continue;
    const id = skill.command.replace(/^\//, "").toLowerCase();
    if (commands.registry.find(id) !== null) continue;
    const aliases = id === "continuity-audit" ? ["continuity"] : [];
    commands.register(
      {
        id,
        aliases,
        group: "Passes",
        summary: skill.description,
        usage: `${skill.command} [subject]`,
        args: [
          {
            name: "subject",
            summary: "what to run it on",
            required: false,
            kind: "rest",
            entityKinds: ["character", "chapter", "scene", "plot_thread"],
          },
        ],
        options: [],
        permission: "workflow",
        chainable: true,
        source: skill.id,
      },
      (invocation, env) => {
        const subject = invocation.args["subject"];
        env.seedSkill(subject === undefined ? skill.command : `${skill.command} ${subject}`);
        return opened("skills", `${skill.name} is ready in Passes. Run it from there.`);
      },
    );
  }

  return commands;
}

/**
 * The palette and the terminal share this registry (§6): every no-argument
 * command appears in the palette, running through exactly the same executor.
 * Commands that need arguments stay in the terminal, where arguments can be
 * typed — the palette is not a place to type an entity name.
 */
export function paletteEntries(
  commands: ManuCommands,
  run: (line: string) => void,
): ReadonlyArray<{ id: string; section: string; label: string; hint: string; run: () => void }> {
  return commands.registry
    .list()
    .filter((spec) => spec.args.every((arg) => !arg.required))
    .map((spec) => ({
      id: `command.${spec.id}`,
      section: "Commands",
      label: `/${spec.id}`,
      hint: spec.summary,
      run: () => run(`/${spec.id}`),
    }));
}

function countWords(text: string): number {
  const words = text
    .replace(/^---\n[\s\S]*?\n---\n?/, "") // Front matter is metadata, not prose.
    .split(/\s+/)
    .filter((word) => /\w/.test(word));
  return words.length;
}
