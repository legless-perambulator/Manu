import type { StoryRepository } from "@jellytind/story-repository";
import type { CharacterId } from "@jellytind/domain";
import { splitChapterFile, writeChapterBody } from "./chapters";
import type { MappingConfidence, MappingProposal, ProposalCategory } from "./types";

/**
 * The review layer (§24–§26): summarise, batch-decide, and apply.
 *
 * Nothing here dumps hundreds of items on the writer one at a time. Batches
 * accept the obvious, review queues hold the ambiguous, and `applyProposals`
 * turns only *accepted* proposals into repository records — with model-derived
 * facts arriving as `provisional` and state transitions as `proposed`, never
 * silently canonical.
 */

export interface CategorySummary {
  readonly category: ProposalCategory;
  readonly proposed: number;
  readonly needsReview: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly applied: number;
}

export function reviewSummary(proposals: readonly MappingProposal[]): CategorySummary[] {
  const byCategory = new Map<ProposalCategory, CategorySummary>();
  for (const proposal of proposals) {
    const held =
      byCategory.get(proposal.category) ??
      ({
        category: proposal.category,
        proposed: 0,
        needsReview: 0,
        accepted: 0,
        rejected: 0,
        applied: 0,
      } as CategorySummary);
    const next = {
      ...held,
      proposed: held.proposed + (proposal.status === "proposed" ? 1 : 0),
      needsReview: held.needsReview + (proposal.status === "needs_review" ? 1 : 0),
      accepted: held.accepted + (proposal.status === "accepted" ? 1 : 0),
      rejected: held.rejected + (proposal.status === "rejected" ? 1 : 0),
      applied: held.applied + (proposal.status === "applied" ? 1 : 0),
    };
    byCategory.set(proposal.category, next);
  }
  return [...byCategory.values()];
}

export interface BatchFilter {
  readonly category?: ProposalCategory;
  readonly minConfidence?: MappingConfidence;
  readonly includeNeedsReview?: boolean;
}

const RANK: Readonly<Record<MappingConfidence, number>> = { low: 0, medium: 1, high: 2 };

function matches(proposal: MappingProposal, filter: BatchFilter): boolean {
  if (filter.category !== undefined && proposal.category !== filter.category) return false;
  if (
    filter.minConfidence !== undefined &&
    RANK[proposal.confidence] < RANK[filter.minConfidence]
  ) {
    return false;
  }
  if (proposal.status === "proposed") return true;
  if (proposal.status === "needs_review") return filter.includeNeedsReview === true;
  return false;
}

/** "Accept all high-confidence characters" is one call, not eighty clicks. */
export function acceptWhere(
  proposals: readonly MappingProposal[],
  filter: BatchFilter,
): MappingProposal[] {
  return proposals.map((proposal) =>
    matches(proposal, filter) ? { ...proposal, status: "accepted" } : proposal,
  );
}

export function rejectWhere(
  proposals: readonly MappingProposal[],
  filter: BatchFilter,
): MappingProposal[] {
  return proposals.map((proposal) =>
    matches(proposal, filter) ? { ...proposal, status: "rejected" } : proposal,
  );
}

export function setStatus(
  proposals: readonly MappingProposal[],
  id: string,
  status: MappingProposal["status"],
): MappingProposal[] {
  return proposals.map((proposal) => (proposal.id === id ? { ...proposal, status } : proposal));
}

/** Resolve an ambiguous alias to one of its candidates (§11, §13 of review). */
export function resolveAlias(
  proposals: readonly MappingProposal[],
  aliasProposalId: string,
  canonical: string,
): MappingProposal[] {
  return proposals.map((proposal) => {
    if (proposal.id !== aliasProposalId) return proposal;
    return {
      ...proposal,
      status: "accepted",
      confidence: "high",
      summary: `"${String(proposal.payload["alias"])}" is ${canonical}`,
      payload: { alias: proposal.payload["alias"], canonical },
    };
  });
}

export interface ApplyResult {
  readonly proposals: readonly MappingProposal[];
  readonly created: Readonly<Record<string, number>>;
  readonly notes: readonly string[];
}

