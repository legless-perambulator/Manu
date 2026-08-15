import { describe, expect, it } from "vitest";
import { CommandRegistry } from "./registry";
import { parseCommandLine, tokenize } from "./parser";
import { resolveChapter, resolveEntity } from "./resolve";
import { complete } from "./complete";
import { helpFor, helpOverview } from "./help";
import { CommandHistory, carriesSensitiveValue } from "./history";
import { isChain, parseChain } from "./chain";
import type { CatalogEntry, CommandSpec } from "./types";

function spec(partial: Partial<CommandSpec> & { id: string }): CommandSpec {
  return {
    aliases: [],
    group: "Test",
    summary: `The ${partial.id} command`,
    usage: `/${partial.id}`,
    args: [],
    options: [],
    permission: "open",
    chainable: true,
    source: "core",
    ...partial,
  };
}

function registryWith(...specs: CommandSpec[]): CommandRegistry {
  const registry = new CommandRegistry();
  for (const held of specs) registry.register(held);
  return registry;
}

const CATALOG: readonly CatalogEntry[] = [
  { id: "CHAR_0019", kind: "character", name: "Mara Ellison" },
  { id: "CHAR_0021", kind: "character", name: "Mara Vance" },
  { id: "CHAR_0002", kind: "character", name: "Marcus Webb" },
  { id: "THREAD_0004", kind: "plot_thread", name: "Missing Photograph" },
  { id: "FACT_0007", kind: "fact", name: "vault_exists" },
];

describe("registry", () => {
  it("finds commands by id and alias, with or without the slash", () => {
    const registry = registryWith(spec({ id: "inspect", aliases: ["i"] }));
    expect(registry.find("/inspect")?.id).toBe("inspect");
    expect(registry.find("i")?.id).toBe("inspect");
    expect(registry.find("/nope")).toBeNull();
  });

  it("rejects duplicate names across ids and aliases", () => {
    const registry = registryWith(spec({ id: "build" }));
    expect(() => registry.register(spec({ id: "compile", aliases: ["build"] }))).toThrow(
      /already registered/,
    );
  });

  it("rejects specs that could not parse unambiguously", () => {
    expect(() =>
      registryWith(
        spec({
          id: "bad",
          args: [
            { name: "tail", summary: "tail", required: false, kind: "rest" },
            { name: "after", summary: "after", required: true, kind: "word" },
          ],
        }),
      ),
    ).toThrow(/must be last/);
  });
});

describe("parser (§16 — purpose-built, no shell)", () => {
  const registry = registryWith(
    spec({
      id: "trace",
      usage: "/trace <what> <name>",
      args: [
        {
          name: "what",
          summary: "what to trace",
          required: true,
          kind: "choice",
          choices: ["thread", "fact", "clue"],
        },
        { name: "name", summary: "the thing to trace", required: true, kind: "rest" },
      ],
    }),
    spec({
      id: "find",
      usage: "/find <text>",
      args: [{ name: "text", summary: "text to search for", required: true, kind: "rest" }],
    }),
    spec({
      id: "build",
      options: [
        { name: "quick", summary: "quick build", takesValue: false },
        {
          name: "scope",
          summary: "scope",
          takesValue: true,
          choices: ["chapter", "book"],
        },
      ],
    }),
  );

  it("tokenizes quotes as phrases", () => {
    expect(tokenize('/find "brass key" now').map((t) => t.text)).toEqual([
      "/find",
      "brass key",
      "now",
    ]);
  });

  it("parses a command with choice and rest arguments", () => {
    const parsed = parseCommandLine("/trace thread Missing Photograph", registry);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.invocation.args["what"]).toBe("thread");
      expect(parsed.invocation.args["name"]).toBe("Missing Photograph");
    }
  });

  it("treats shell metacharacters as plain text, never as syntax", () => {
    const parsed = parseCommandLine("/find $(rm -rf /) ; | && `echo`", registry);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.invocation.args["text"]).toBe("$(rm -rf /) ; | && `echo`");
  });

  it("rejects unknown commands, bad choices, missing args and unknown options", () => {
    expect(parseCommandLine("/warp", registry).ok).toBe(false);
    expect(parseCommandLine("/trace sideways x", registry).ok).toBe(false);
    const missing = parseCommandLine("/trace thread", registry);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.usage).toBe("/trace <what> <name>");
    expect(parseCommandLine("/build --loud", registry).ok).toBe(false);
    expect(parseCommandLine("/build --scope=act", registry).ok).toBe(false);
  });

  it("parses flags and valued options", () => {
    const parsed = parseCommandLine("/build --quick --scope=chapter", registry);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.invocation.options["quick"]).toBe(true);
      expect(parsed.invocation.options["scope"]).toBe("chapter");
    }
  });
});

