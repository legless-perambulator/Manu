import { describe, expect, it } from "vitest";
import type { PlotThread, Setup, WorldRule } from "@jellytind/domain";
import { StoryChronology, timelineNodes } from "@jellytind/story-state";
import { buildStory, compareBuilds, fingerprint, rulesAffectedBy } from "./build";
import { CORE_RULES, ruleById } from "./rules";
import {
  buildContext,
  scene,
  transition,
  ELIAS,
  FLAT,
  KEY,
  MANOR,
  MARA,
  PHOTO_THREAD,
  REVOLVER,
  RULE_NO_RESURRECTION,
  SETUP_KEY,
  VAULT,
  VAULT_FACT,
  WREN,
} from "./fixture";
import type { BuildContext, Diagnostic, StoryBuild } from "./types";

const clock = () => "2026-01-01T00:00:00.000Z";

const build = (
  context: Omit<BuildContext, "config">,
  options: Parameters<typeof buildStory>[2] = {},
): Promise<StoryBuild> => buildStory(CORE_RULES, context, { now: clock, ...options });

const rules = (found: readonly Diagnostic[]): string[] => [...new Set(found.map((d) => d.ruleId))];
const of = (found: readonly Diagnostic[], ruleId: string): Diagnostic[] =>
  found.filter((d) => d.ruleId === ruleId);

// ── A clean build ────────────────────────────────────────────────────────────

describe("a project with nothing wrong", () => {
  it("passes, and says which rules ran", async () => {
    const result = await build(buildContext());

    expect(result.status).toBe("passed");
    expect(result.counts).toEqual({ error: 0, warning: 0, info: 0 });
    expect(result.diagnostics).toEqual([]);
    expect(result.rules).toHaveLength(CORE_RULES.length);
    expect(result.rules.every((r) => r.status === "passed")).toBe(true);
  });

  it("numbers the build and records how long it took", async () => {
    const result = await build(buildContext(), { number: 284 });
    expect(result.id).toBe("BUILD_0284");
    expect(result.number).toBe(284);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("is reproducible for a given project state", async () => {
    const context = buildContext({
      transitions: [transition("SCENE_0001", "character_status", ELIAS, "deceased")],
      scenes: [
        scene("SCENE_0001", "CHAPTER_0001", { characterIds: [ELIAS] }),
        scene("SCENE_0002", "CHAPTER_0001", { characterIds: [ELIAS] }),
      ],
    });
    const a = await build(context);
    const b = await build(context);
    expect(a.diagnostics).toEqual(b.diagnostics);
  });
});

// ── Referential integrity ────────────────────────────────────────────────────

describe("referential integrity", () => {
  it("reports a reference to something that does not exist", async () => {
    const result = await build(
      buildContext({
        danglingReferences: [
          { fromId: "SCENE_0002", fromKind: "scene", field: "pov", toId: "CHAR_9999" },
        ],
      }),
    );

    const [diagnostic] = of(result.diagnostics, "referential_integrity");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.message).toContain("CHAR_9999");
    expect(diagnostic?.entities).toEqual(["CHAR_9999", "SCENE_0002"]);
    expect(diagnostic?.evidence).toBe("scene SCENE_0002.pov → CHAR_9999");
    expect(diagnostic?.suggestedAction).toContain("Remove the reference");
    expect(result.status).toBe("failed");
  });

  it("notices a POV character missing from their own scene", async () => {
    const result = await build(
      buildContext({
        scenes: [scene("SCENE_0001", "CHAPTER_0001", { pov: ELIAS, characterIds: [MARA] })],
      }),
    );

    const [diagnostic] = of(result.diagnostics, "scene_relationships");
    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.sceneId).toBe("SCENE_0001");
    expect(diagnostic?.chapterId).toBe("CHAPTER_0001");
  });

  it("reports a malformed location tree", async () => {
    const context = buildContext();
    const broken = {
      ...context,
      locations: [
        { ...context.locations[0], parentLocationId: VAULT },
        context.locations[2],
      ] as typeof context.locations,
    };
    const result = await build(broken);
    expect(rules(result.diagnostics)).toContain("location_structure");
  });
});

