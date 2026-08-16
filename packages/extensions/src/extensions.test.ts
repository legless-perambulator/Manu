import { describe, expect, it } from "vitest";
import { SPECIALIST_IDS } from "@jellytind/agent-runtime";
import {
  CORE_CATALOG,
  FlowRunner,
  testAgent,
  type ValidationContext,
} from "@jellytind/agent-builder";
import { manifestDigest, sha256Hex, verifyIntegrity, type TrustedKey } from "./integrity";
import { ExtensionManager, compareVersions } from "./manager";
import {
  FIRST_PARTY_PACKS,
  buildPackage,
  noirWritingPackManifest,
  publishExtension,
  staticCatalogue,
} from "./packs";
import type { ExtensionPackage, FileStorePort } from "./types";

/** Phase 45: discover, inspect, safely install, update and remove. */

function memoryFiles(): FileStorePort & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    readProjectFile: (path) => Promise.resolve(map.get(path) ?? null),
    writeProjectFile: (path, contents) => {
      map.set(path, contents);
      return Promise.resolve();
    },
    listProjectFiles: (prefix) =>
      Promise.resolve(
        [...map.keys()].filter((path) => prefix === undefined || path.startsWith(prefix)),
      ),
  };
}

const KEY: TrustedKey = { keyId: "manu-first-party-2026", secret: "test-signing-secret" };

const VALIDATION: ValidationContext = {
  catalog: CORE_CATALOG,
  availableModels: ["local-model"],
  availableAgents: [...SPECIALIST_IDS],
};

async function manager(files: FileStorePort = memoryFiles()): Promise<ExtensionManager> {
  return ExtensionManager.open(files, {
    trustedKeys: [KEY],
    validation: VALIDATION,
    now: () => "2026-08-16T12:00:00.000Z",
  });
}