describe("entity resolution (§3)", () => {
  it("resolves a unique word match to the stable ID", () => {
    const result = resolveEntity("Marcus", CATALOG);
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") expect(result.entry.id).toBe("CHAR_0002");
  });

  it("offers both Maras rather than guessing", () => {
    const result = resolveEntity("Mara", CATALOG);
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.map((entry) => entry.name)).toEqual(["Mara Ellison", "Mara Vance"]);
    }
  });

  it("re-running with the chosen ID is deterministic", () => {
    const result = resolveEntity("CHAR_0021", CATALOG);
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") expect(result.entry.name).toBe("Mara Vance");
  });

  it("matches underscore names against spaced queries and back", () => {
    const result = resolveEntity("vault exists", CATALOG);
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") expect(result.entry.id).toBe("FACT_0007");
    const underscored = resolveEntity("missing_photograph", CATALOG);
    expect(underscored.kind).toBe("resolved");
    if (underscored.kind === "resolved") expect(underscored.entry.id).toBe("THREAD_0004");
  });

  it("restricts by kind when the argument says so", () => {
    const result = resolveEntity("Mara", CATALOG, ["plot_thread"]);
    expect(result.kind).toBe("unknown");
  });

  it("resolves chapters by 1-based number", () => {
    const chapters = [
      { id: "CHAPTER_0001", title: "The Fire", order: 0 },
      { id: "CHAPTER_0017", title: "The Vault", order: 16 },
    ];
    const byNumber = resolveChapter("17", chapters);
    expect(byNumber.kind).toBe("resolved");
    if (byNumber.kind === "resolved") expect(byNumber.entry.id).toBe("CHAPTER_0017");
    const byTitle = resolveChapter("vault", chapters);
    expect(byTitle.kind).toBe("resolved");
    if (byTitle.kind === "resolved") expect(byTitle.entry.id).toBe("CHAPTER_0017");
  });
});

describe("autocomplete (§4)", () => {
  const registry = registryWith(
    spec({
      id: "trace",
      args: [
        {
          name: "what",
          summary: "what to trace",
          required: true,
          kind: "choice",
          choices: ["thread", "fact", "clue"],
        },
        {
          name: "name",
          summary: "the thing",
          required: true,
          kind: "rest",
          entityKinds: ["plot_thread", "fact"],
        },
      ],
    }),
    spec({
      id: "inspect",
      args: [{ name: "who", summary: "who", required: true, kind: "entity" }],
    }),
    spec({ id: "index-cards" }),
  );

  it("completes command names from a prefix", () => {
    const suggestions = complete("/tr", registry, CATALOG);
    expect(suggestions.map((held) => held.label)).toEqual(["/trace"]);
  });

  it("completes /trace th to the thread choice", () => {
    const suggestions = complete("/trace th", registry, CATALOG);
    expect(suggestions.map((held) => held.value)).toEqual(["thread"]);
  });

  it("then suggests the project's own threads", () => {
    const suggestions = complete("/trace thread ", registry, CATALOG);
    expect(suggestions.map((held) => held.label)).toContain("Missing Photograph");
    expect(suggestions.map((held) => held.label)).not.toContain("Mara Ellison");
  });

  it("suggests entities for an entity argument, quoting multi-word names", () => {
    const suggestions = complete("/inspect Mar", registry, CATALOG);
    expect(suggestions.map((held) => held.value)).toContain('"Mara Ellison"');
  });
});