// ── Character continuity ─────────────────────────────────────────────────────

describe("character continuity", () => {
  it("catches a dead character appearing alive", async () => {
    const result = await build(
      buildContext({
        scenes: [
          scene("SCENE_0001", "CHAPTER_0001", { characterIds: [ELIAS] }),
          scene("SCENE_0003", "CHAPTER_0002", { characterIds: [ELIAS, MARA] }),
        ],
        transitions: [transition("SCENE_0001", "character_status", ELIAS, "deceased")],
      }),
    );

    const [diagnostic] = of(result.diagnostics, "character_continuity");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.sceneId).toBe("SCENE_0003");
    expect(diagnostic?.entities).toEqual([ELIAS]);
    expect(diagnostic?.evidence).toContain("deceased");
    expect(diagnostic?.suggestedAction).toContain("Record a status change");
  });

  it("catches a character in two places in one scene", async () => {
    const result = await build(
      buildContext({
        transitions: [
          transition("SCENE_0001", "character_location", ELIAS, FLAT),
          transition("SCENE_0001", "character_location", ELIAS, MANOR),
        ],
      }),
    );

    const [diagnostic] = of(result.diagnostics, "character_continuity");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.entities).toEqual([ELIAS, FLAT, MANOR].sort());
  });
});

// ── Knowledge ────────────────────────────────────────────────────────────────

describe("knowledge", () => {
  it("catches a character passing on what they never held", async () => {
    const result = await build(
      buildContext({
        scenes: [
          scene("SCENE_0001", "CHAPTER_0001", {
            characterIds: [ELIAS, MARA],
            factIds: [VAULT_FACT],
          }),
        ],
        transitions: [
          transition("SCENE_0001", "knowledge_changed", MARA, VAULT_FACT, {
            knowledgeState: "known",
            sourceType: "told",
            sourceEntityId: ELIAS,
          }),
        ],
      }),
    );

    const found = of(result.diagnostics, "knowledge_continuity");
    expect(found.map((d) => d.severity)).toContain("error");
    expect(found[0]?.entities).toContain(VAULT_FACT);
    expect(found[0]?.sceneId).toBe("SCENE_0001");
  });

  it("treats a scene referencing a fact its POV lacks as a warning, not an error", async () => {
    const result = await build(
      buildContext({
        scenes: [
          scene("SCENE_0001", "CHAPTER_0001", {
            pov: MARA,
            characterIds: [MARA],
            factIds: [VAULT_FACT],
          }),
        ],
      }),
    );

    const found = of(result.diagnostics, "knowledge_continuity");
    // Dramatic irony is a technique, not a mistake.
    expect(found.every((d) => d.severity === "warning")).toBe(true);
    expect(found[0]?.suggestedAction).toContain("unless the irony is deliberate");
  });
});

// ── Objects ──────────────────────────────────────────────────────────────────

describe("objects", () => {
  /** The revolver left in a flat in one chapter and fired at the manor in another. */
  it("catches an object used where it cannot be", async () => {
    const result = await build(
      buildContext({
        scenes: [
          scene("SCENE_0001", "CHAPTER_0001", { locationId: FLAT, objectIds: [REVOLVER] }),
          scene("SCENE_0003", "CHAPTER_0002", { locationId: MANOR, objectIds: [REVOLVER] }),
        ],
        transitions: [transition("SCENE_0001", "object_location", REVOLVER, FLAT)],
      }),
    );

    const [diagnostic] = of(result.diagnostics, "object_continuity");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.sceneId).toBe("SCENE_0003");
    expect(diagnostic?.entities).toContain(REVOLVER);
    expect(diagnostic?.suggestedAction).toContain("Record the transfer");
  });

  it("catches a destroyed object turning up again", async () => {
    const result = await build(
      buildContext({
        scenes: [
          scene("SCENE_0001", "CHAPTER_0001", { objectIds: [KEY] }),
          scene("SCENE_0003", "CHAPTER_0002", { objectIds: [KEY] }),
        ],
        transitions: [transition("SCENE_0001", "object_status", KEY, "destroyed")],
      }),
    );
    expect(of(result.diagnostics, "object_continuity")[0]?.severity).toBe("error");
  });

  it("warns about an object that moved with nobody carrying it", async () => {
    const result = await build(
      buildContext({
        transitions: [
          transition("SCENE_0001", "object_location", KEY, FLAT),
          transition("SCENE_0003", "object_location", KEY, MANOR),
        ],
      }),
    );
    const found = of(result.diagnostics, "object_continuity");
    expect(found[0]?.severity).toBe("warning");
  });

  it("says nothing about a scene deeper inside where the object was left", async () => {
    const result = await build(
      buildContext({
        scenes: [
          scene("SCENE_0001", "CHAPTER_0001", { locationId: MANOR, objectIds: [KEY] }),
          scene("SCENE_0003", "CHAPTER_0002", { locationId: VAULT, objectIds: [KEY] }),
        ],
        transitions: [transition("SCENE_0001", "object_location", KEY, MANOR)],
      }),
    );
    expect(rules(result.diagnostics)).not.toContain("object_continuity");
  });
});