describe("integrity foundation (§3)", () => {
  it("computes standard SHA-256", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("labels trusted, unsigned and tampered packages honestly", () => {
    const manifest = noirWritingPackManifest();
    const signed = JSON.parse(buildPackage(manifest, { sign: KEY })) as ExtensionPackage;
    expect(verifyIntegrity(manifest, signed.integrity, [KEY]).trust).toBe("trusted");

    const unsigned = JSON.parse(buildPackage(manifest)) as ExtensionPackage;
    const verdict = verifyIntegrity(manifest, unsigned.integrity, [KEY]);
    expect(verdict.trust).toBe("unsigned");
    expect(verdict.reason).toContain("authorship unverified");

    const tampered = { ...manifest, description: "Totally harmless." };
    expect(verifyIntegrity(tampered, signed.integrity, [KEY]).trust).toBe("invalid");
    expect(manifestDigest(tampered)).not.toBe(signed.integrity.digest);

    const badSignature = {
      ...signed.integrity,
      signature: { keyId: KEY.keyId, value: "0".repeat(64) },
    };
    expect(verifyIntegrity(manifest, badSignature, [KEY]).trust).toBe("invalid");
  });
});

describe("inspection before anything installs (§5, §14)", () => {
  it("shows description, author, version, permissions and what it adds", async () => {
    const held = await manager();
    const details = held.inspect(buildPackage(noirWritingPackManifest(), { sign: KEY }));
    expect(details.problems).toEqual([]);
    expect(details.trust).toBe("trusted");
    expect(details.manifest.author).toBe("Manu");
    expect(details.manifest.permissions).toContain("register_compiler_rules");
    expect(details.adds).toEqual([
      "Plugin — Noir Rules",
      "Agent — Noir Dialogue Editor",
      "Skill — Noir Dialogue Pass (/noir-pass)",
      "Project template — Noir novel",
    ]);
  });

  it("rejects malformed, credential-bearing and alien packages", async () => {
    const held = await manager();
    expect(() => held.inspect("not json")).toThrow(/valid extension/);
    expect(() => held.inspect('{"format":"zip-bomb"}')).toThrow(/not a Manu extension/);
    expect(() => held.inspect('{"format":"manu-extension","apiKey":"x"}')).toThrow(/credential/);
    const wrongEra = {
      ...noirWritingPackManifest(),
      compatibility: { app: "manu" as const, ecosystem: "2.0" },
    };
    const details = held.inspect(buildPackage(wrongEra));
    expect(details.problems.some((p) => p.includes("ecosystem"))).toBe(true);
  });
});

describe("install, dependencies and approval (§6, §9, §10)", () => {
  it("refuses to install without approval, then installs with it", async () => {
    const held = await manager();
    const raw = buildPackage(noirWritingPackManifest(), { sign: KEY });
    await expect(held.install(raw)).rejects.toThrow(/Review and approve/);
    const installed = await held.install(raw, { approve: true });
    expect(installed.enabled).toBe(true);
    expect(installed.trust).toBe("trusted");
  });

  it("detects missing dependencies and self-cycles", async () => {
    const held = await manager();
    const dependent = {
      ...noirWritingPackManifest(),
      id: "com.example.needy",
      dependencies: [{ id: "com.example.base" }],
    };
    await expect(held.install(buildPackage(dependent), { approve: true })).rejects.toThrow(
      /is not installed/,
    );
    const selfish = {
      ...noirWritingPackManifest(),
      id: "com.example.selfish",
      dependencies: [{ id: "com.example.selfish" }],
    };
    await expect(held.install(buildPackage(selfish), { approve: true })).rejects.toThrow(
      /not installed|depend on itself/,
    );
  });

  it("identifies a project's missing extensions without auto-installing", async () => {
    const held = await manager();
    await held.declareProjectNeeds({
      required: [{ id: "com.manu.noir-writing-pack" }],
      recommended: [{ id: "com.manu.mystery-pack" }],
    });
    const before = await held.missing();
    expect(before.required).toEqual(["com.manu.noir-writing-pack"]);
    expect(before.recommended).toEqual(["com.manu.mystery-pack"]);
    await held.install(buildPackage(noirWritingPackManifest(), { sign: KEY }), { approve: true });
    expect((await held.missing()).required).toEqual([]);
  });
});

describe("catalogue (§4, §16)", () => {
  it("lists first-party packs by category, featured first-party pack included", async () => {
    const catalogue = staticCatalogue(KEY);
    const entries = await catalogue.list();
    expect(entries.length).toBe(FIRST_PARTY_PACKS.length);
    expect(entries.some((entry) => entry.featured === true)).toBe(true);
    const held = await manager();
    expect((await held.available(catalogue)).length).toBe(entries.length);
  });

  it("a failing catalogue never takes the installed world down", async () => {
    const held = await manager();
    await held.install(buildPackage(noirWritingPackManifest(), { sign: KEY }), { approve: true });
    const broken = {
      list: () => Promise.reject(new Error("offline")),
      fetch: () => Promise.reject(new Error("offline")),
    };
    expect(await held.available(broken)).toEqual([]);
    expect(await held.updates(broken)).toEqual([]);
    expect((await held.installed()).length).toBe(1); // still working offline
  });
});

describe("publish from the Studio (§13)", () => {
  it("produces an unsigned, credential-free, installable package", async () => {
    const noir = noirWritingPackManifest();
    const raw = publishExtension({
      id: "com.writer.my-editor",
      name: "My Editor",
      author: "A. Writer",
      agents: noir.contributions.agents ?? [],
    });
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]/);
    const held = await manager();
    const details = held.inspect(raw);
    expect(details.trust).toBe("unsigned");
    expect(details.warnings.some((w) => w.includes("authorship unverified"))).toBe(true);
    await held.install(raw, { approve: true });
    expect((await held.get("com.writer.my-editor"))?.enabled).toBe(true);
  });
});

