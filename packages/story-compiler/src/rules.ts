import {
  checkContinuity,
  checkKnowledgeViolations,
  checkNarrative,
  checkTimeline,
} from "@jellytind/story-state";
import type {
  ContinuityViolation,
  NarrativeFinding,
  TimelineViolation,
} from "@jellytind/story-state";
import type { BuildContext, DiagnosticDraft, Severity, StoryCompilerRule } from "./types";

/**
 * The deterministic rule set.
 *
 * Almost every rule here is a **thin adapter**. The knowledge of what makes a
 * story inconsistent lives in the subsystems that own the data — the entity
 * graph, the story-state timeline, the chronology, the narrative checks — and
 * re-deriving any of it here would create a second implementation to drift
 * apart from the first. A rule's job is to run the check that already exists
 * and dress its findings as diagnostics with evidence and an action
 * (docs/STORY_COMPILER.md).
 *
 * Nothing here is faked. A check that cannot yet be made reliable is absent
 * rather than approximated, because a build a writer cannot trust is worse than
 * a shorter one.
 */

// ── Referential integrity ────────────────────────────────────────────────────

const referentialIntegrity: StoryCompilerRule = {
  id: "referential_integrity",
  name: "Referential integrity",
  category: "referential_integrity",
  description: "Every reference between entities points at something that exists.",
  inputs: ["entities", "scenes"],
  run(context) {
    return context.danglingReferences.map((edge) => ({
      severity: "error" as const,
      message: `${edge.fromId} references ${edge.toId} in "${edge.field}", which does not exist in this project.`,
      entities: [edge.fromId, edge.toId],
      evidence: `${edge.fromKind} ${edge.fromId}.${edge.field} → ${edge.toId}`,
      suggestedAction: `Remove the reference, or create ${edge.toId}.`,
      key: edge.field,
    }));
  },
};

/**
 * Scene relationships that are structurally wrong without being dangling.
 *
 * Deliberately narrow: only shapes that are *always* mistakes. A scene with no
 * chapter is a perfectly normal work in progress and is not reported.
 */
const sceneRelationships: StoryCompilerRule = {
  id: "scene_relationships",
  name: "Scene relationships",
  category: "referential_integrity",
  description: "A scene's own links to its cast and setting are coherent.",
  inputs: ["scenes", "entities"],
  run(context) {
    const out: DiagnosticDraft[] = [];
    for (const scene of context.scenes) {
      const sceneId = scene.id as string;
      const cast = scene.characterIds as readonly string[];

      // A point-of-view character who is not in their own scene.
      if (scene.pov !== undefined && !cast.includes(scene.pov as string)) {
        out.push({
          severity: "warning",
          message: `${sceneId} is told from ${String(scene.pov)}'s point of view, but they are not listed among its characters.`,
          entities: [sceneId, scene.pov as string],
          sceneId,
          evidence: `pov: ${String(scene.pov)}; characterIds: ${cast.length === 0 ? "none" : cast.join(", ")}`,
          suggestedAction: `Add ${String(scene.pov)} to the scene's characters.`,
          key: "pov_absent",
        });
      }

      // The same character listed twice: harmless, but always a slip.
      const duplicates = [...new Set(cast.filter((id, i) => cast.indexOf(id) !== i))];
      for (const id of duplicates) {
        out.push({
          severity: "info",
          message: `${sceneId} lists ${id} more than once.`,
          entities: [sceneId, id],
          sceneId,
          evidence: `characterIds: ${cast.join(", ")}`,
          suggestedAction: "Remove the duplicate.",
          key: "duplicate_cast",
        });
      }
    }
    return out;
  },
};

// ── Character continuity, objects and locations ──────────────────────────────

/** Findings the physical-continuity check produces, split by what they concern. */
function continuityFindings(context: BuildContext): ContinuityViolation[] {
  return checkContinuity({
    timeline: context.timeline,
    scenes: context.scenes,
    locations: context.locations,
  });
}

const CHARACTER_KINDS = new Set(["dead_character_appears", "conflicting_character_location"]);

const characterContinuity: StoryCompilerRule = {
  id: "character_continuity",
  name: "Character continuity",
  category: "character_continuity",
  description: "Characters are alive where they appear, and in one place at a time.",
  inputs: ["transitions", "scenes", "entities"],
  run(context) {
    return continuityFindings(context)
      .filter((v) => CHARACTER_KINDS.has(v.kind))
      .map((v) => ({
        severity: v.severity,
        message: v.message,
        entities: [
          ...(v.characterId === undefined ? [] : [v.characterId]),
          ...(v.locationIds ?? []),
        ],
        ...(v.sceneId !== undefined ? { sceneId: v.sceneId } : {}),
        evidence:
          v.kind === "dead_character_appears"
            ? "A character_status transition records them deceased earlier in the story."
            : `Recorded positions: ${(v.locationIds ?? []).join(" and ")}.`,
        suggestedAction:
          v.kind === "dead_character_appears"
            ? "Record a status change if they survive, or remove them from the scene."
            : "Record the movement between the two places, or correct one of them.",
        key: v.kind,
      }));
  },
};