// ── Timeline ─────────────────────────────────────────────────────────────────

describe("timeline", () => {
  it("catches a chronology that contradicts itself", async () => {
    const context = buildContext({
      scenes: [
        scene("SCENE_0001", "CHAPTER_0001", {
          storyTime: { kind: "exact", instant: "2019-03-04T14:00:00Z" },
          locationId: FLAT,
          characterIds: [ELIAS],
        }),
        scene("SCENE_0002", "CHAPTER_0001", {
          storyTime: { kind: "exact", instant: "2019-03-04T14:00:00Z" },
          locationId: MANOR,
          characterIds: [ELIAS],
        }),
      ],
    });
    const result = await build(context);

    const [diagnostic] = of(result.diagnostics, "timeline_consistency");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.entities).toContain(ELIAS);
    // The finding anchors to a scene so the UI can navigate to it.
    expect(diagnostic?.sceneId).toMatch(/^SCENE_/);
  });

  it("catches an event whose story time puts it outside its own scene", async () => {
    const context = buildContext({
      scenes: [
        scene("SCENE_0001", "CHAPTER_0001", {
          storyTime: { kind: "exact", instant: "2019-03-04T09:00:00Z" },
        }),
      ],
    });
    // An event dramatised in SCENE_0001 but stamped five days later.
    const events = [
      {
        id: "EVENT_0001",
        name: "The fire",
        description: "",
        storyTime: { kind: "exact", instant: "2019-03-09T09:00:00Z" },
        sceneId: "SCENE_0001",
        characterIds: [],
      },
    ] as unknown as typeof context.events;

    const result = await build({
      ...context,
      events,
      chronology: new StoryChronology(
        timelineNodes({ scenes: context.scenes, chapters: context.chapters, events }),
      ),
    });
    expect(rules(result.diagnostics)).toContain("timeline_consistency");
  });
});

// ── Plot threads and promises ────────────────────────────────────────────────

describe("plot threads", () => {
  const abandoned = [
    {
      id: PHOTO_THREAD,
      name: "The missing photograph",
      description: "",
      status: "planned",
      relatedSceneIds: [],
    },
  ] as unknown as PlotThread[];

  it("reports an abandoned thread", async () => {
    const result = await build(
      buildContext({
        threads: abandoned,
        transitions: [transition("SCENE_0002", "thread_status", PHOTO_THREAD, "abandoned")],
      }),
    );

    const [diagnostic] = of(result.diagnostics, "thread_lifecycle");
    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.entities).toEqual([PHOTO_THREAD]);
  });

  /** Dormancy is a measurement, so it is reported only against a chosen threshold. */
  it("reports dormancy only when the build asks for it", async () => {
    const context = buildContext({
      threads: abandoned,
      transitions: [transition("SCENE_0001", "thread_appearance", PHOTO_THREAD, "advances")],
    });

    expect(rules((await build(context)).diagnostics)).not.toContain("thread_lifecycle");

    const asked = await build(context, { config: { options: { dormantAfterScenes: 2 } } });
    const [diagnostic] = of(asked.diagnostics, "thread_lifecycle");
    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.evidence).toContain("scene(s)");
    expect(diagnostic?.suggestedAction).toContain("Nothing, if the silence is deliberate");
  });
});

