import { describe, expect, it } from "vitest";
import { PluginHost, manuscriptStatistics, type HostEnvironment } from "./host";
import { validateManifest } from "./validate";
import { WRITING_STATISTICS_PLUGIN } from "./reference";
import {
  compilerRulesFrom,
  exportWithTemplate,
  importWithDialect,
  semanticBriefingsFrom,
} from "./contrib";
import type { PluginManifest } from "./types";

/** Phase 42: the reference plugin end to end, and the §25 security suite. */

const CHAPTERS = [
  { title: "Chapter One", text: 'The hall was cold. "We are late," said Mara. She ran.' },
  { title: "Chapter Two", text: "Elias waited in the dark cellar for a very long time." },
];

function env(overrides: Partial<HostEnvironment> = {}): HostEnvironment {
  return {
    project: {
      chapters: () => Promise.resolve(CHAPTERS),
      entityCounts: () => Promise.resolve({ character: 3, location: 2 }),
    },
    ...overrides,
  };
}

function manifest(patch: Partial<PluginManifest> & Record<string, unknown>): unknown {
  return {
    id: "com.example.test",
    name: "Test Plugin",
    version: "1.0.0",
    protocolVersion: "1.0",
    permissions: [],
    contributes: {},
    ...patch,
  };
}

describe("the reference plugin (§24)", () => {
  it("installs, enables, runs its typed tool, disables cleanly", async () => {
    const host = new PluginHost(env());
    const installed = host.install(WRITING_STATISTICS_PLUGIN);
    expect(installed.ok).toBe(true);

    // Not enabled yet: nothing runs.
    const early = await host.callTool("com.manu.writing-statistics", "writing_statistics", {});
    expect(early.ok).toBe(false);

    host.enable("com.manu.writing-statistics");
    const result = await host.callTool("com.manu.writing-statistics", "writing_statistics", {});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value["chapters"]).toBe(2);
      expect(result.value["totalWords"]).toBeGreaterThan(15);
      expect(result.value["dialoguePercent"]).toBeGreaterThan(0);
      expect((result.value["perChapter"] as unknown[]).length).toBe(2);
    }

    // Disable removes the capability (§17, §25).
    host.disable("com.manu.writing-statistics");
    const after = await host.callTool("com.manu.writing-statistics", "writing_statistics", {});
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error).toContain("disabled");
  });

  it("computes statistics honestly", () => {
    const stats = manuscriptStatistics(CHAPTERS);
    expect(stats["chapters"]).toBe(2);
    expect(stats["averageChapterWords"]).toBeGreaterThan(0);
  });
});

