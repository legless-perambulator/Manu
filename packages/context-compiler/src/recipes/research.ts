import type { ResearchItem } from "@jellytind/domain";
import { PRIORITY, type Candidate } from "../candidate";
import type { ProjectReader } from "../reader";
import { provenance } from "./shared";

/**
 * Research as an explicit context source (docs/RESEARCH.md, Phase 35 §12).
 *
 * Never the whole library: an item is proposed only when it is **pinned**, or
 * **linked** to the target scene or to an entity the target involves — and the
 * provenance says which, so the inspector can answer "why is this here" the
 * way it does for everything else. Archived items never travel.
 *
 * The rendering keeps the source visible (§3, §13): a summary without its
 * citation is exactly the provenance-stripping this subsystem exists to
 * prevent. Research text is clearly labelled as real-world reference — it is
 * information *for* the writing, never story truth.
 */
export async function researchCandidates(
  reader: ProjectReader,
  options: {
    /** The scene(s) the operation is about. */
    readonly sceneIds: readonly string[];
    /** Entities the target involves (characters, location, objects, threads). */
    readonly entityIds: readonly string[];
    /** The id the provenance chain leads back to. */
    readonly targetId: string;
  },
): Promise<Candidate[]> {
  if (reader.listResearchItems === undefined) return [];
  const items = await reader.listResearchItems();
  const scenes = new Set(options.sceneIds);
  const entities = new Set(options.entityIds);

  const out: Candidate[] = [];
  for (const item of items) {
    if (item.status === "archived") continue;
    const linkedScene = item.linkedSceneIds.find((id) => scenes.has(id));
    const linkedEntity = item.linkedEntityIds.find((id) => entities.has(id));
    let reason: string;
    let rule: "pinned" | "linked_research";
    if (item.pinned === true) {
      rule = "pinned";
      reason = `pinned research, included for every operation`;
    } else if (linkedScene !== undefined) {
      rule = "linked_research";
      reason = `research linked to ${linkedScene}`;
    } else if (linkedEntity !== undefined) {
      rule = "linked_research";
      reason = `research linked to ${linkedEntity}`;
    } else {
      continue;
    }
    out.push({
      id: item.id,
      kind: "research",
      label: item.title,
      section: "research",
      priority: PRIORITY.retrieved,
      provenance: provenance(rule, reason, [options.targetId, item.id]),
      full: renderResearch(item, "full"),
      summary: renderResearch(item, "summary"),
    });
  }
  return out;
}

function renderResearch(item: ResearchItem, form: "full" | "summary"): string {
  const lines: string[] = [
    `Real-world research (not story canon), status: ${item.status}.`,
    `# ${item.title}`,
  ];
  if (item.summary !== undefined && item.summary !== "") lines.push(item.summary);
  if (form === "full" && item.content !== undefined && item.content !== "") {
    lines.push("", item.content);
  }
  const trusted = item.facts.filter((fact) => fact.canonisedAs === undefined);
  if (form === "full" && trusted.length > 0) {
    lines.push("", ...trusted.map((fact) => `- ${fact.statement}`));
  }
  const source = [item.sourceTitle, item.sourceAuthor, item.sourceUrl]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(" — ");
  if (source !== "") lines.push("", `Source: ${source}`);
  return lines.join("\n");
}