const OBJECT_KINDS = new Set([
  "impossible_object_appearance",
  "destroyed_object_reused",
  "conflicting_object_ownership",
  "unexplained_object_relocation",
]);

const objectContinuity: StoryCompilerRule = {
  id: "object_continuity",
  name: "Object continuity",
  category: "objects",
  description: "Tracked objects are where the story last put them, and still exist.",
  inputs: ["transitions", "scenes", "entities"],
  run(context) {
    return continuityFindings(context)
      .filter((v) => OBJECT_KINDS.has(v.kind))
      .map((v) => ({
        severity: v.severity,
        message: v.message,
        entities: [
          ...(v.objectId === undefined ? [] : [v.objectId]),
          ...(v.characterId === undefined ? [] : [v.characterId]),
          ...(v.locationIds ?? []),
        ],
        ...(v.sceneId !== undefined ? { sceneId: v.sceneId } : {}),
        evidence:
          v.kind === "destroyed_object_reused"
            ? "An object_status transition records it destroyed earlier in the story."
            : `Recorded position: ${(v.locationIds ?? []).join(" → ") || "carried"}.`,
        suggestedAction:
          v.kind === "destroyed_object_reused"
            ? "Record a status change if it survives, or remove it from the scene."
            : "Record the transfer that moves it, or correct the recorded position.",
        key: v.kind,
      }));
  },
};

const locationStructure: StoryCompilerRule = {
  id: "location_structure",
  name: "Location structure",
  category: "referential_integrity",
  description: "The nested-location tree is well formed.",
  inputs: ["entities"],
  run(context) {
    return continuityFindings(context)
      .filter((v) => v.kind === "invalid_nested_location")
      .map((v) => ({
        severity: v.severity,
        message: v.message,
        entities: [...(v.locationIds ?? [])],
        evidence: "Derived from the locations' parentLocationId chain.",
        suggestedAction: "Correct the parent location.",
        key: v.kind,
      }));
  },
};

// ── Knowledge ────────────────────────────────────────────────────────────────

const knowledgeContinuity: StoryCompilerRule = {
  id: "knowledge_continuity",
  name: "Character knowledge",
  category: "knowledge",
  description: "Nobody uses or passes on information the story has not given them.",
  inputs: ["transitions", "scenes", "entities"],
  run(context) {
    const violations = checkKnowledgeViolations({
      timeline: context.timeline,
      scenes: context.scenes,
      facts: new Map(context.facts.map((f) => [f.id as string, f])),
    });

    return violations.map((v) => ({
      severity: v.severity,
      message: v.message,
      entities: [...(v.characterId === undefined ? [] : [v.characterId]), v.factId],
      sceneId: v.sceneId,
      evidence: `Reconstructed from knowledge transitions up to ${v.sceneId}.`,
      suggestedAction:
        v.kind === "referenced_without_knowledge"
          ? "Record where they learn it, or remove the fact from the scene — unless the irony is deliberate."
          : "Record the acquisition that makes this possible, or correct the transition.",
      key: v.kind,
    }));
  },
};

// ── Timeline ─────────────────────────────────────────────────────────────────

const TIMELINE_ACTIONS: Readonly<Record<string, string>> = {
  contradictory_relations: "Remove one of the relations in the loop.",
  relation_contradicts_time: "Correct the relation, or the story times it disagrees with.",
  impossible_interval: "Loosen one of the constraints squeezing this moment.",
  character_bilocation: "Correct one of the two positions.",
  impossible_travel: "Allow more time, or change the declared travel time.",
  event_outside_scene: "Move the event, or correct its story time.",
  dangling_relation: "Delete the relation, or restore what it points at.",
};

const timelineConsistency: StoryCompilerRule = {
  id: "timeline_consistency",
  name: "Timeline",
  category: "timeline",
  description: "The story's chronology holds together, and nothing is in two moments at once.",
  inputs: ["chronology", "scenes", "entities"],
  run(context) {
    const violations: TimelineViolation[] = checkTimeline({
      chronology: context.chronology,
      links: context.temporalLinks,
      travel: context.travelRules,
    });

    return violations.map((v) => ({
      severity: v.severity,
      message: v.message,
      entities: [
        ...v.nodeIds,
        ...(v.characterId === undefined ? [] : [v.characterId]),
        ...(v.locationIds ?? []),
      ],
      // A timeline node may be a scene or an off-page event; only a scene can
      // anchor the diagnostic to a place in the manuscript.
      ...(v.nodeIds.some((id) => id.startsWith("SCENE_"))
        ? { sceneId: v.nodeIds.find((id) => id.startsWith("SCENE_")) as string }
        : {}),
      evidence: "Derived from recorded story times and temporal relations.",
      suggestedAction: TIMELINE_ACTIONS[v.kind] ?? "Review the recorded chronology.",
      key: v.kind,
    }));
  },
};