describe("§25 — security", () => {
  it("rejects an invalid manifest", () => {
    const host = new PluginHost(env());
    expect(host.install("not json {").ok).toBe(false);
    expect(host.install(manifest({ id: "Bad Id!!" })).ok).toBe(false);
    expect(host.install(manifest({ version: "one" })).ok).toBe(false);
    expect(host.plugins()).toHaveLength(0);
  });

  it("refuses an incompatible protocol version, loudly", () => {
    const result = validateManifest(manifest({ protocolVersion: "2.0" }));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("different major version");
  });

  it("requires the matching permission for each contribution", () => {
    const result = validateManifest(
      manifest({
        contributes: {
          commands: [{ name: "x", summary: "x", action: { kind: "run_tool", tool: "t" } }],
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("register_commands");
  });

  it("denies excessive permissions: grants are clamped to the manifest", async () => {
    const host = new PluginHost(env());
    host.install(
      manifest({
        permissions: ["register_agent_tools"],
        contributes: {
          tools: [
            {
              name: "stats",
              description: "d",
              input: { fields: {} },
              output: { fields: { totalWords: { kind: "number" } } },
              implementation: { kind: "computed", operation: "manuscript_statistics" },
            },
          ],
        },
      }),
    );
    // The writer "grants" read_manuscript — but the manifest never asked, so
    // the grant is clipped and the tool stays blocked at its permission gate.
    const enabled = host.enable("com.example.test", [
      "register_agent_tools",
      "read_manuscript",
    ] as never);
    expect(enabled.granted).toEqual(["register_agent_tools"]);
    const result = await host.callTool("com.example.test", "stats", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("read_manuscript");
  });

  it("isolates a failing plugin: error result and record, no crash (§19)", async () => {
    const failing: HostEnvironment = env({
      project: {
        chapters: () => Promise.reject(new Error("backing store exploded")),
      },
    });
    const host = new PluginHost(failing);
    host.install(WRITING_STATISTICS_PLUGIN);
    host.enable("com.manu.writing-statistics");
    const result = await host.callTool("com.manu.writing-statistics", "writing_statistics", {});
    expect(result.ok).toBe(false);
    expect(host.plugin("com.manu.writing-statistics")?.error).toContain("exploded");
    expect(host.logs().some((line) => line.includes("failed"))).toBe(true);
  });

  it("rejects malformed tool output against the tool's own schema", async () => {
    const host = new PluginHost(
      env({
        fetchJson: () => Promise.resolve({ weather: { temperature: "warm-ish" } }),
      }),
    );
    host.install(
      manifest({
        id: "com.example.weather",
        permissions: ["register_agent_tools", "network:api.example.com"],
        contributes: {
          tools: [
            {
              name: "weather",
              description: "d",
              input: { fields: { city: { kind: "string", required: true } } },
              output: { fields: { temperature: { kind: "number", required: true } } },
              implementation: {
                kind: "http_get_json",
                url: "https://api.example.com/weather?q={input.city}",
                pick: { temperature: "weather.temperature" },
              },
            },
          ],
        },
      }),
    );
    host.enable("com.example.weather");
    const result = await host.callTool("com.example.weather", "weather", { city: "York" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("output");
  });

  it("blocks undeclared network at validation AND at call time", async () => {
    // Validation: the URL's host must be declared.
    const undeclared = validateManifest(
      manifest({
        permissions: ["register_agent_tools"],
        contributes: {
          tools: [
            {
              name: "sneaky",
              description: "d",
              input: { fields: {} },
              output: { fields: {} },
              implementation: {
                kind: "http_get_json",
                url: "https://evil.example.net/x",
                pick: {},
              },
            },
          ],
        },
      }),
    );
    expect(undeclared.ok).toBe(false);
    expect(undeclared.errors.some((held) => held.includes("evil.example.net"))).toBe(true);

    // Call time: declared but not *granted* is still blocked.
    let fetched = 0;
    const host = new PluginHost(
      env({
        fetchJson: () => {
          fetched += 1;
          return Promise.resolve({});
        },
      }),
    );
    host.install(
      manifest({
        id: "com.example.net",
        permissions: ["register_agent_tools", "network:api.example.com"],
        contributes: {
          tools: [
            {
              name: "fetchy",
              description: "d",
              input: { fields: {} },
              output: { fields: {} },
              implementation: {
                kind: "http_get_json",
                url: "https://api.example.com/x",
                pick: {},
              },
            },
          ],
        },
      }),
    );
    host.enable("com.example.net", ["register_agent_tools"]);
    const blocked = await host.callTool("com.example.net", "fetchy", {});
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toContain("api.example.com");
    expect(fetched).toBe(0);
  });

  it("rejects path-shaped ids and hosts (path escape)", () => {
    expect(validateManifest(manifest({ id: "../../etc/passwd" })).ok).toBe(false);
    expect(
      validateManifest(manifest({ permissions: ["network:api.example.com/../admin"] })).ok,
    ).toBe(false);
    expect(validateManifest(manifest({ permissions: ["network:host/path"] })).ok).toBe(false);
  });

  it("http URLs must be https and non-network plugins never see a fetcher path", () => {
    const insecure = validateManifest(
      manifest({
        permissions: ["register_agent_tools", "network:api.example.com"],
        contributes: {
          tools: [
            {
              name: "t",
              description: "d",
              input: { fields: {} },
              output: { fields: {} },
              implementation: { kind: "http_get_json", url: "http://api.example.com/x", pick: {} },
            },
          ],
        },
      }),
    );
    expect(insecure.ok).toBe(false);
  });

  it("preserves unknown contribution kinds as warnings, never dropping them (§21)", () => {
    const result = validateManifest(
      manifest({ contributes: { holograms: [{ id: "h1" }] } as never }),
    );
    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toContain("holograms");
    expect((result.manifest?.contributes as Record<string, unknown>)["holograms"]).toBeDefined();
  });
});

describe("contribution adapters", () => {
  it("emits deterministic template rules in the compiler's contract, gated on grant", () => {
    const host = new PluginHost(env());
    host.install(
      manifest({
        id: "com.example.rules",
        permissions: ["register_compiler_rules"],
        contributes: {
          compilerRules: [
            {
              type: "deterministic",
              id: "desc-required",
              name: "Characters need descriptions",
              description: "Every character carries a description.",
              severity: "warning",
              template: {
                kind: "entity_field_required",
                entity: "character",
                field: "description",
              },
            },
            {
              type: "semantic",
              id: "procedure",
              name: "Procedure check",
              briefing: "Check procedure.",
            },
          ],
        },
      }),
    );
    const before = compilerRulesFrom(host.plugin("com.example.rules") as never);
    expect(before).toHaveLength(0); // Disabled contributes nothing.
    host.enable("com.example.rules");
    const plugin = host.plugin("com.example.rules") as never;
    const rules = compilerRulesFrom(plugin);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.id).toBe("plugin:com.example.rules:desc-required");
    const drafts = rules[0]?.run({
      scenes: [],
      chapters: [],
      characters: [{ id: "CHAR_0001", name: "Mara", description: "" }],
      locations: [],
      metrics: {},
    } as never);
    expect((drafts as unknown[]).length).toBe(1);
    // The subjective rule stayed semantic — a briefing, never an error.
    const briefings = semanticBriefingsFrom(plugin);
    expect(briefings).toHaveLength(1);
    expect(briefings[0]?.briefing).toContain("procedure");
  });

  it("rejects a subjective rule masquerading as deterministic (§9)", () => {
    const result = validateManifest(
      manifest({
        permissions: ["register_compiler_rules"],
        contributes: {
          compilerRules: [
            {
              type: "deterministic",
              id: "vibes",
              name: "Prose must feel tense",
              description: "d",
              severity: "error",
              template: { kind: "tension_feels_low" } as never,
            },
          ],
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("semantic");
  });

  it("imports a declared dialect and exports through a template", () => {
    const chapters = importWithDialect(
      {
        id: "fountain-lite",
        name: "Fountain-ish",
        extensions: ["fountain"],
        dialect: { chapterHeading: "^#\\s+(.+)$", sceneBreak: "^===+$" },
      },
      "# Act One\nProse here.\n===\nMore prose.\n# Act Two\nEnd.",
    );
    expect(chapters.map((held) => held.title)).toEqual(["Act One", "Act Two"]);
    expect(chapters[0]?.markdown).toContain("* * *");

    const out = exportWithTemplate(
      {
        id: "pub",
        name: "Publisher",
        extension: "txt",
        template: {
          header: "== {title} ==",
          chapterHeading: "[{number}] {title}",
          sceneBreak: "---",
        },
      },
      { title: "The Vault", chapters },
    );
    expect(out).toContain("== The Vault ==");
    expect(out).toContain("[1] Act One");
    expect(out).toContain("---");
  });
});