describe("setups and payoffs", () => {
  const unpaid = [
    {
      id: SETUP_KEY,
      description: "Brass key visible in father's drawer.",
      setupSceneIds: ["SCENE_0001"],
      payoffSceneIds: [],
      subtlety: "subtle",
    },
  ] as unknown as Setup[];

  it("reports a promise with nothing on the other end", async () => {
    const result = await build(buildContext({ setups: unpaid }));

    const [diagnostic] = of(result.diagnostics, "setup_payoff");
    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.entities).toEqual([SETUP_KEY]);
    expect(diagnostic?.suggestedAction).toContain("Record where the promise is kept");
  });

  it("reports a payoff the reader reaches before its planting", async () => {
    const backwards = [
      { ...unpaid[0], setupSceneIds: ["SCENE_0004"], payoffSceneIds: ["SCENE_0001"] },
    ] as unknown as Setup[];
    const result = await build(buildContext({ setups: backwards }));
    expect(of(result.diagnostics, "setup_payoff")[0]?.severity).toBe("error");
  });
});

// ── Project rules ────────────────────────────────────────────────────────────

describe("world rules", () => {
  const noResurrection = [
    {
      id: RULE_NO_RESURRECTION,
      name: "No resurrection",
      description: "The dead stay dead.",
      severity: "hard",
      scope: "magic",
    },
  ] as unknown as WorldRule[];

  it("enforces a hard rule it can evaluate from recorded state", async () => {
    const result = await build(
      buildContext({
        worldRules: noResurrection,
        transitions: [
          transition("SCENE_0001", "character_status", WREN, "deceased"),
          transition("SCENE_0003", "character_status", WREN, "active"),
        ],
      }),
    );

    const [diagnostic] = of(result.diagnostics, "world_rules");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.sceneId).toBe("SCENE_0003");
    expect(diagnostic?.entities).toEqual([RULE_NO_RESURRECTION, WREN].sort());
    expect(diagnostic?.evidence).toContain("hard");
  });

  /**
   * The honest floor: a rule the compiler cannot evaluate is *said* to be
   * unevaluated, so a green build never implies it was checked.
   */
  it("says plainly which hard rules it could not check", async () => {
    const result = await build(
      buildContext({
        worldRules: [
          {
            id: "RULE_0002",
            name: "Only Elias POV until chapter 20",
            description: "Point of view is restricted.",
            severity: "hard",
            scope: "pov",
          },
        ] as unknown as WorldRule[],
      }),
    );

    const [diagnostic] = of(result.diagnostics, "world_rules");
    expect(diagnostic?.severity).toBe("info");
    expect(diagnostic?.message).toContain("cannot be checked deterministically");
    expect(result.status).toBe("passed");
  });

  it("says nothing when a project declares no hard rules", async () => {
    const result = await build(buildContext());
    expect(rules(result.diagnostics)).not.toContain("world_rules");
  });
});

// ── Configuration ────────────────────────────────────────────────────────────

