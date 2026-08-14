import { describe, expect, it } from "vitest";
import type { Dependency, PlotThread, Setup, WorldRule } from "@jellytind/domain";
import { buildStory } from "./build";
import { CORE_RULES } from "./rules";
import {
  buildContext,
  scene,
  transition,
  ELIAS,
  MANOR,
  MARA,
  PHOTO_THREAD,
  REVOLVER,
  SETUP_KEY,
  VAULT,
  VAULT_FACT,
} from "./fixture";
import type { BuildContext, StoryBuild } from "./types";

/**
 * The rule audit, as a test rather than a claim.
 *
 * Phase 30.5B3 asked, of every registered rule: is it implemented, tested,
 * deterministic, evidenced, and *actually reachable*? A rule that can never
 * produce a finding is worse than a missing one, because a green build implies
 * it looked. So each rule here is driven until it emits, in one table, and the
 * table is checked against the registry — if a rule is added without a case, or
 * a rule stops being able to fire, this fails.
 */

const clock = () => "2026-01-01T00:00:00.000Z";
const build = (context: Omit<BuildContext, "config">): Promise<StoryBuild> =>
  buildStory(CORE_RULES, context, { now: clock });

/** A context engineered to make one named rule speak. */
const CASES: Readonly<Record<string, () => Omit<BuildContext, "config">>> = {
  referential_integrity: () =>
    buildContext({
      danglingReferences: [
        { fromId: "SCENE_0002", fromKind: "scene", field: "pov", toId: "CHAR_9999" },
      ],
    }),

  scene_relationships: () =>
    buildContext({
      scenes: [scene("SCENE_0001", "CHAPTER_0001", { pov: ELIAS, characterIds: [MARA] })],
    }),

  location_structure: () => {
    const context = buildContext();
    return {
      ...context,
      // A location whose parent is its own descendant.
      locations: [
        { ...context.locations[0], parentLocationId: VAULT },
        context.locations[2],
      ] as typeof context.locations,
    };
  },

  character_continuity: () =>
    buildContext({
      scenes: [
        scene("SCENE_0001", "CHAPTER_0001", { characterIds: [ELIAS] }),
        scene("SCENE_0003", "CHAPTER_0002", { characterIds: [ELIAS] }),
      ],
      transitions: [transition("SCENE_0001", "character_status", ELIAS, "deceased")],
    }),

  knowledge_continuity: () =>
    buildContext({
      // A fact on the page of a scene with a cast and no POV: the case the
      // audit's probe found unreachable (MANU-034).
      scenes: [
        scene("SCENE_0001", "CHAPTER_0001", { characterIds: [ELIAS], factIds: [VAULT_FACT] }),
      ],
    }),

  object_continuity: () =>
    buildContext({
      scenes: [
        scene("SCENE_0001", "CHAPTER_0001", { objectIds: [REVOLVER] }),
        scene("SCENE_0003", "CHAPTER_0002", { objectIds: [REVOLVER] }),
      ],
      transitions: [transition("SCENE_0001", "object_status", REVOLVER, "destroyed")],
    }),

  timeline_consistency: () =>
    buildContext({
      scenes: [
        scene("SCENE_0001", "CHAPTER_0001", {
          storyTime: { kind: "exact", instant: "2019-03-04T14:00:00Z" },
          locationId: MANOR,
          characterIds: [ELIAS],
        }),
        scene("SCENE_0002", "CHAPTER_0001", {
          storyTime: { kind: "exact", instant: "2019-03-04T14:00:00Z" },
          locationId: VAULT,
          characterIds: [ELIAS],
        }),
      ],
    }),

  thread_lifecycle: () =>
    buildContext({
      threads: [
        {
          id: PHOTO_THREAD,
          name: "The missing photograph",
          description: "",
          status: "planned",
          relatedSceneIds: [],
        },
      ] as unknown as PlotThread[],
      transitions: [transition("SCENE_0002", "thread_status", PHOTO_THREAD, "abandoned")],
    }),

  setup_payoff: () =>
    buildContext({
      setups: [
        {
          id: SETUP_KEY,
          description: "The brass key on the mantel",
          setupSceneIds: ["SCENE_0001"],
          payoffSceneIds: [],
          subtlety: "subtle",
          notes: "",
        },
      ] as unknown as Setup[],
    }),

  world_rules: () =>
    buildContext({
      worldRules: [
        {
          id: "RULE_0001",
          name: "The dead stay dead",
          description: "Nobody is resurrected.",
          scope: "resurrection",
          severity: "hard",
        },
      ] as unknown as WorldRule[],
      scenes: [
        scene("SCENE_0001", "CHAPTER_0001", { characterIds: [ELIAS] }),
        scene("SCENE_0003", "CHAPTER_0002", { characterIds: [ELIAS] }),
      ],
      transitions: [
        transition("SCENE_0001", "character_status", ELIAS, "deceased"),
        transition("SCENE_0003", "character_status", ELIAS, "active"),
      ],
    }),

  dependency_integrity: () =>
    buildContext({
      dependencies: [
        {
          id: "DEP_0001",
          fromId: "SCENE_0001",
          toId: "SCENE_9999",
          kind: "enables",
          strength: "load_bearing",
          rationale: "",
          source: "author",
          status: "confirmed",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ] as unknown as Dependency[],
    }),
};

/**
 * `story_tests` is the one rule with no context-only case: it reports the
 * writer's own assertions, and those arrive as `testResults`, which the
 * repository computes and hands in. It is exercised end to end in
 * `packages/story-repository/src/story-tests.test.ts` instead.
 */
const RULES_WITHOUT_CONTEXT_CASES = new Set(["story_tests"]);

describe("every registered rule", () => {
  it("has a case here, so a new rule cannot ship unaudited", () => {
    const covered = new Set([...Object.keys(CASES), ...RULES_WITHOUT_CONTEXT_CASES]);
    const missing = CORE_RULES.map((rule) => rule.id).filter((id) => !covered.has(id));
    expect(missing).toEqual([]);
    // And nothing here names a rule the registry does not have.
    const registered = new Set(CORE_RULES.map((rule) => rule.id));
    expect(Object.keys(CASES).filter((id) => !registered.has(id))).toEqual([]);
  });

  for (const [ruleId, makeContext] of Object.entries(CASES)) {
    it(`${ruleId} can actually produce a finding`, async () => {
      const result = await build(makeContext());
      const found = result.diagnostics.filter((d) => d.ruleId === ruleId);
      expect(found.length, `${ruleId} produced no diagnostic — is it a stub?`).toBeGreaterThan(0);
    });
  }

  it("produces only diagnostics a writer could act on", async () => {
    // Diagnostic quality as an invariant rather than a per-rule assertion:
    // every finding says which rule, how bad, what about, where, and why.
    for (const makeContext of Object.values(CASES)) {
      const result = await build(makeContext());
      for (const diagnostic of result.diagnostics) {
        expect(diagnostic.ruleId).not.toBe("");
        expect(["error", "warning", "info"]).toContain(diagnostic.severity);
        expect(diagnostic.message.length).toBeGreaterThan(10);
        expect(diagnostic.evidence, `${diagnostic.ruleId} gave no evidence`).not.toBe("");
        // Navigable: something to click, or a scene to open.
        expect(
          diagnostic.entities.length + (diagnostic.sceneId === undefined ? 0 : 1),
          `${diagnostic.ruleId} is not navigable`,
        ).toBeGreaterThan(0);
        // A scene-anchored finding resolves to its chapter, so "go there" works.
        if (diagnostic.sceneId !== undefined) expect(diagnostic.chapterId).toBeDefined();
      }
    }
  });

  it("is deterministic: the same context twice gives identical findings", async () => {
    for (const [ruleId, makeContext] of Object.entries(CASES)) {
      const a = await build(makeContext());
      const b = await build(makeContext());
      expect(a.diagnostics, `${ruleId} is not deterministic`).toEqual(b.diagnostics);
    }
  });

  it("declares inputs that actually select it for an incremental build", () => {
    // A rule with inputs nothing ever changes would never run incrementally.
    for (const rule of CORE_RULES) {
      expect(rule.inputs.length, `${rule.id} declares no inputs`).toBeGreaterThan(0);
      expect(rule.description, `${rule.id} has no description`).not.toBe("");
    }
  });
});

describe("world rules", () => {
  it("says out loud which hard rules it could not evaluate", async () => {
    // The honest floor: an unevaluated hard rule is reported as info rather
    // than passing silently, so a green build never implies it was checked.
    const result = await build(
      buildContext({
        worldRules: [
          {
            id: "RULE_0002",
            name: "Magic costs memory",
            description: "Every spell takes a memory from the caster.",
            scope: "magic",
            severity: "hard",
          },
        ] as unknown as WorldRule[],
      }),
    );

    const found = result.diagnostics.find((d) => d.ruleId === "world_rules");
    expect(found?.severity).toBe("info");
    expect(found?.message).toContain("cannot be checked deterministically");
    expect(found?.entities).toContain("RULE_0002");
  });
});
