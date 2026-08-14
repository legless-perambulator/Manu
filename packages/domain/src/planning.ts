/**
 * The knowledge states a plan may target. The same closed set the story-state
 * engine enforces at transition time; repeated here because domain sits below
 * story-state in the layering and these literals are part of the on-disk
 * contract in both places.
 */
export type PlannedKnowledgeState = "known" | "believed" | "suspected" | "disbelieved" | "unknown";

/**
 * Planning: the intermediate representation between an outline and prose.
 *
 * A chapter plan is what Manu works from so it never has to improvise the
 * shape of a chapter while simultaneously drafting it (Phase 32). It sits
 * between narrative intention and the Chapter Builder:
 *
 * ```
 * outline / intention → ChapterPlan → PlannedScene[] → Chapter Builder
 * ```
 *
 * Three properties matter more than any field:
 *
 * - **A plan is a proposal, never canon.** Approving one materialises scene
 *   records through the ordinary mutation path; until then nothing in the
 *   project depends on it (AGENTS.md — "Canon vs Inference").
 * - **Progressive structure.** Almost every field is optional. A "quick plan"
 *   of POV, goal, conflict and outcome is a complete plan; the deep fields are
 *   for the writers who want them, and no machinery requires them (§11–12).
 * - **Versioned in place.** Every save bumps `version` and keeps a bounded
 *   snapshot, so v3 can be compared with v4 without inventing branch semantics
 *   for plans (§16). The file itself is journaled like any project file.
 */