describe("configuration", () => {
  const broken = () =>
    buildContext({
      danglingReferences: [
        { fromId: "SCENE_0002", fromKind: "scene", field: "pov", toId: "CHAR_9999" },
      ],
    });

  it("skips a disabled rule, and says it skipped it", async () => {
    const result = await build(broken(), {
      config: { disabledRules: ["referential_integrity"] },
    });

    expect(result.diagnostics).toEqual([]);
    const outcome = result.rules.find((r) => r.ruleId === "referential_integrity");
    expect(outcome?.status).toBe("skipped");
    expect(outcome?.reason).toContain("disabled");
    expect(result.status).toBe("passed");
  });

  it("skips a whole disabled category", async () => {
    const result = await build(broken(), {
      config: { disabledCategories: ["referential_integrity"] },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("forces a rule's findings to an overridden severity", async () => {
    const result = await build(broken(), {
      config: { severityOverrides: { referential_integrity: "warning" } },
    });

    expect(result.diagnostics[0]?.severity).toBe("warning");
    expect(result.status).toBe("passed_with_warnings");
  });
});

// ── Incremental architecture ─────────────────────────────────────────────────

describe("incremental builds", () => {
  it("selects the rules a change could possibly affect", () => {
    const affected = rulesAffectedBy(CORE_RULES, ["setups"]).map((r) => r.id);
    expect(affected).toEqual(["setup_payoff"]);

    const wider = rulesAffectedBy(CORE_RULES, ["transitions"]).map((r) => r.id);
    expect(wider).toContain("character_continuity");
    expect(wider).toContain("object_continuity");
    expect(wider).not.toContain("referential_integrity");
  });

  it("runs only those rules, and reports the rest as skipped rather than passed", async () => {
    const result = await build(
      buildContext({
        danglingReferences: [
          { fromId: "SCENE_0002", fromKind: "scene", field: "pov", toId: "CHAR_9999" },
        ],
      }),
      { only: ["setups"] },
    );

    // The integrity problem is real but was not looked for, and the build says
    // so instead of implying a clean result.
    expect(result.diagnostics).toEqual([]);
    const outcome = result.rules.find((r) => r.ruleId === "referential_integrity");
    expect(outcome?.status).toBe("skipped");
    expect(outcome?.reason).toContain("not affected by this change");
    expect(result.rules.find((r) => r.ruleId === "setup_payoff")?.status).toBe("passed");
  });
});

// ── Robustness ───────────────────────────────────────────────────────────────

describe("a rule that throws", () => {
  it("becomes a finding rather than losing the build", async () => {
    const exploding = {
      id: "exploding",
      name: "Exploding rule",
      category: "referential_integrity" as const,
      description: "Always throws.",
      inputs: ["entities" as const],
      run() {
        throw new Error("boom");
      },
    };

    const result = await buildStory([...CORE_RULES, exploding], buildContext(), { now: clock });
    const outcome = result.rules.find((r) => r.ruleId === "exploding");
    expect(outcome?.status).toBe("failed");
    expect(outcome?.reason).toBe("boom");

    const diagnostic = result.diagnostics.find((d) => d.ruleId === "exploding");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.message).toContain("could not run");
    // Every other rule still reported.
    expect(result.rules.filter((r) => r.status === "passed")).toHaveLength(CORE_RULES.length);
  });
});

// ── Diagnostic identity and comparison ───────────────────────────────────────

describe("diagnostic identity", () => {
  it("is derived from what a finding is about, never from how it is phrased", () => {
    expect(fingerprint("r", "SCENE_0001", ["B", "A"])).toBe(
      fingerprint("r", "SCENE_0001", ["A", "B"]),
    );
    expect(fingerprint("r", "SCENE_0001", ["A"], "k1")).not.toBe(
      fingerprint("r", "SCENE_0001", ["A"], "k2"),
    );
  });

  it("survives a rebuild, so the same problem keeps the same ID", async () => {
    const context = buildContext({
      danglingReferences: [
        { fromId: "SCENE_0002", fromKind: "scene", field: "pov", toId: "CHAR_9999" },
      ],
    });
    const first = await build(context, { number: 1 });
    const second = await build(context, { number: 2 });
    expect(first.diagnostics[0]?.id).toBe(second.diagnostics[0]?.id);
  });
});

describe("comparing builds", () => {
  it("separates what is new, what is fixed and what remains", async () => {
    const dangling = {
      fromId: "SCENE_0002",
      fromKind: "scene",
      field: "pov",
      toId: "CHAR_9999",
    };
    const before = await build(buildContext({ danglingReferences: [dangling] }), { number: 1 });

    const after = await build(
      buildContext({
        danglingReferences: [dangling],
        scenes: [
          scene("SCENE_0001", "CHAPTER_0001", { characterIds: [ELIAS] }),
          scene("SCENE_0003", "CHAPTER_0002", { characterIds: [ELIAS] }),
        ],
        transitions: [transition("SCENE_0001", "character_status", ELIAS, "deceased")],
      }),
      { number: 2 },
    );

    const comparison = compareBuilds(before, after);
    expect(comparison.previousBuildId).toBe("BUILD_0001");
    expect(comparison.buildId).toBe("BUILD_0002");
    expect(comparison.persistent.map((d) => d.ruleId)).toEqual(["referential_integrity"]);
    expect(comparison.added.map((d) => d.ruleId)).toEqual(["character_continuity"]);
    expect(comparison.resolved).toEqual([]);
  });

  it("reports a fixed problem as resolved", async () => {
    const before = await build(
      buildContext({
        danglingReferences: [
          { fromId: "SCENE_0002", fromKind: "scene", field: "pov", toId: "CHAR_9999" },
        ],
      }),
      { number: 1 },
    );
    const after = await build(buildContext(), { number: 2 });

    const comparison = compareBuilds(before, after);
    expect(comparison.resolved.map((d) => d.ruleId)).toEqual(["referential_integrity"]);
    expect(comparison.added).toEqual([]);
  });

  it("treats every diagnostic as new when there is no previous build", async () => {
    const current = await build(
      buildContext({
        danglingReferences: [
          { fromId: "SCENE_0002", fromKind: "scene", field: "pov", toId: "CHAR_9999" },
        ],
      }),
    );
    const comparison = compareBuilds(undefined, current);
    expect(comparison.previousBuildId).toBeUndefined();
    expect(comparison.added).toHaveLength(1);
  });
});

// ── The whole thing at once ──────────────────────────────────────────────────

/**
 * The example from the specification, as a real project: one error and two
 * warnings, from three different subsystems, in one build.
 */
describe("a thoroughly broken novel", () => {
  it("reports every problem, ordered with errors first", async () => {
    const result = await build(
      buildContext({
        scenes: [
          scene("SCENE_0001", "CHAPTER_0001", {
            locationId: FLAT,
            characterIds: [ELIAS],
            objectIds: [REVOLVER],
          }),
          scene("SCENE_0002", "CHAPTER_0001", { characterIds: [MARA], factIds: [VAULT_FACT] }),
          scene("SCENE_0003", "CHAPTER_0002", {
            locationId: MANOR,
            characterIds: [ELIAS],
            objectIds: [REVOLVER],
          }),
          scene("SCENE_0004", "CHAPTER_0003"),
        ],
        transitions: [
          transition("SCENE_0001", "object_location", REVOLVER, FLAT),
          transition("SCENE_0002", "knowledge_changed", MARA, VAULT_FACT, {
            knowledgeState: "known",
            sourceType: "told",
            sourceEntityId: ELIAS,
          }),
          transition("SCENE_0001", "thread_appearance", PHOTO_THREAD, "advances"),
        ],
        setups: [
          {
            id: SETUP_KEY,
            description: "Brass key visible in father's drawer.",
            setupSceneIds: ["SCENE_0001"],
            payoffSceneIds: [],
            subtlety: "subtle",
          },
        ] as unknown as Setup[],
      }),
      { config: { options: { dormantAfterScenes: 2 } }, number: 284 },
    );

    expect(result.status).toBe("failed");
    expect(result.counts.error).toBeGreaterThan(0);
    expect(result.counts.warning).toBeGreaterThan(0);

    // Errors first, so the list reads in the order a writer should act on it.
    const severities = result.diagnostics.map((d) => d.severity);
    expect(severities).toEqual([...severities].sort((a, b) => rank(a) - rank(b)));

    expect(rules(result.diagnostics)).toEqual(
      expect.arrayContaining([
        "knowledge_continuity",
        "object_continuity",
        "thread_lifecycle",
        "setup_payoff",
      ]),
    );

    // Every diagnostic is navigable and justified.
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.evidence).not.toBe("");
      expect(
        diagnostic.entities.length + (diagnostic.sceneId === undefined ? 0 : 1),
      ).toBeGreaterThan(0);
    }
  });
});

const rank = (severity: string): number =>
  severity === "error" ? 0 : severity === "warning" ? 1 : 2;

describe("the rule registry", () => {
  it("gives every rule a unique id, a category and declared inputs", () => {
    const ids = CORE_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CORE_RULES.every((r) => r.inputs.length > 0)).toBe(true);
    expect(CORE_RULES.every((r) => r.description !== "")).toBe(true);
  });

  it("can be looked up by id", () => {
    expect(ruleById("timeline_consistency")?.category).toBe("timeline");
    expect(ruleById("nope")).toBeUndefined();
  });
});