// ── Plot threads and promises ────────────────────────────────────────────────

function narrativeFindings(context: BuildContext): NarrativeFinding[] {
  return checkNarrative({
    timeline: context.timeline,
    scenes: context.scenes,
    threads: context.threads,
    setups: context.setups,
    metrics: context.metrics,
    ...(context.config.options.dormantAfterScenes !== undefined
      ? { dormantAfterScenes: context.config.options.dormantAfterScenes }
      : {}),
  });
}

const THREAD_KINDS = new Set(["abandoned_thread", "dormant_thread"]);

const threadLifecycle: StoryCompilerRule = {
  id: "thread_lifecycle",
  name: "Plot threads",
  category: "plot_threads",
  description: "Threads the story still owes are visible, including quiet ones.",
  inputs: ["transitions", "entities", "prose"],
  run(context) {
    return narrativeFindings(context)
      .filter((f) => THREAD_KINDS.has(f.kind))
      .map((f) => ({
        severity: f.severity,
        message: f.message,
        entities: [...(f.threadId === undefined ? [] : [f.threadId])],
        evidence:
          f.dormancy === undefined
            ? "Derived from the thread's recorded lifecycle."
            : `Last appearance ${String(f.dormancy.lastAppearanceSceneId)}; ${String(f.dormancy.scenesSinceAppearance)} scene(s), ${String(f.dormancy.chaptersSinceAppearance ?? "?")} chapter(s), ${String(f.dormancy.wordsSinceAppearance ?? "?")} words since.`,
        // Dormancy is information, not a verdict: the suggested action says so.
        suggestedAction:
          f.kind === "dormant_thread"
            ? "Nothing, if the silence is deliberate. Otherwise bring the thread back, or mark it dormant."
            : "Resolve the thread, or retire the promises still pointing at it.",
        key: f.kind,
      }));
  },
};

const SETUP_KINDS = new Set([
  "setup_without_payoff",
  "payoff_before_setup",
  "unresolved_setup",
  "dangling_setup_reference",
]);

const SETUP_ACTIONS: Readonly<Record<string, string>> = {
  setup_without_payoff: "Record where the promise is kept, or mark the setup abandoned.",
  payoff_before_setup: "Move the payoff after the planting, or plant it earlier.",
  unresolved_setup: "Pay the promise off before the thread finishes, or retire it.",
  dangling_setup_reference: "Correct the scene the setup names.",
};

const setupPayoff: StoryCompilerRule = {
  id: "setup_payoff",
  name: "Setups and payoffs",
  category: "setup_payoff",
  description: "Registered promises are kept, and kept after they are made.",
  inputs: ["setups", "scenes", "transitions"],
  run(context) {
    return narrativeFindings(context)
      .filter((f) => SETUP_KINDS.has(f.kind))
      .map((f) => ({
        severity: f.severity,
        message: f.message,
        entities: [
          ...(f.setupId === undefined ? [] : [f.setupId]),
          ...(f.threadId === undefined ? [] : [f.threadId]),
        ],
        ...(f.sceneIds?.[0] !== undefined ? { sceneId: f.sceneIds[0] } : {}),
        evidence: `Registered setup scenes: ${(f.sceneIds ?? []).join(", ") || "none"}.`,
        suggestedAction: SETUP_ACTIONS[f.kind] ?? "Review the registered promise.",
        key: f.kind,
      }));
  },
};

// ── Project rules ────────────────────────────────────────────────────────────

/**
 * World rules the compiler can actually evaluate.
 *
 * Only one shape qualifies today: a `hard` rule scoped to `resurrection`, which
 * the recorded character statuses answer outright. Everything else a writer
 * writes in a world rule is prose, and prose is a model's job.
 *
 * This is the honest floor rather than a token gesture: the rule reports what it
 * *cannot* evaluate as `info`, so a writer can see that their hard rules are
 * declared but unchecked, instead of assuming a green build means they hold.
 */
