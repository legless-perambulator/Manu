import { describe, expect, it } from "vitest";
import { describeTest, type Assertion, type StoryTest, type TestScope } from "@jellytind/domain";
import { StoryTimeline } from "@jellytind/story-state";
import { resolveScope, runStoryTest, runStoryTests, type TestRunInput } from "./story-tests";
import { buildStory } from "./build";
import { CORE_RULES } from "./rules";
import {
  buildContext,
  scene as makeScene,
  transition,
  ELIAS,
  FLAT,
  MANOR,
  MARA,
  PHOTO_THREAD,
  REVOLVER,
  VAULT_FACT,
} from "./fixture";

const REL = "REL_0001";

/**
 * Eight scenes across three chapters, so ranges have room to mean something.
 * Elias learns the vault fact in scene 6 — chapter three.
 */
const SCENES = [
  makeScene("SCENE_0001", "CHAPTER_0001"),
  makeScene("SCENE_0002", "CHAPTER_0001"),
  makeScene("SCENE_0003", "CHAPTER_0002"),
  makeScene("SCENE_0004", "CHAPTER_0002"),
  makeScene("SCENE_0005", "CHAPTER_0002"),
  makeScene("SCENE_0006", "CHAPTER_0003"),
  makeScene("SCENE_0007", "CHAPTER_0003"),
  makeScene("SCENE_0008", "CHAPTER_0003"),
];

const CHAPTERS = buildContext().chapters;
const RELATIONSHIPS = [
  {
    id: REL,
    characterAId: ELIAS,
    characterBId: MARA,
    type: "rival",
    status: "wary",
    description: "",
  },
] as unknown as TestRunInput["relationships"];

