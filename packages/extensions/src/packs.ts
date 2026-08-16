import type { CustomAgentDefinition, FlowDefinition } from "@jellytind/agent-builder";
import { manifestDigest, signDigest, type TrustedKey } from "./integrity";
import {
  ECOSYSTEM_VERSION,
  type CatalogueEntry,
  type CataloguePort,
  type ExtensionManifest,
  type ExtensionPackage,
} from "./types";

/**
 * Building packages, and the first-party packs (§12, §13, §17).
 *
 * `buildPackage` is the one way a package comes into being: canonical
 * digest always, signature only when a trusted key does the building. The
 * shipped packs wrap existing capabilities — genre modules, builder
 * definitions — through the extension mechanism without touching the mature
 * built-ins underneath.
 */

export function buildPackage(
  manifest: ExtensionManifest,
  options: { sign?: TrustedKey } = {},
): string {
  const digest = manifestDigest(manifest);
  const pack: ExtensionPackage = {
    format: "manu-extension",
    ecosystem: ECOSYSTEM_VERSION,
    manifest,
    integrity: {
      algorithm: "sha256",
      digest,
      ...(options.sign !== undefined ? { signature: signDigest(digest, options.sign) } : {}),
    },
  };
  return `${JSON.stringify(pack, null, 2)}\n`;
}

// ── The Noir Writing Pack (§17) ──────────────────────────────────────────────

const NOIR_AGENT: CustomAgentDefinition = {
  id: "noir-pack-editor",
  name: "Noir Dialogue Editor",
  purpose: "Tighten dialogue into a hard-boiled register without losing each voice.",
  instructions:
    "Review dialogue for noir register: clipped rhythm, subtext over statement. Propose specific replacements and say why each earns its place.",
  permissions: ["read_manuscript", "read_canon"],
  tools: ["search_project", "read_file", "get_character", "get_chapter"],
  model: { kind: "class", modelClass: "drafting" },
  context: { currentChapter: true, charactersPresent: true, authorVoice: true },
  output: { kind: "proposals" },
  commandAlias: "noir-dialogue",
  scope: "project",
  revision: 1,
  metadata: { author: "Manu", compatibility: { app: "manu", builder: "1.0" } },
};

const NOIR_SKILL: FlowDefinition = {
  id: "noir-pack-pass",
  name: "Noir Dialogue Pass",
  description: "Search a chapter's dialogue, review it in noir register, report.",
  inputs: [{ key: "chapter", label: "Chapter", entityKind: "chapter", required: true }],
  steps: [
    { kind: "search_project", id: "s1", title: "Gather the chapter", query: "{input.chapter}" },
    {
      kind: "run_agent",
      id: "s2",
      title: "Noir review",
      agent: "noir-pack-editor",
      instruction: "Review the dialogue found and note where the register slackens.",
      retry: { maxAttempts: 2 },
    },
    { kind: "generate_report", id: "s3", title: "Report" },
  ],
  output: "report",
  commandAlias: "noir-pass",
  scope: "project",
  revision: 1,
  metadata: { author: "Manu", compatibility: { app: "manu", builder: "1.0" } },
};

export function noirWritingPackManifest(version = "1.0.0"): ExtensionManifest {
  return {
    id: "com.manu.noir-writing-pack",
    name: "Noir Writing Pack",
    author: "Manu",
    version,
    description:
      "A hard-boiled toolkit: a dialogue editor agent, a chapter pass, a tension rule and a starter template.",
    category: "genre_packs",
    compatibility: { app: "manu", ecosystem: ECOSYSTEM_VERSION },
    permissions: ["read_manuscript", "read_entities", "register_compiler_rules"],
    dependencies: [],
    contributions: {
      plugin: {
        id: "com.manu.noir-rules",
        name: "Noir Rules",
        version,
        protocolVersion: "1.0",
        description: "Semantic craft checks for noir prose.",
        permissions: ["register_compiler_rules"],
        contributes: {
          compilerRules: [
            {
              type: "semantic",
              id: "noir-tension",
              name: "Noir tension",
              briefing:
                "Assess whether scenes sustain noir tension: unspoken threat, moral ambiguity, economy of statement. Soft findings only.",
            },
          ],
        },
      },
      agents: [NOIR_AGENT],
      skills: [NOIR_SKILL],
      templates: [
        {
          id: "noir-novel",
          name: "Noir novel",
          description: "A mystery-module project tuned for hard-boiled crime writing.",
          modules: ["mystery"],
        },
      ],
    },
    metadata: { tags: ["noir", "crime", "dialogue"] },
  };
}