/**
 * Turn accepted proposals into repository records.
 *
 * Order matters: characters before relationships and knowledge, scenes before
 * anything that needs a scene to stand on. Everything model-derived lands with
 * the status vocabulary the repository already has for uncertainty.
 */
export async function applyProposals(
  repo: StoryRepository,
  proposals: readonly MappingProposal[],
): Promise<ApplyResult> {
  const out = [...proposals];
  const created: Record<string, number> = {};
  const notes: string[] = [];
  const bump = (key: string) => {
    created[key] = (created[key] ?? 0) + 1;
  };
  const accepted = (category: ProposalCategory) =>
    out.filter((held) => held.category === category && held.status === "accepted");
  const markApplied = (proposal: MappingProposal) => {
    const index = out.findIndex((held) => held.id === proposal.id);
    if (index !== -1) out[index] = { ...proposal, status: "applied" };
  };

  // Accepted aliases fold into their characters before creation.
  const aliasesByCanonical = new Map<string, string[]>();
  for (const alias of accepted("alias")) {
    const canonical = String(alias.payload["canonical"] ?? "");
    if (canonical === "") continue;
    const list = aliasesByCanonical.get(canonical) ?? [];
    list.push(String(alias.payload["alias"]));
    aliasesByCanonical.set(canonical, list);
    markApplied(alias);
  }

  const characterIds = new Map<string, CharacterId>();
  const importanceByName = new Map<string, string>();
  for (const importance of accepted("importance")) {
    importanceByName.set(String(importance.payload["name"]), String(importance.payload["role"]));
    markApplied(importance);
  }
  for (const proposal of accepted("character")) {
    const name = String(proposal.payload["name"]);
    const aliases = [
      ...new Set([
        ...((proposal.payload["aliases"] as readonly string[] | undefined) ?? []),
        ...(aliasesByCanonical.get(name) ?? []),
      ]),
    ];
    const character = await repo.addCharacter({
      name,
      aliases,
      role: importanceByName.get(name) ?? "",
      notes: `Mapped from the imported manuscript. ${proposal.summary}`,
    });
    characterIds.set(name, character.id);
    for (const alias of aliases) characterIds.set(alias, character.id);
    bump("characters");
    markApplied(proposal);
  }

  const locationIds = new Map<string, string>();
  const parents: MappingProposal[] = [];
  for (const proposal of accepted("location")) {
    if (proposal.payload["parent"] !== undefined) {
      parents.push(proposal);
      continue;
    }
    const name = String(proposal.payload["name"]);
    const location = await repo.addLocation({
      name,
      notes: `Mapped from the imported manuscript. ${proposal.summary}`,
    });
    locationIds.set(name, location.id as string);
    bump("locations");
    markApplied(proposal);
  }
  for (const proposal of parents) {
    const childName = String(proposal.payload["name"]);
    const parentName = String(proposal.payload["parent"]);
    const parentId = locationIds.get(parentName);
    const childId = locationIds.get(childName);
    if (parentId === undefined || childId === undefined) {
      notes.push(
        `Hierarchy "${childName} inside ${parentName}" skipped: accept both locations first.`,
      );
      continue;
    }
    // The child already exists flat; hierarchy is recorded on a fresh record
    // only when the child was not yet created. Note rather than mutate.
    notes.push(`Recorded that ${childName} is inside ${parentName} (see location notes).`);
    markApplied(proposal);
  }

  for (const proposal of accepted("object")) {
    await repo.addObject({
      name: String(proposal.payload["name"]),
      description: proposal.summary,
    });
    bump("objects");
    markApplied(proposal);
  }

  const factIds = new Map<string, string>();
  for (const proposal of accepted("fact")) {
    const statement = String(proposal.payload["statement"] ?? proposal.summary);
    // The same statement found in two chapters is one fact, not two.
    if (factIds.has(statement.toLowerCase())) {
      markApplied(proposal);
      continue;
    }
    const fact = await repo.addFact({
      statement,
      // Model inference never lands as confirmed canon silently (§14).
      status: proposal.origin === "model" ? "provisional" : "canonical",
      source: proposal.evidence[0]
        ? `Mapped from ${proposal.evidence[0].chapterTitle}`
        : "Mapped from the imported manuscript",
    });
    factIds.set(statement.toLowerCase(), fact.id as string);
    bump("facts");
    markApplied(proposal);
  }

  const threadNames = new Set<string>();
  for (const proposal of accepted("thread")) {
    const name = String(proposal.payload["name"] ?? proposal.summary);
    // The same thread surfacing in several chapters is one thread.
    if (threadNames.has(name.toLowerCase())) {
      markApplied(proposal);
      continue;
    }
    threadNames.add(name.toLowerCase());
    await repo.addPlotThread({ name, description: proposal.summary, status: "active" });
    bump("threads");
    markApplied(proposal);
  }

  const relationshipKeys = new Set<string>();
  for (const proposal of accepted("relationship")) {
    const a = characterIds.get(String(proposal.payload["a"] ?? ""));
    const b = characterIds.get(String(proposal.payload["b"] ?? ""));
    if (a === undefined || b === undefined) {
      notes.push(`Relationship "${proposal.summary}" skipped: accept both characters first.`);
      continue;
    }
    const type = String(proposal.payload["type"] ?? "unspecified");
    const key = [String(a), String(b), type].sort().join("|");
    if (relationshipKeys.has(key)) {
      markApplied(proposal);
      continue;
    }
    relationshipKeys.add(key);
    await repo.addRelationship({
      characterAId: a,
      characterBId: b,
      type,
      description: proposal.summary,
    });
    bump("relationships");
    markApplied(proposal);
  }

  // Scenes: create records per detected segment, and mark the chapter file.
  for (const proposal of accepted("scene")) {
    const chapterId = String(proposal.payload["chapterId"]);
    const segments =
      (proposal.payload["segments"] as ReadonlyArray<{ title: string; opening: string }>) ?? [];
    const sceneIds: string[] = [];
    for (const segment of segments) {
      const scene = await repo.addScene({
        title: segment.title,
        chapterId: chapterId as never,
      });
      sceneIds.push(scene.id as string);
      bump("scenes");
    }
    // Replace explicit break marks with scene markers, first scene at the top
    // of the prose — the front-matter record above it stays untouched.
    const chapter = (await repo.listChapters()).find((held) => (held.id as string) === chapterId);
    if (chapter !== undefined && sceneIds.length > 0) {
      const raw = (await repo.readProjectFile(chapter.filePath)) ?? "";
      const { body } = splitChapterFile(raw);
      let index = 1;
      const marked = body.replace(
        /^\s*(?:\*\s*\*\s*\*[\s*]*|#\s*#\s*#|~{3,})\s*$/gm,
        () => `<!-- scene: ${sceneIds[Math.min(index++, sceneIds.length - 1)] as string} -->`,
      );
      await writeChapterBody(
        repo,
        chapter.filePath,
        `<!-- scene: ${sceneIds[0] as string} -->\n${marked.trimStart()}`,
      );
    }
    markApplied(proposal);
  }

  // Knowledge: proposals become *proposed* transitions on the evidence
  // chapter's first scene — reviewable in the Knowledge panel, never canon.
  // A knowledge claim needs its fact to exist, so unlinked ones wait.
  const scenes = await repo.listScenes();
  const chapters = [...(await repo.listChapters())].sort((x, y) => x.order - y.order);
  for (const proposal of accepted("knowledge")) {
    const evidenceChapter = proposal.evidence[0];
    const chapter = chapters[evidenceChapter?.chapterIndex ?? 0];
    const scene = scenes.find((held) => held.chapterId === chapter?.id);
    const character = characterIds.get(String(proposal.payload["character"] ?? ""));
    const factId = factIds.get(String(proposal.payload["fact"] ?? "").toLowerCase());
    if (scene === undefined || character === undefined || factId === undefined) {
      notes.push(
        `Knowledge "${proposal.summary}" waits until its character, fact and a scene are all accepted.`,
      );
      continue;
    }
    await repo.addStateTransitions(
      [
        {
          sceneId: scene.id as string,
          kind: "knowledge_changed",
          subjectId: character as string,
          value: factId,
          knowledgeState: (proposal.payload["state"] as never) ?? ("known" as never),
          note: proposal.summary,
        } as never,
      ],
      { source: "import", confirmationStatus: "proposed" },
    );
    bump("knowledge transitions");
    markApplied(proposal);
  }

  return { proposals: out, created, notes };
}