let seq = 0;
function test(assertion: Assertion, overrides: Partial<StoryTest> = {}): StoryTest {
  return {
    id: `TEST_${String(++seq).padStart(4, "0")}`,
    name: overrides.name ?? "A test",
    description: "",
    type: overrides.type ?? "deterministic",
    scope: overrides.scope ?? { kind: "always" },
    enabled: overrides.enabled ?? true,
    severity: overrides.severity ?? "error",
    assertion,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as StoryTest;
}

function input(transitions: ConstructorParameters<typeof StoryTimeline>[1] = []): TestRunInput {
  seq = 0;
  return {
    tests: [],
    timeline: new StoryTimeline(
      SCENES.map((s) => s.id as string),
      transitions,
    ),
    scenes: SCENES,
    chapters: CHAPTERS,
    relationships: RELATIONSHIPS,
  };
}

/** The specification's own example: Elias learns the fact in chapter three. */
function eliasLearnsLate() {
  return input([
    transition("SCENE_0006", "knowledge_changed", ELIAS, VAULT_FACT, {
      knowledgeState: "known",
      sourceType: "witnessed",
    }),
  ]);
}

// ── Scope ────────────────────────────────────────────────────────────────────

describe("scope", () => {
  const base = input();

  it("covers the whole manuscript when it says always", () => {
    expect(resolveScope({ kind: "always" }, base)).toHaveLength(8);
  });

  it("covers one scene when it names one", () => {
    expect(resolveScope({ kind: "at", anchorId: "SCENE_0004" as never }, base)).toEqual([
      "SCENE_0004",
    ]);
  });

  /** A chapter anchor means where the chapter *begins*, which is what a writer means. */
  it("reads a chapter anchor as the chapter's opening", () => {
    expect(resolveScope({ kind: "before", anchorId: "CHAPTER_0003" as never }, base)).toEqual([
      "SCENE_0001",
      "SCENE_0002",
      "SCENE_0003",
      "SCENE_0004",
      "SCENE_0005",
    ]);
  });

  it("runs from an anchor to the end", () => {
    expect(resolveScope({ kind: "from", anchorId: "CHAPTER_0003" as never }, base)).toEqual([
      "SCENE_0006",
      "SCENE_0007",
      "SCENE_0008",
    ]);
  });

  /** A range ending at a chapter covers the whole of it, not just its opening. */
  it("covers a range inclusively, to the end of a closing chapter", () => {
    expect(
      resolveScope(
        { kind: "between", anchorId: "SCENE_0003" as never, untilId: "CHAPTER_0003" as never },
        base,
      ),
    ).toEqual(["SCENE_0003", "SCENE_0004", "SCENE_0005", "SCENE_0006", "SCENE_0007", "SCENE_0008"]);
  });

  it("refuses a range that ends before it starts", () => {
    expect(() =>
      resolveScope(
        { kind: "between", anchorId: "SCENE_0006" as never, untilId: "SCENE_0002" as never },
        base,
      ),
    ).toThrow(/before it starts/);
  });

  it("refuses an anchor the project does not have", () => {
    expect(() => resolveScope({ kind: "at", anchorId: "SCENE_9999" as never }, base)).toThrow(
      /not a scene or a chapter/,
    );
  });
});

// ── The worked example ───────────────────────────────────────────────────────

describe("the specification's example", () => {
  const assertion = {
    kind: "character_does_not_know_fact",
    characterId: ELIAS,
    factId: VAULT_FACT,
  } as Assertion;

  it("passes while the intention holds", () => {
    const result = runStoryTest(
      test(assertion, {
        name: "Elias must not know the vault fact before chapter 3",
        scope: { kind: "before", anchorId: "CHAPTER_0003" as never },
      }),
      eliasLearnsLate(),
    );

    expect(result.status).toBe("passed");
    expect(result.checkedScenes).toHaveLength(5);
    expect(result.failures).toEqual([]);
  });

  it("fails the moment the story breaks it, and says exactly where", () => {
    const result = runStoryTest(
      test(assertion, {
        name: "Elias must not know the vault fact",
        scope: { kind: "always" },
      }),
      eliasLearnsLate(),
    );

    expect(result.status).toBe("failed");
    // He learns it in scene 6, so scenes 6, 7 and 8 all fail.
    expect(result.failures.map((f) => f.sceneId)).toEqual([
      "SCENE_0006",
      "SCENE_0007",
      "SCENE_0008",
    ]);

    const [failure] = result.failures;
    expect(failure?.chapterId).toBe("CHAPTER_0003");
    expect(failure?.expected).toContain("does not know");
    expect(failure?.actual).toContain("known");
    expect(failure?.evidence).toContain("SCENE_0006");
    expect(failure?.entities).toEqual([ELIAS, VAULT_FACT]);
  });

  it("reads back as the sentence the writer wrote", () => {
    expect(
      describeTest({
        assertion,
        scope: { kind: "before", anchorId: "CHAPTER_0003" as never },
      }),
    ).toBe(`${ELIAS} does not know ${VAULT_FACT}, before CHAPTER_0003`);
  });
});

// ── Every deterministic assertion ────────────────────────────────────────────

describe("deterministic assertions", () => {
  const at = (scope: TestScope) => scope;

  it("decides whether a character knows a fact", () => {
    const state = eliasLearnsLate();
    const knows = runStoryTest(
      test({ kind: "character_knows_fact", characterId: ELIAS, factId: VAULT_FACT } as Assertion, {
        scope: at({ kind: "from", anchorId: "SCENE_0006" as never }),
      }),
      state,
    );
    expect(knows.status).toBe("passed");

    const early = runStoryTest(
      test({ kind: "character_knows_fact", characterId: ELIAS, factId: VAULT_FACT } as Assertion, {
        scope: at({ kind: "at", anchorId: "SCENE_0001" as never }),
      }),
      state,
    );
    expect(early.status).toBe("failed");
    expect(early.failures[0]?.actual).toContain("no recorded position");
  });

  /** Believing something counts as knowing it for the purposes of a test. */
  it("treats a belief as knowledge", () => {
    const state = input([
      transition("SCENE_0002", "knowledge_changed", ELIAS, VAULT_FACT, {
        knowledgeState: "believed",
        sourceType: "told",
        sourceEntityId: MARA,
      }),
    ]);
    const result = runStoryTest(
      test({ kind: "character_knows_fact", characterId: ELIAS, factId: VAULT_FACT } as Assertion, {
        scope: at({ kind: "at", anchorId: "SCENE_0003" as never }),
      }),
      state,
    );
    expect(result.status).toBe("passed");
  });

  it("does not treat a suspicion as knowledge", () => {
    const state = input([
      transition("SCENE_0002", "knowledge_changed", ELIAS, VAULT_FACT, {
        knowledgeState: "suspected",
        sourceType: "inferred",
      }),
    ]);
    const result = runStoryTest(
      test(
        {
          kind: "character_does_not_know_fact",
          characterId: ELIAS,
          factId: VAULT_FACT,
        } as Assertion,
        { scope: at({ kind: "always" }) },
      ),
      state,
    );
    expect(result.status).toBe("passed");
  });

  it("decides whether a character is alive or dead", () => {
    const state = input([transition("SCENE_0004", "character_status", ELIAS, "deceased")]);

    expect(
      runStoryTest(
        test({ kind: "character_alive", characterId: ELIAS } as Assertion, {
          scope: at({ kind: "before", anchorId: "SCENE_0004" as never }),
        }),
        state,
      ).status,
    ).toBe("passed");

    const dead = runStoryTest(
      test({ kind: "character_dead", characterId: ELIAS } as Assertion, {
        scope: at({ kind: "from", anchorId: "SCENE_0004" as never }),
      }),
      state,
    );
    expect(dead.status).toBe("passed");

    const wrong = runStoryTest(
      test({ kind: "character_alive", characterId: ELIAS } as Assertion, {
        scope: at({ kind: "always" }),
      }),
      state,
    );
    expect(wrong.failures[0]?.actual).toBe(`${ELIAS} is deceased`);
  });

  /** `inactive` is off-page, not dead. */
  it("counts an inactive character as alive", () => {
    const state = input([transition("SCENE_0002", "character_status", ELIAS, "inactive")]);
    expect(
      runStoryTest(test({ kind: "character_alive", characterId: ELIAS } as Assertion), state)
        .status,
    ).toBe("passed");
  });

  it("decides where a character is", () => {
    const state = input([
      transition("SCENE_0002", "character_location", ELIAS, FLAT),
      transition("SCENE_0005", "character_location", ELIAS, MANOR),
    ]);

    expect(
      runStoryTest(
        test({ kind: "character_at_location", characterId: ELIAS, locationId: FLAT } as Assertion, {
          scope: at({
            kind: "between",
            anchorId: "SCENE_0002" as never,
            untilId: "SCENE_0004" as never,
          }),
        }),
        state,
      ).status,
    ).toBe("passed");

    const moved = runStoryTest(
      test({ kind: "character_at_location", characterId: ELIAS, locationId: FLAT } as Assertion, {
        scope: at({ kind: "at", anchorId: "SCENE_0005" as never }),
      }),
      state,
    );
    expect(moved.status).toBe("failed");
    expect(moved.failures[0]?.actual).toBe(`${ELIAS} is at ${MANOR}`);
    expect(moved.failures[0]?.evidence).toContain("Presence: present");
  });

  it("follows a carried object to its holder", () => {
    const state = input([
      transition("SCENE_0001", "object_location", REVOLVER, FLAT),
      transition("SCENE_0002", "object_holder", REVOLVER, ELIAS),
      transition("SCENE_0002", "character_location", ELIAS, FLAT),
      transition("SCENE_0004", "character_location", ELIAS, MANOR),
    ]);

    const result = runStoryTest(
      test({ kind: "object_at_location", objectId: REVOLVER, locationId: MANOR } as Assertion, {
        scope: at({ kind: "from", anchorId: "SCENE_0004" as never }),
      }),
      state,
    );
    expect(result.status).toBe("passed");
    expect(
      runStoryTest(
        test({ kind: "object_at_location", objectId: REVOLVER, locationId: FLAT } as Assertion, {
          scope: at({ kind: "at", anchorId: "SCENE_0004" as never }),
        }),
        state,
      ).failures[0]?.evidence,
    ).toContain("Carried by");
  });

  /** Ownership survives theft; the evidence says so, so a failure is legible. */
  it("separates ownership from possession", () => {
    const state = input([
      transition("SCENE_0001", "object_owner", REVOLVER, ELIAS),
      transition("SCENE_0003", "object_holder", REVOLVER, MARA),
    ]);

    expect(
      runStoryTest(
        test({ kind: "object_owned_by", objectId: REVOLVER, characterId: ELIAS } as Assertion),
        state,
      ).status,
    ).toBe("passed");

    const wrong = runStoryTest(
      test({ kind: "object_owned_by", objectId: REVOLVER, characterId: MARA } as Assertion, {
        scope: at({ kind: "at", anchorId: "SCENE_0003" as never }),
      }),
      state,
    );
    expect(wrong.failures[0]?.evidence).toContain(`Held by ${MARA}`);
    expect(wrong.failures[0]?.evidence).toContain("survives theft");
  });

  it("decides a plot thread's status", () => {
    const state = input([
      transition("SCENE_0002", "thread_appearance", PHOTO_THREAD, "introduces"),
      transition("SCENE_0006", "thread_appearance", PHOTO_THREAD, "resolves"),
    ]);

    expect(
      runStoryTest(
        test(
          { kind: "plot_thread_status", threadId: PHOTO_THREAD, status: "resolved" } as Assertion,
          {
            scope: at({ kind: "from", anchorId: "SCENE_0006" as never }),
          },
        ),
        state,
      ).status,
    ).toBe("passed");

    const early = runStoryTest(
      test(
        { kind: "plot_thread_status", threadId: PHOTO_THREAD, status: "resolved" } as Assertion,
        {
          scope: at({ kind: "at", anchorId: "SCENE_0003" as never }),
        },
      ),
      state,
    );
    expect(early.failures[0]?.actual).toContain("introduced");
  });

  it("decides whether a fact is true yet", () => {
    const state = input([transition("SCENE_0004", "fact_established", VAULT_FACT, VAULT_FACT)]);
    expect(
      runStoryTest(
        test({ kind: "fact_true", factId: VAULT_FACT } as Assertion, {
          scope: at({ kind: "from", anchorId: "SCENE_0004" as never }),
        }),
        state,
      ).status,
    ).toBe("passed");
    expect(
      runStoryTest(
        test({ kind: "fact_true", factId: VAULT_FACT } as Assertion, {
          scope: at({ kind: "at", anchorId: "SCENE_0001" as never }),
        }),
        state,
      ).failures[0]?.actual,
    ).toContain("not yet established");
  });

  it("decides a relationship's status", () => {
    const state = input([transition("SCENE_0005", "relationship_status", REL, "hostile")]);

    expect(
      runStoryTest(
        test({ kind: "relationship_status", relationshipId: REL, status: "wary" } as Assertion, {
          scope: at({ kind: "before", anchorId: "SCENE_0005" as never }),
        }),
        state,
      ).status,
    ).toBe("passed");

    const later = runStoryTest(
      test({ kind: "relationship_status", relationshipId: REL, status: "wary" } as Assertion, {
        scope: at({ kind: "at", anchorId: "SCENE_0005" as never }),
      }),
      state,
    );
    expect(later.failures[0]?.actual).toBe(`${REL} is "hostile"`);
  });

  it("says plainly when a test names a relationship the project lacks", () => {
    const result = runStoryTest(
      test(
        { kind: "relationship_status", relationshipId: "REL_9999", status: "warm" } as Assertion,
        {
          scope: at({ kind: "at", anchorId: "SCENE_0001" as never }),
        },
      ),
      input(),
    );
    expect(result.status).toBe("failed");
    expect(result.failures[0]?.actual).toContain("does not exist");
  });
});

// ── Skipped, errored, and the semantic boundary ──────────────────────────────

describe("tests that are not simply pass or fail", () => {
  it("reports a disabled test as skipped, not as passing", () => {
    const result = runStoryTest(
      test({ kind: "character_alive", characterId: ELIAS } as Assertion, { enabled: false }),
      input(),
    );
    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("disabled");
    expect(result.checkedScenes).toEqual([]);
  });

  it("reports a broken scope as errored, not as failing", () => {
    const result = runStoryTest(
      test({ kind: "character_alive", characterId: ELIAS } as Assertion, {
        scope: { kind: "at", anchorId: "SCENE_9999" as never },
      }),
      input(),
    );
    expect(result.status).toBe("errored");
    expect(result.reason).toContain("not a scene or a chapter");
  });

  /**
   * The boundary the phase exists to draw: a semantic test is *not evaluated*.
   * An unanswered question is not a satisfied one.
   */
  it("never reports a semantic test as passing", () => {
    const result = runStoryTest(
      test({ kind: "free_form", statement: "The romance should feel slow-burn." } as Assertion, {
        type: "semantic",
        name: "Slow burn",
      }),
      input(),
    );
    expect(result.status).toBe("not_evaluated");
    expect(result.reason).toContain("model judgement");
    expect(result.failures).toEqual([]);
  });

  it("keeps semantic assertions out of the deterministic tally", () => {
    const state = input();
    const summary = runStoryTests({
      ...state,
      tests: [
        test({ kind: "character_alive", characterId: ELIAS } as Assertion),
        test(
          { kind: "character_disposition", characterId: ELIAS, expected: "guarded" } as Assertion,
          {
            type: "semantic",
          },
        ),
        test({ kind: "character_dead", characterId: ELIAS } as Assertion, { enabled: false }),
      ],
    });

    expect(summary.deterministic).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(summary.semantic).toEqual({ total: 1, notEvaluated: 1 });
    expect(summary.skipped).toBe(1);
    expect(summary.errored).toBe(0);
  });
});

// ── The suite as a whole ─────────────────────────────────────────────────────

describe("running a suite", () => {
  it("counts passes and failures separately from everything else", () => {
    const state = eliasLearnsLate();
    const summary = runStoryTests({
      ...state,
      tests: [
        test(
          {
            kind: "character_does_not_know_fact",
            characterId: ELIAS,
            factId: VAULT_FACT,
          } as Assertion,
          { scope: { kind: "before", anchorId: "CHAPTER_0003" as never } },
        ),
        test(
          {
            kind: "character_does_not_know_fact",
            characterId: ELIAS,
            factId: VAULT_FACT,
          } as Assertion,
          { scope: { kind: "always" } },
        ),
        test({ kind: "character_alive", characterId: ELIAS } as Assertion),
      ],
    });

    expect(summary.deterministic).toEqual({ total: 3, passed: 2, failed: 1 });
    expect(summary.results).toHaveLength(3);
  });

  it("is reproducible for a given project state", () => {
    const state = eliasLearnsLate();
    const tests = [test({ kind: "character_alive", characterId: ELIAS } as Assertion)];
    expect(runStoryTests({ ...state, tests })).toEqual(runStoryTests({ ...state, tests }));
  });
});

// ── Inside a build ───────────────────────────────────────────────────────────

describe("story tests in a build", () => {
  const failing = test(
    { kind: "character_does_not_know_fact", characterId: ELIAS, factId: VAULT_FACT } as Assertion,
    { name: "Elias must not know the vault fact", severity: "error" },
  );

  const contextWith = (tests: readonly StoryTest[]) =>
    buildContext({
      scenes: SCENES,
      transitions: [
        transition("SCENE_0006", "knowledge_changed", ELIAS, VAULT_FACT, {
          knowledgeState: "known",
          sourceType: "witnessed",
        }),
      ],
      storyTests: tests,
      relationships: RELATIONSHIPS as never,
    });

  it("reports the suite separately from the rules", async () => {
    const build = await buildStory(CORE_RULES, contextWith([failing]));

    expect(build.tests.deterministic).toEqual({ total: 1, passed: 0, failed: 1 });
    expect(build.tests.results[0]?.name).toBe("Elias must not know the vault fact");
  });

  it("also surfaces each failure as a navigable diagnostic", async () => {
    const build = await buildStory(CORE_RULES, contextWith([failing]));
    const found = build.diagnostics.filter((d) => d.ruleId === "story_tests");

    expect(found).toHaveLength(3);
    const [first] = found;
    expect(first?.severity).toBe("error");
    expect(first?.message).toContain("Elias must not know the vault fact");
    expect(first?.message).toContain("expected");
    expect(first?.sceneId).toBe("SCENE_0006");
    expect(first?.entities).toContain(ELIAS);
    expect(first?.entities).toContain(failing.id as string);
    expect(build.status).toBe("failed");
  });

  it("carries the test's own severity, not one the compiler chose", async () => {
    const gentle = { ...failing, severity: "warning" } as StoryTest;
    const build = await buildStory(CORE_RULES, contextWith([gentle]));

    expect(build.diagnostics.filter((d) => d.ruleId === "story_tests")[0]?.severity).toBe(
      "warning",
    );
    expect(build.status).toBe("passed_with_warnings");
  });

  it("never turns a semantic test into a diagnostic", async () => {
    const semantic = test(
      { kind: "free_form", statement: "The romance should feel slow-burn." } as Assertion,
      { type: "semantic" },
    );
    const build = await buildStory(CORE_RULES, contextWith([semantic]));

    expect(build.diagnostics.filter((d) => d.ruleId === "story_tests")).toEqual([]);
    expect(build.tests.semantic.notEvaluated).toBe(1);
    expect(build.status).toBe("passed");
  });

  it("reports a broken test as a warning about the test, not about the story", async () => {
    const broken = test({ kind: "character_alive", characterId: ELIAS } as Assertion, {
      scope: { kind: "at", anchorId: "SCENE_9999" as never },
      name: "Broken scope",
    });
    const build = await buildStory(CORE_RULES, contextWith([broken]));

    const [diagnostic] = build.diagnostics.filter((d) => d.ruleId === "story_tests");
    expect(diagnostic?.severity).toBe("warning");
    expect(diagnostic?.message).toContain("could not run");
    expect(diagnostic?.suggestedAction).toContain("Correct the test's scope");
  });

  it("says nothing at all when a project has no tests", async () => {
    const build = await buildStory(CORE_RULES, contextWith([]));
    expect(build.tests.deterministic.total).toBe(0);
    expect(build.rules.find((r) => r.ruleId === "story_tests")?.status).toBe("passed");
  });
});