/** §12: existing genre modules, packaged — without touching the built-ins. */
function genrePack(id: string, name: string, moduleId: string, blurb: string): ExtensionManifest {
  return {
    id: `com.manu.${id}`,
    name,
    author: "Manu",
    version: "1.0.0",
    description: blurb,
    category: "genre_packs",
    compatibility: { app: "manu", ecosystem: ECOSYSTEM_VERSION },
    permissions: [],
    dependencies: [],
    contributions: { modules: [moduleId] },
  };
}

export const FIRST_PARTY_PACKS: readonly ExtensionManifest[] = [
  noirWritingPackManifest(),
  genrePack("mystery-pack", "Mystery Pack", "mystery", "Clues, deductions and the fairness audit."),
  genrePack("fantasy-pack", "Fantasy Pack", "fantasy", "Magic systems, artefacts and their costs."),
  genrePack("romance-pack", "Romance Pack", "romance", "Attraction arcs and relationship beats."),
];

/**
 * The first-party catalogue (§4): local, static, signed — and shaped exactly
 * like the remote one that can replace it later.
 */
export function staticCatalogue(sign: TrustedKey): CataloguePort {
  const packages = new Map(
    FIRST_PARTY_PACKS.map((manifest) => [manifest.id, buildPackage(manifest, { sign })]),
  );
  const entries: CatalogueEntry[] = FIRST_PARTY_PACKS.map((manifest, index) => ({
    id: manifest.id,
    name: manifest.name,
    author: manifest.author,
    version: manifest.version,
    description: manifest.description,
    category: manifest.category,
    ...(index === 0 ? { featured: true } : {}),
    ...(manifest.metadata !== undefined ? { metadata: manifest.metadata } : {}),
  }));
  return {
    list: () => Promise.resolve(entries),
    fetch: (id) => {
      const held = packages.get(id);
      return held === undefined
        ? Promise.reject(new Error(`No package named "${id}" in the catalogue.`))
        : Promise.resolve(held);
    },
  };
}

/**
 * §13: publish a Studio definition as a distributable community package.
 * Unsigned — labelled so on every inspection — and free of credentials by
 * construction: the definition schemas have nowhere to put one, and the
 * manager's inspection scans the result anyway.
 */
export function publishExtension(input: {
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly version?: string;
  readonly description?: string;
  readonly agents?: readonly CustomAgentDefinition[];
  readonly skills?: readonly FlowDefinition[];
}): string {
  const permissions = new Set<"read_manuscript" | "read_entities">();
  for (const agent of input.agents ?? []) {
    if (agent.permissions.includes("read_manuscript")) permissions.add("read_manuscript");
    if (agent.permissions.includes("read_canon")) permissions.add("read_entities");
  }
  const manifest: ExtensionManifest = {
    id: input.id,
    name: input.name,
    author: input.author,
    version: input.version ?? "1.0.0",
    description: input.description ?? "",
    category: (input.skills ?? []).length > 0 ? "skills" : "agents",
    compatibility: { app: "manu", ecosystem: ECOSYSTEM_VERSION },
    permissions: [...permissions],
    dependencies: [],
    contributions: {
      ...(input.agents !== undefined && input.agents.length > 0 ? { agents: input.agents } : {}),
      ...(input.skills !== undefined && input.skills.length > 0 ? { skills: input.skills } : {}),
    },
  };
  return buildPackage(manifest);
}