export const PLAN_STATUSES = [
  /** Being written or generated. Nothing reads it yet. */
  "draft",
  /** The writer said yes. Scenes are materialised; the builder may consume it. */
  "approved",
  /** A newer version was approved after this one. Kept for the record. */
  "superseded",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** A planned change to what somebody knows, and how they come by it. */
export interface KnowledgeChangePlan {
  readonly characterId: string;
  readonly factId: string;
  readonly to: PlannedKnowledgeState;
  /** Who or what the information comes from, when planned. */
  readonly sourceEntityId?: string;
}

/** A planned movement in how two characters stand to each other. */
export interface RelationshipChangePlan {
  readonly relationshipId: string;
  /** The intended movement, in the author's words: "trust collapses". */
  readonly intent: string;
}

/**
 * A constraint on what may become known this chapter.
 *
 * The load-bearing half of "Mara must discover the key but must not yet
 * understand what it opens": the discovery is a knowledge change, the
 * not-understanding is a forbidden fact — recorded, validated against the
 * plan, and carried into the builder's instructions.
 */
export interface FactConstraint {
  readonly factId: string;
  /** Whom the constraint protects. Omitted → nobody may learn it. */
  readonly characterId?: string;
  /** Why, in the author's words. Shown wherever the constraint is enforced. */
  readonly reason?: string;
}

export interface WordRange {
  readonly minWords?: number;
  readonly maxWords?: number;
}

/**
 * One planned scene.
 *
 * `sceneId` is set once the scene exists as a record — a plan drafted before
 * its scenes are created has none, and approval mints them. Beats are plain
 * ordered strings: reorderable, editable, and never forced into screenplay
 * micro-structure (§3).
 */
export interface PlannedScene {
  /** Stable within the plan, so edits and reorders address the right scene. */
  readonly key: string;
  readonly sceneId?: string;
  readonly title: string;
  readonly pov?: string;
  readonly locationId?: string;
  readonly characterIds: readonly string[];
  readonly objectIds: readonly string[];
  /** What the scene is for. The quick plan's "goal". */
  readonly objective?: string;
  /** What resists it. The quick plan's "conflict". */
  readonly conflict?: string;
  /** Where things stand going in, in the author's words. */
  readonly entryState?: string;
  /** Where things stand coming out. The quick plan's "outcome". */
  readonly exitState?: string;
  readonly beats: readonly string[];
  /** What the reader learns here, in the author's words. */
  readonly revelations: readonly string[];
  readonly knowledgeChanges: readonly KnowledgeChangePlan[];
  readonly relationshipChanges: readonly RelationshipChangePlan[];
  readonly plotThreadIds: readonly string[];
  /** Setups planted here (SETUP_ ids). */
  readonly setupIds: readonly string[];
  /** Setups paid off here (SETUP_ ids). */
  readonly payoffSetupIds: readonly string[];
  /** Facts the scene relies on already being established (FACT_ ids). */
  readonly requiredFactIds: readonly string[];
  readonly targetWords?: WordRange;
  /** How it hands over to the next scene, when the writer cares. */
  readonly transitionIntent?: string;
}

/** A bounded snapshot of an earlier version, for structured comparison. */
export interface PlanRevision {
  readonly version: number;
  readonly savedAt: string;
  readonly note?: string;
  readonly objective?: string;
  readonly scenes: readonly PlannedScene[];
}

export interface ChapterPlan {
  readonly id: string;
  readonly chapterId: string;
  readonly version: number;
  readonly status: PlanStatus;
  /** The version that was approved, when one was. The builder pins to this. */
  readonly approvedVersion?: number;
  /** What the chapter is for, in the author's words. */
  readonly objective?: string;
  /** The chapter's job in the book: "the midpoint reversal". */
  readonly chapterRole?: string;
  readonly openingState?: string;
  readonly closingState?: string;
  readonly scenes: readonly PlannedScene[];
  readonly activePlotThreadIds: readonly string[];
  /** Setups this chapter must plant (SETUP_ ids). */
  readonly requiredSetupIds: readonly string[];
  /** Setups this chapter must pay off (SETUP_ ids). */
  readonly requiredPayoffIds: readonly string[];
  /** Arc movement per character, in the author's words. */
  readonly characterArcMovement: readonly { characterId: string; movement: string }[];
  /** Constraints the chapter must hold to — forbidden knowledge above all. */
  readonly forbiddenFacts: readonly FactConstraint[];
  /** Free-form constraints: "stays in one night", "no POV changes". */
  readonly constraints: readonly string[];
  readonly notes: readonly string[];
  /** Where the plan came from. Generated plans stay marked as such until edited. */
  readonly source: "author" | "model" | "mixed";
  readonly modelId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Earlier versions, oldest first, bounded. */
  readonly revisions: readonly PlanRevision[];
}

/** An empty planned scene, for manual planning. Everything else is optional. */
export function emptyPlannedScene(key: string, title: string): PlannedScene {
  return {
    key,
    title,
    characterIds: [],
    objectIds: [],
    beats: [],
    revelations: [],
    knowledgeChanges: [],
    relationshipChanges: [],
    plotThreadIds: [],
    setupIds: [],
    payoffSetupIds: [],
    requiredFactIds: [],
  };
}

// ── Impact (§7) ─────────────────────────────────────────────────────────────

/**
 * What a chapter claims to do, read deterministically off the plan itself.
 *
 * No model involved: advancing, introducing and resolving are facts about the
 * plan's own references. Whether the prose delivers them is a different
 * question, answered later by coverage.
 */
export interface PlanImpact {
  /** Thread ids the plan touches. */
  readonly advances: readonly string[];
  /** Setup ids planted here. */
  readonly introduces: readonly string[];
  /** Setup ids paid off here. */
  readonly resolves: readonly string[];
  /** Characters whose knowledge the plan changes. */
  readonly knowledgeTouched: readonly string[];
}

export function planImpact(plan: ChapterPlan): PlanImpact {
  const advances = new Set<string>(plan.activePlotThreadIds);
  const introduces = new Set<string>(plan.requiredSetupIds);
  const resolves = new Set<string>(plan.requiredPayoffIds);
  const knowledgeTouched = new Set<string>();
  for (const scene of plan.scenes) {
    for (const id of scene.plotThreadIds) advances.add(id);
    for (const id of scene.setupIds) introduces.add(id);
    for (const id of scene.payoffSetupIds) resolves.add(id);
    for (const change of scene.knowledgeChanges) knowledgeTouched.add(change.characterId);
  }
  return {
    advances: [...advances],
    introduces: [...introduces],
    resolves: [...resolves],
    knowledgeTouched: [...knowledgeTouched],
  };
}

// ── Version comparison (§16) ────────────────────────────────────────────────

export interface PlanComparison {
  readonly fromVersion: number;
  readonly toVersion: number;
  /** Scene keys present only in the newer version. */
  readonly addedScenes: readonly { key: string; title: string }[];
  /** Scene keys present only in the older version. */
  readonly removedScenes: readonly { key: string; title: string }[];
  /** Scenes whose order changed. */
  readonly reordered: boolean;
  /** Per-scene field-level differences, in plain words. */
  readonly changedScenes: readonly { key: string; title: string; changes: readonly string[] }[];
  readonly objectiveChanged: boolean;
}

/**
 * Compare two versions of a plan, structurally.
 *
 * Deliberately field-level prose ("beats changed: 4 → 6", "POV changed"),
 * not a character diff: a writer comparing plan versions is asking what moved
 * in the *shape*, and the journal already holds the byte-level history.
 */
export function comparePlanVersions(
  from: { version: number; objective?: string; scenes: readonly PlannedScene[] },
  to: { version: number; objective?: string; scenes: readonly PlannedScene[] },
): PlanComparison {
  const fromKeys = from.scenes.map((scene) => scene.key);
  const toKeys = to.scenes.map((scene) => scene.key);
  const fromByKey = new Map(from.scenes.map((scene) => [scene.key, scene]));
  const toByKey = new Map(to.scenes.map((scene) => [scene.key, scene]));

  const addedScenes = to.scenes
    .filter((scene) => !fromByKey.has(scene.key))
    .map((scene) => ({ key: scene.key, title: scene.title }));
  const removedScenes = from.scenes
    .filter((scene) => !toByKey.has(scene.key))
    .map((scene) => ({ key: scene.key, title: scene.title }));

  const shared = toKeys.filter((key) => fromByKey.has(key));
  const sharedInFromOrder = fromKeys.filter((key) => toByKey.has(key));
  const reordered = shared.join(" ") !== sharedInFromOrder.join(" ");

  const changedScenes: { key: string; title: string; changes: string[] }[] = [];
  for (const key of shared) {
    const a = fromByKey.get(key);
    const b = toByKey.get(key);
    /* istanbul ignore next — `shared` is keys present in both by construction. */
    if (a === undefined || b === undefined) continue;
    const changes: string[] = [];
    if (a.title !== b.title) changes.push(`title: "${a.title}" → "${b.title}"`);
    if (a.pov !== b.pov) changes.push("POV changed");
    if (a.locationId !== b.locationId) changes.push("location changed");
    if (a.objective !== b.objective) changes.push("objective changed");
    if (a.conflict !== b.conflict) changes.push("conflict changed");
    if (a.exitState !== b.exitState) changes.push("outcome changed");
    if (a.beats.join(" ") !== b.beats.join(" ")) {
      changes.push(
        a.beats.length === b.beats.length
          ? "beats edited"
          : `beats: ${String(a.beats.length)} → ${String(b.beats.length)}`,
      );
    }
    if (a.characterIds.join(",") !== b.characterIds.join(",")) changes.push("characters changed");
    if (changes.length > 0) changedScenes.push({ key, title: b.title, changes });
  }

  return {
    fromVersion: from.version,
    toVersion: to.version,
    addedScenes,
    removedScenes,
    reordered,
    changedScenes,
    objectiveChanged: (from.objective ?? "") !== (to.objective ?? ""),
  };
}

// ── Plan validation findings (§6) ───────────────────────────────────────────

export interface PlanFinding {
  readonly severity: "error" | "warning" | "info";
  readonly code:
    | "unknown_reference"
    | "pov_not_present"
    | "revelation_unavailable"
    | "forbidden_fact_granted"
    | "payoff_without_setup"
    | "setup_already_paid"
    | "object_elsewhere"
    | "character_elsewhere"
    | "empty_plan";
  readonly message: string;
  /** The planned scene the finding is about, when it is about one. */
  readonly sceneKey?: string;
}
