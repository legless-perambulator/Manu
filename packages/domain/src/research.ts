/**
 * Research: a persistent, sourced, project-aware knowledge layer (Phase 35).
 *
 * The one mandatory distinction (§1): **research is not canon.** Manu keeps
 * five kinds of claim apart, and the boundaries are structural, not stylistic:
 *
 * - **Canon fact** — a `Fact`/`WorldRule` entity. True in the story.
 * - **Research fact** — a claim about the real world, held here, with its
 *   source. It says nothing about the story until the writer promotes it.
 * - **Author note** — the writer talking to themselves (notes/, item notes).
 * - **Model inference** — anything a model proposed; always labelled
 *   (`proposedBy: "model"`, provenance `origin: "agent"`), never trusted by
 *   default.
 * - **Unverified idea** — an item still `unreviewed`.
 *
 * Nothing in this file can touch story truth. The only bridge is the explicit
 * canonisation workflow (§15), which runs through the ordinary entity
 * creation paths under the writer's hand.
 */

export const RESEARCH_TYPES = [
  "web",
  "book",
  "article",
  "paper",
  "interview",
  "manual_note",
  "document",
  "image_reference",
  "other",
] as const;
export type ResearchType = (typeof RESEARCH_TYPES)[number];

/**
 * The author's judgement of an item (§4). Nothing external is ever labelled
 * `trusted` automatically — an item arrives `unreviewed` and stays there until
 * a human moves it.
 */
export const RESEARCH_STATUSES = [
  "unreviewed",
  "reviewed",
  "trusted",
  "questionable",
  "archived",
] as const;
export type ResearchStatus = (typeof RESEARCH_STATUSES)[number];

/**
 * Where an item came from and how (§3). Preserved verbatim through
 * summarisation, editing and restarts — provenance is never stripped.
 */
export interface ResearchProvenance {
  readonly origin: "manual" | "agent" | "import";
  /** How the material was obtained: "pasted", "web_search", "model_knowledge", "file_import"… */
  readonly retrievalMethod?: string;
  /** The model that retrieved or summarised it, when one did. */
  readonly modelId?: string;
  /** The research task this item answered, when it answered one. */
  readonly taskId?: string;
}

/**
 * A claim extracted from research (§14). It lives on its item — beside its
 * source — and is **never** converted into a canonical entity automatically.
 * `canonisedAs` records the explicit promotion (§15) when the writer makes
 * one, so the bridge is visible in both directions.
 */
export interface ResearchFact {
  readonly statement: string;
  /** Who proposed it. Model proposals stay labelled forever. */
  readonly proposedBy: "author" | "model";
  readonly confidence?: number;
  /**
   * Another research item whose account differs (§16). Conflicting sources
   * are kept side by side, never merged; deciding between them is authorship.
   */
  readonly conflictsWithItemId?: string;
  readonly note?: string;
  /** The entity this fact was explicitly promoted into, when it was. */
  readonly canonisedAs?: string;
}

export interface ResearchItem {
  /** `RES_0001` — minted by the store; not an entity in the canon registry. */
  readonly id: string;
  readonly title: string;
  readonly type: ResearchType;
  readonly status: ResearchStatus;
  /** The working distillation. Never the only surviving representation (§13). */
  readonly summary?: string;
  /** Source material or extract, kept beside the summary (§13). */
  readonly content?: string;
  readonly sourceUrl?: string;
  readonly sourceTitle?: string;
  readonly sourceAuthor?: string;
  readonly publishedAt?: string;
  readonly accessedAt?: string;
  readonly tags: readonly string[];
  /** Story entities this research bears on (characters, objects, rules…). */
  readonly linkedEntityIds: readonly string[];
  readonly linkedSceneIds: readonly string[];
  /** The writer's own words about the item — an author note, kept apart. */
  readonly notes?: string;
  readonly facts: readonly ResearchFact[];
  /** Always included in compiled context for its linked material (§12). */
  readonly pinned?: boolean;
  readonly provenance: ResearchProvenance;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const RESEARCH_TASK_STATUSES = [
  "pending",
  "researching",
  "awaiting_review",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ResearchTaskStatus = (typeof RESEARCH_TASK_STATUSES)[number];

/** What part of the project a question is about — and all the agent may see (§24). */
export interface ResearchScope {
  readonly sceneId?: string;
  readonly chapterId?: string;
  readonly entityIds?: readonly string[];
  readonly note?: string;
}

/** A persistent research question (§17). Findings are research items. */
export interface ResearchTask {
  /** `RTASK_0001`. */
  readonly id: string;
  readonly question: string;
  readonly scope?: ResearchScope;
  readonly status: ResearchTaskStatus;
  readonly findingItemIds: readonly string[];
  readonly failureReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── Placeholders (§19, §21) ─────────────────────────────────────────────────

/**
 * The inline research gap: `[RESEARCH: how long a 1990s landline trace takes]`.
 * Explicitly not prose — anything that finds one knows the passage is
 * unfinished, and the research skill collects them into tasks.
 */
export const RESEARCH_PLACEHOLDER_PATTERN = /\[RESEARCH:\s*([^\]]+)\]/g;

export interface ResearchGap {
  readonly question: string;
  /** Character offset in the text it was found in. */
  readonly index: number;
}

export function findResearchPlaceholders(text: string): ResearchGap[] {
  const out: ResearchGap[] = [];
  for (const match of text.matchAll(RESEARCH_PLACEHOLDER_PATTERN)) {
    const question = (match[1] ?? "").trim();
    if (question !== "") out.push({ question, index: match.index });
  }
  return out;
}

/** An empty manual item, for the library's "New research" (§5). */
export function emptyResearchItem(title: string, now: string): Omit<ResearchItem, "id"> {
  return {
    title,
    type: "manual_note",
    status: "unreviewed",
    tags: [],
    linkedEntityIds: [],
    linkedSceneIds: [],
    facts: [],
    provenance: { origin: "manual", retrievalMethod: "written" },
    createdAt: now,
    updatedAt: now,
  };
}