describe("§17 — the Noir Writing Pack, end to end", () => {
  it("validates, installs with permissions, contributes, runs, updates, rolls back and uninstalls cleanly", async () => {
    const files = memoryFiles();
    const held = await manager(files);
    const v1 = buildPackage(noirWritingPackManifest("1.0.0"), { sign: KEY });

    // 1. The package validates.
    const details = held.inspect(v1);
    expect(details.problems).toEqual([]);

    // 2. Install displays permissions — refusing until they are approved.
    await expect(held.install(v1)).rejects.toThrow(/read_manuscript/);
    await held.install(v1, { approve: true });

    // 3. The contributions appear.
    const contributions = await held.contributions();
    expect(contributions.plugins[0]?.name).toBe("Noir Rules");
    expect(contributions.agents[0]?.name).toBe("Noir Dialogue Editor");
    expect(contributions.skills[0]?.commandAlias).toBe("noir-pass");
    expect(contributions.templates[0]?.name).toBe("Noir novel");

    // 4–5. The skill and the agent execute — real runner, real sandbox.
    const agent = contributions.agents[0];
    const skill = contributions.skills[0];
    if (agent === undefined || skill === undefined) throw new Error("missing contributions");
    const invoker = {
      invoke: (request: { instruction: string }) =>
        Promise.resolve({ notes: [`noir: ${request.instruction.slice(0, 20)}`] }),
    };
    const runner = new FlowRunner({
      files,
      invoker,
      resolveAgent: (id) => (id === agent.id ? agent : null),
      searchProject: () => Promise.resolve(["“We should go,” she said sadly."]),
      runStoryBuild: () => Promise.resolve({ errors: 0, warnings: 0, lines: [] }),
    });
    const run = await runner.start(skill, { chapter: "Chapter Three" });
    expect(run.status).toBe("finished");
    expect(run.report?.lines.some((line) => line.startsWith("noir:"))).toBe(true);

    const sandbox = await testAgent(agent, {
      project: { chapters: () => Promise.resolve([{ title: "Ch 3", text: "“We should go.”" }]) },
      invoker,
    });
    expect(sandbox.notes).toHaveLength(1);

    // 6. Disable removes the contributions.
    await held.setEnabled("com.manu.noir-writing-pack", false);
    expect((await held.contributions()).agents).toHaveLength(0);
    await held.setEnabled("com.manu.noir-writing-pack", true);

    // 7. A versioned update works — and one that adds permissions demands
    //    renewed approval naming exactly the additions.
    const v11 = buildPackage(noirWritingPackManifest("1.1.0"), { sign: KEY });
    await held.update(v11, { approve: true });
    expect((await held.get("com.manu.noir-writing-pack"))?.manifest.version).toBe("1.1.0");

    const widened = {
      ...noirWritingPackManifest("1.2.0"),
      permissions: [...noirWritingPackManifest().permissions, "network:api.example.com" as const],
    };
    await expect(held.update(buildPackage(widened, { sign: KEY }))).rejects.toThrow(
      /adds permissions: network:api.example.com/,
    );

    // 8. Rollback restores the preserved previous version.
    const rolled = await held.rollback("com.manu.noir-writing-pack");
    expect(rolled.manifest.version).toBe("1.0.0");

    // 9. Uninstall deregisters everything and touches nothing else in the
    //    project: only .writer/extensions entries change, and the package is
    //    renamed rather than destroyed.
    const projectFile = ".writer/notes/precious.md";
    files.map.set(projectFile, "The writer's own notes.");
    await held.remove("com.manu.noir-writing-pack");
    expect((await held.contributions()).agents).toHaveLength(0);
    expect(files.map.get(projectFile)).toBe("The writer's own notes.");
    expect(files.map.get(".writer/extensions/com.manu.noir-writing-pack.json.removed")).toContain(
      "Noir Writing Pack",
    );

    // Restart: a fresh manager over the same files sees the same world.
    const reopened = await manager(files);
    expect(await reopened.get("com.manu.noir-writing-pack")).toBeNull();
  });

  it("update refuses a version that is not newer", async () => {
    const held = await manager();
    const v1 = buildPackage(noirWritingPackManifest("1.0.0"), { sign: KEY });
    await held.install(v1, { approve: true });
    await expect(held.update(v1, { approve: true })).rejects.toThrow(/not newer/);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
  });
});