const worldRuleEvaluation: StoryCompilerRule = {
  id: "world_rules",
  name: "World rules",
  category: "project_rules",
  description: "Hard world rules that can be evaluated from recorded state are enforced.",
  inputs: ["world_rules", "transitions", "entities"],
  run(context) {
    const out: DiagnosticDraft[] = [];
    const hard = context.worldRules.filter((rule) => rule.severity === "hard");
    if (hard.length === 0) return out;

    const resurrection = hard.filter((rule) =>
      /resurrect|raise the dead|come back/i.test(`${rule.name} ${rule.description} ${rule.scope}`),
    );

    for (const rule of resurrection) {
      for (const revival of revivals(context)) {
        out.push({
          severity: "error",
          message: `${revival.characterId} is recorded alive again in ${revival.sceneId}, but "${rule.name}" forbids it.`,
          entities: [rule.id as string, revival.characterId],
          sceneId: revival.sceneId,
          evidence: `character_status: deceased → ${revival.to}. World rule ${String(rule.id)} (hard): ${rule.description}`,
          suggestedAction: "Correct the status change, or relax the rule.",
          key: `resurrection:${rule.id as string}`,
        });
      }
    }

    // Hard rules with no deterministic reading. Said out loud, because a build
    // that silently ignores them would imply they had been checked.
    const unevaluated = hard.filter((rule) => !resurrection.includes(rule));
    if (unevaluated.length > 0) {
      out.push({
        severity: "info",
        message: `${String(unevaluated.length)} hard world rule(s) cannot be checked deterministically and were not evaluated.`,
        entities: unevaluated.map((rule) => rule.id as string),
        evidence: unevaluated.map((rule) => `${String(rule.id)}: ${rule.name}`).join("; "),
        suggestedAction: "Semantic evaluation of world rules arrives with the model-backed checks.",
        key: "unevaluated_hard_rules",
      });
    }

    return out;
  },
};

/** Characters recorded as deceased and later recorded alive again. */
function revivals(
  context: BuildContext,
): Array<{ characterId: string; sceneId: string; to: string }> {
  const out: Array<{ characterId: string; sceneId: string; to: string }> = [];
  const dead = new Set<string>();

  for (const sceneId of context.timeline.sceneOrder) {
    for (const t of context.timeline.transitionsAtScene(sceneId)) {
      if (t.kind !== "character_status" || t.confirmationStatus === "rejected") continue;
      if (t.value === "deceased") {
        dead.add(t.subjectId);
      } else if (dead.has(t.subjectId) && t.value !== "unknown") {
        out.push({ characterId: t.subjectId, sceneId, to: t.value });
        dead.delete(t.subjectId);
      }
    }
  }
  return out;
}

/**
 * Failing story tests, as diagnostics.
 *
 * The suite is reported separately on the build — a writer's own assertions are
 * a different kind of result from the compiler's built-in checks. But a failure
 * is still something to navigate to and to compare against the last build, so
 * each one also becomes a diagnostic, carrying the test's own severity rather
 * than a severity the compiler chose.
 *
 * A semantic test is never a diagnostic. It has not been evaluated, and an
 * unanswered question is not a failure.
 */
const storyTests: StoryCompilerRule = {
  id: "story_tests",
  name: "Story tests",
  category: "story_tests",
  description: "The writer's own assertions about what must be true, and when.",
  inputs: ["story_tests", "transitions", "scenes", "entities"],
  run(context) {
    const out: DiagnosticDraft[] = [];
    for (const result of context.testResults?.results ?? []) {
      if (result.status === "errored") {
        out.push({
          severity: "warning",
          message: `Story test "${result.name}" could not run: ${result.reason ?? "unknown reason"}.`,
          entities: [result.testId],
          evidence: result.statement,
          suggestedAction: "Correct the test's scope, or the entities it names.",
          key: "errored",
        });
        continue;
      }
      if (result.status !== "failed") continue;

      for (const failure of result.failures) {
        out.push({
          severity: result.severity,
          message: `Story test "${result.name}" failed at ${failure.sceneId}: expected ${failure.expected}, but ${failure.actual}.`,
          entities: [result.testId, ...failure.entities],
          sceneId: failure.sceneId,
          evidence: failure.evidence,
          suggestedAction:
            "Change the story so the assertion holds, or change the assertion if the intention moved.",
          key: `${result.testId}:${failure.sceneId}`,
        });
      }
    }
    return out;
  },
};

/**
 * Every rule the compiler ships with, in the order a build reports them.
 *
 * A plain array so later phases — and eventually plugins — can concatenate
 * their own without the build knowing anything about them.
 */
export const CORE_RULES: readonly StoryCompilerRule[] = [
  referentialIntegrity,
  sceneRelationships,
  locationStructure,
  characterContinuity,
  knowledgeContinuity,
  objectContinuity,
  timelineConsistency,
  threadLifecycle,
  setupPayoff,
  worldRuleEvaluation,
  storyTests,
];

/** Look a rule up by ID — for configuration UIs and for tests. */
export function ruleById(
  id: string,
  rules: readonly StoryCompilerRule[] = CORE_RULES,
): StoryCompilerRule | undefined {
  return rules.find((rule) => rule.id === id);
}

/** Severity a rule's findings carry by default, where it is fixed. */
export const RULE_SEVERITY_HINT: Readonly<Record<string, Severity>> = {
  referential_integrity: "error",
};
