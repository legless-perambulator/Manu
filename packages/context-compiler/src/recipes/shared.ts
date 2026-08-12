import type {
  Chapter,
  Character,
  Location,
  PlotThread,
  Relationship,
  Scene,
  WorldRule,
} from "@jellytind/domain";
import { PRIORITY, type Candidate } from "../candidate";
import type { ProjectReader } from "../reader";
import {
  renderCharacter,
  renderLocation,
  renderPlotThread,
  renderScene,
  renderWorldRule,
  stripFrontmatter,
  summariseCharacter,
  summariseLocation,
  summarisePlotThread,
  summariseScene,
  summariseWorldRule,
} from "../render";
import type { Provenance, SelectionRule } from "../types";

/** Everything a recipe reads, fetched once per compile. */
export interface ProjectSnapshot {
  readonly chapters: Chapter[];
  readonly scenes: Scene[];
  readonly characters: Character[];
  readonly locations: Location[];
  readonly plotThreads: PlotThread[];
  readonly worldRules: WorldRule[];
  readonly relationships: Relationship[];
}

export async function readSnapshot(reader: ProjectReader): Promise<ProjectSnapshot> {
  const [chapters, scenes, characters, locations, plotThreads, worldRules, relationships] =
    await Promise.all([
      reader.listChapters(),
      reader.listScenes(),
      reader.listCharacters(),
      reader.listLocations(),
      reader.listPlotThreads(),
      reader.listWorldRules(),
      reader.listRelationships(),
    ]);
  return { chapters, scenes, characters, locations, plotThreads, worldRules, relationships };
}

export const byId = <T extends { id: string }>(items: readonly T[], id: string): T | undefined =>
  items.find((item) => item.id === id);

export const provenance = (
  rule: SelectionRule,
  reason: string,
  via?: readonly string[],
): Provenance => ({ rule, reason, ...(via !== undefined ? { via } : {}) });

// ── Candidate builders, shared by recipes ───────────────────────────────────

export function sceneCandidate(
  scene: Scene,
  section: "target" | "adjacentScenes",
  priority: number,
  prov: Provenance,
): Candidate {
  return {
    id: scene.id,
    kind: "scene",
    label: scene.title,
    section,
    priority,
    provenance: prov,
    full: renderScene(scene),
    summary: summariseScene(scene),
    ...(section === "target" ? { required: true } : {}),
  };
}

export function characterCandidate(
  character: Character,
  relationships: readonly Relationship[],
  priority: number,
  prov: Provenance,
): Candidate {
  return {
    id: character.id,
    kind: "character",
    label: character.name,
    section: "characters",
    priority,
    provenance: prov,
    full: renderCharacter(
      character,
      relationships.filter(
        (r) => r.characterAId === character.id || r.characterBId === character.id,
      ),
    ),
    summary: summariseCharacter(character),
  };
}

export function locationCandidate(
  location: Location,
  priority: number,
  prov: Provenance,
): Candidate {
  return {
    id: location.id,
    kind: "location",
    label: location.name,
    section: "locations",
    priority,
    provenance: prov,
    full: renderLocation(location),
    summary: summariseLocation(location),
  };
}

export function plotThreadCandidate(
  thread: PlotThread,
  priority: number,
  prov: Provenance,
): Candidate {
  return {
    id: thread.id,
    kind: "plot_thread",
    label: thread.name,
    section: "plotThreads",
    priority,
    provenance: prov,
    full: renderPlotThread(thread),
    summary: summarisePlotThread(thread),
  };
}

/**
 * World rules that constrain any work on the story.
 *
 * `hard` rules are included ahead of `soft` and `style` ones: breaking a hard
 * rule is a continuity error, so it earns its tokens first.
 */
export function worldRuleCandidates(rules: readonly WorldRule[], targetId: string): Candidate[] {
  const rank = { hard: 0, soft: 1, style: 2 } as const;
  return [...rules]
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.id.localeCompare(b.id))
    .map((rule) => ({
      id: rule.id,
      kind: "world_rule",
      label: rule.name,
      section: "worldRules" as const,
      priority: PRIORITY.rules + rank[rule.severity],
      provenance: provenance(
        "world_rule",
        `${rule.severity} world rule governing "${rule.scope}", which constrains work on ${targetId}`,
        [targetId],
      ),
      full: renderWorldRule(rule),
      summary: summariseWorldRule(rule),
    }));
}

/** Chapter prose, front-matter stripped, as the primary text. */
export async function proseCandidate(
  reader: ProjectReader,
  chapter: Chapter,
  prov: Provenance,
): Promise<Candidate | null> {
  const raw = await reader.readProjectFile(chapter.filePath);
  if (raw === null) return null;
  const prose = stripFrontmatter(raw).trim();
  if (prose === "") return null;
  return {
    id: chapter.filePath,
    kind: "file",
    label: `${chapter.title} (prose)`,
    section: "primaryText",
    priority: PRIORITY.primary,
    provenance: prov,
    full: prose,
  };
}