describe("help (§5)", () => {
  const registry = registryWith(
    spec({ id: "refactor", usage: "/refactor <change>", permission: "stage" }),
    spec({ id: "build" }),
  );

  it("overviews one line per command", () => {
    const lines = helpOverview(registry);
    expect(lines.some((line) => line.includes("/refactor <change>"))).toBe(true);
    expect(lines.some((line) => line.includes("/build"))).toBe(true);
  });

  it("states the staged-approval guarantee on stage commands", () => {
    const lines = helpFor(registry, "refactor");
    expect(lines).not.toBeNull();
    expect(lines?.some((line) => line.includes("analyse → preview → stage → approve"))).toBe(true);
    expect(helpFor(registry, "warp")).toBeNull();
  });
});

describe("history (§10)", () => {
  it("navigates up and down, restoring the draft", () => {
    const history = new CommandHistory(["/build", "/inspect Mara"]);
    expect(history.previous("/dra")).toBe("/inspect Mara");
    expect(history.previous("/dra")).toBe("/build");
    expect(history.next()).toBe("/inspect Mara");
    expect(history.next()).toBe("/dra");
  });

  it("collapses consecutive duplicates and stays bounded", () => {
    const history = new CommandHistory([], 3);
    history.push("/a");
    history.push("/a");
    history.push("/b");
    history.push("/c");
    history.push("/d");
    expect(history.entries()).toEqual(["/b", "/c", "/d"]);
  });

  it("flags invocations that carry sensitive option values", () => {
    const withSecret = spec({
      id: "connect",
      options: [{ name: "key", summary: "an API key", takesValue: true, sensitive: true }],
    });
    const registry = registryWith(withSecret);
    const parsed = parseCommandLine("/connect --key=sk-123", registry);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(carriesSensitiveValue(parsed.invocation)).toBe(true);
    const bare = parseCommandLine("/connect", registry);
    if (bare.ok) expect(carriesSensitiveValue(bare.invocation)).toBe(false);
  });
});

describe("chains (§11)", () => {
  const registry = registryWith(
    spec({ id: "build" }),
    spec({ id: "continuity-audit" }),
    spec({ id: "dialogue-pass" }),
    spec({ id: "refactor", chainable: false, permission: "stage" }),
    spec({
      id: "debug",
      args: [{ name: "problem", summary: "the problem", required: true, kind: "rest" }],
    }),
  );

  it("parses /build then /continuity-audit then /dialogue-pass", () => {
    const result = parseChain("/build then /continuity-audit then /dialogue-pass", registry);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain.steps.map((step) => step.spec.id)).toEqual([
        "build",
        "continuity-audit",
        "dialogue-pass",
      ]);
    }
  });

  it("leaves 'then' inside prose alone", () => {
    expect(isChain("/debug why Marcus then betrays Elias")).toBe(false);
    const result = parseChain("/debug why Marcus then betrays Elias", registry);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.chain.steps).toHaveLength(1);
      expect(result.chain.steps[0]?.args["problem"]).toBe("why Marcus then betrays Elias");
    }
  });

  it("refuses non-chainable steps and over-long chains", () => {
    const staged = parseChain("/build then /refactor", registry);
    expect(staged.ok).toBe(false);
    if (!staged.ok) expect(staged.error).toContain("/refactor");
    const long = parseChain(Array.from({ length: 9 }, () => "/build").join(" then "), registry);
    expect(long.ok).toBe(false);
  });

  it("validates the whole chain before any step could run", () => {
    const result = parseChain("/build then /warp then /dialogue-pass", registry);
    expect(result.ok).toBe(false);
  });
});
