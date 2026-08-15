import { describe, expect, it } from "vitest";
import type {
  Chapter,
  Character,
  Decision,
  ReaderSimulation,
  Scene,
  Setup,
  StoryTest,
  VoiceRule,
} from "@jellytind/domain";
import type {
  GenerateRequest,
  LanguageModel,
  RequestOptions,
  StructuredRequest,
} from "@jellytind/model-router";
import { MockLanguageModel } from "@jellytind/model-router";
import { debugQuestionFor, runSemanticBuild, type SemanticCacheEntry } from "./build";
import { HEURISTIC_RULES } from "./heuristics";
import { JUDGEMENT_RULES } from "./judgements";
import { runSemanticStoryTests } from "./tests";
import type { SemanticBuildContext, SemanticFinding, SemanticStatusEntry } from "./types";

/**
 * Phase 37 §20 — the acceptance scenario.
 *
 * A fixture manuscript with deliberately engineered semantic problems: two
 * characters with nearly identical dialogue, three scenes with the same beat
 * structure, an early hammered clue, an unsupported decision, and a long
 * tension plateau. Every model reply is scripted — no live call anywhere.
 */

const ALL_RULES = [...HEURISTIC_RULES, ...JUDGEMENT_RULES];

const chapter = (id: string, order: number, title: string): Chapter =>
  ({ id, title, order, filePath: `manuscript/${id}.md`, status: "drafted" }) as unknown as Chapter;

const character = (id: string, name: string): Character =>
  ({ id, name, aliases: [], description: "", role: "", notes: "" }) as unknown as Character;

const scene = (input: {
  id: string;
  chapterId: string;
  order: number;
  title: string;
  purpose?: string[];
  characterIds?: string[];
  plotThreadIds?: string[];
}): Scene =>
  ({
    id: input.id,
    chapterId: input.chapterId,
    order: input.order,
    title: input.title,
    purpose: input.purpose ?? [],
    characterIds: input.characterIds ?? [],
    plotThreadIds: input.plotThreadIds ?? [],
  }) as unknown as Scene;

const ELIAS = "CHAR_0001";
const MARCUS = "CHAR_0002";

/** Dialogue engineered to be nearly identical between the two of them. */
const twinDialogue = (a: string, b: string): string =>
  `${a} arrived at the house before dusk. "No. Not yet. Can't." said Elias. ` +
  `"No. Not now. Won't." said Marcus. They argued about the debt while the ` +
  `lamps burned low, the ledger of the old debt open between them, the ledger of the old debt ` +
  `unread, the ledger of the old debt accusing. ${b} revealed the secret about the cellar. ` +
  `"Fine. Whatever. Done." said Elias. "Fine. Whatever. Gone." said Marcus. Then they left angry.`;

const QUIET = (index: number): string =>
  `The house settled in the scene ${String(index)} evening. Nothing pressed and nobody argued. ` +
  `Tea went cold on the sill while the light moved slowly across the same floorboards as before.`;

function fixture(overrides: Partial<SemanticBuildContext> = {}): SemanticBuildContext {
  const chapters = [chapter("CH_0001", 1, "The Debt"), chapter("CH_0002", 2, "The Wait")];
  const scenes = [
    // §20: repeated scene structure — arrive / argue / reveal / leave, thrice.
    ...[1, 2, 3].map((index) =>
      scene({
        id: `SCENE_000${String(index)}`,
        chapterId: "CH_0001",
        order: index,
        title: `Visit ${String(index)}`,
        purpose: ["arrive at the house", "argue about the debt", "reveal a secret", "leave angry"],
        characterIds: [ELIAS, MARCUS],
      }),
    ),
    // §20: a long tension plateau — four quiet scenes in a row.
    ...[4, 5, 6, 7].map((index) =>
      scene({
        id: `SCENE_000${String(index)}`,
        chapterId: "CH_0002",
        order: index,
        title: `Waiting ${String(index)}`,
        purpose: [],
        characterIds: [ELIAS],
      }),
    ),
  ];
  const prose: Record<string, string> = {
    SCENE_0001: twinDialogue("Elias", "Marcus"),
    SCENE_0002: twinDialogue("Marcus", "Elias"),
    SCENE_0003: twinDialogue("Elias", "Marcus"),
    SCENE_0004: QUIET(4),
    SCENE_0005: QUIET(5),
    SCENE_0006:
      QUIET(6) +
      " Without a word of why, Elias decided to sign the house over to the man he distrusted most.",
    SCENE_0007: QUIET(7),
  };
  const setups: Setup[] = [
    // §20: an early clue hammered three times despite an intended subtlety.
    {
      id: "SETUP_0001",
      description: "The cellar key hangs behind the portrait",
      setupSceneIds: ["SCENE_0001", "SCENE_0002", "SCENE_0003"],
      payoffSceneIds: [],
      subtlety: "subtle",
    } as unknown as Setup,
  ];
  const decisions: Decision[] = [
    // §20: a decision with no recorded reason and no causal support.
    {
      id: "DEC_0001",
      description: "Sign the house over to Marcus",
      characterId: ELIAS,
      sceneId: "SCENE_0006",
    } as unknown as Decision,
  ];
  return {
    scenes,
    chapters,
    characters: [character(ELIAS, "Elias"), character(MARCUS, "Marcus")],
    relationships: [],
    setups,
    decisions,
    dependencies: [],
    transitions: [],
    prose,
    voice: { rules: [], tendencies: [], samples: [] },
    modules: [],
    readerSimulations: [],
    ...overrides,
  };
}

/** A scripted judge: replies keyed off each rule's system instruction. */
class ScriptedJudge implements LanguageModel {
  readonly id = "mock:judge";
  readonly capabilities = { streaming: true, structuredOutput: true, tools: true };
  readonly systems: string[] = [];
  private readonly fallback = new MockLanguageModel({});

  generateText(request: GenerateRequest, options?: RequestOptions) {
    return this.fallback.generateText(request, options);
  }
  streamText(request: GenerateRequest, options?: RequestOptions) {
    return this.fallback.streamText(request, options);
  }
  runWithTools(request: never, options?: RequestOptions) {
    return this.fallback.runWithTools(request, options);
  }
  generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    const system = request.system ?? "";
    this.systems.push(system);
    const reply = (value: unknown): Promise<T> => Promise.resolve(request.schema.parse(value));
    if (system.includes("narrative tension")) {
      return reply({
        issues: [
          {
            issue: "plateau",
            sceneIds: ["SCENE_0004", "SCENE_0005", "SCENE_0006", "SCENE_0007"],
            note: "Four consecutive scenes hold the same low pressure.",
            confidence: "medium",
          },
        ],
      });
    }
    if (system.includes("planned purpose")) {
      return reply({
        scenes: [
          {
            sceneId: "SCENE_0003",
            accomplished: false,
            note: "The third visit repeats the second; no new secret lands on the page.",
            confidence: "medium",
          },
        ],
      });
    }
    if (system.includes("characters speak")) {
      return reply({
        pairs: [
          {
            characters: [ELIAS, MARCUS],
            converging: true,
            tendencies: ["short declarative three-beat replies", "identical hesitation pattern"],
            sceneIds: ["SCENE_0001", "SCENE_0002", "SCENE_0003"],
            confidence: "medium",
          },
        ],
      });
    }
    if (system.includes("inspect fiction dialogue")) {
      return reply({
        findings: [
          {
            sceneId: "SCENE_0001",
            issue: "similar_cadence",
            quote: "No. Not yet. Can't.",
            note: "Both speakers answer in the same clipped three-beat shape.",
            confidence: "medium",
          },
        ],
      });
    }
    if (system.includes("recorded decision")) {
      return reply({
        decisions: [
          {
            decisionId: "DEC_0001",
            supported: false,
            note: "Nothing in the scene shows pressure or motive for signing the house away.",
            confidence: "high",
          },
        ],
      });
    }
    if (system.includes("planted setups")) {
      return reply({
        setups: [
          {
            setupId: "SETUP_0001",
            verdict: "too_obvious",
            note: "The key behind the portrait is named outright in three consecutive scenes.",
            confidence: "high",
          },
        ],
      });
    }
    if (system.includes("stated intention")) {
      return reply({
        verdict: "concern",
        judgement: "Elias narrates his feelings openly in the waiting scenes.",
        sceneIds: ["SCENE_0005"],
        notes: ["Interior monologue names the fear directly."],
        uncertainty: "medium",
      });
    }
    return reply({});
  }
}

const run = (
  context: SemanticBuildContext,
  options: Partial<Parameters<typeof runSemanticBuild>[0]> = {},
) =>
  runSemanticBuild({
    rules: ALL_RULES,
    context,
    scope: { kind: "book" },
    depth: "full",
    now: () => "2026-08-15T12:00:00Z",
    ...options,
  });

describe("§20 — the acceptance scenario", () => {
  it("full build finds the engineered problems, each with evidence and confidence", async () => {
    const judge = new ScriptedJudge();
    const build = await run(fixture(), { model: judge });

    // 2. Semantic findings appear, across the engineered categories.
    const categories = new Set(build.findings.map((finding) => finding.category));
    expect(categories.has("structure")).toBe(true); // repeated scene shape
    expect(categories.has("pacing")).toBe(true); // tension plateau (heuristic stretch)
    expect(categories.has("tension")).toBe(true); // plateau (model)
    expect(categories.has("character_voice")).toBe(true); // twin dialogue
    expect(categories.has("foreshadowing")).toBe(true); // hammered clue
    expect(categories.has("motivation")).toBe(true); // unsupported decision

    // 1. The deterministic layer stays separate: nothing here is an error.
    for (const finding of build.findings) {
      expect(["heuristic", "model_judgement"]).toContain(finding.kind);
      expect("severity" in finding).toBe(false);
    }

    // 3–4. Every finding carries evidence and a qualitative confidence (§4–5).
    for (const finding of build.findings) {
      expect(finding.evidence.sceneIds.length + finding.evidence.notes.length).toBeGreaterThan(0);
      expect(["low", "medium", "high"]).toContain(finding.confidence);
    }

    // Voice convergence names the pair, the scenes and the shared tendencies (§4).
    const convergence = build.findings.find(
      (finding) => finding.ruleId === "sem_voice_convergence",
    );
    expect(convergence?.evidence.entities).toEqual([ELIAS, MARCUS]);
    expect(convergence?.evidence.sceneIds.length).toBeGreaterThanOrEqual(3);
    expect(convergence?.evidence.notes.some((note) => note.includes("hesitation"))).toBe(true);
    expect(convergence?.modelId).toBe("mock:judge");
  });

  it("quick build runs the heuristics only — zero model calls (§11)", async () => {
    const judge = new ScriptedJudge();
    const build = await run(fixture(), { model: judge, depth: "quick" });
    expect(judge.systems).toHaveLength(0);
    expect(build.findings.every((finding) => finding.kind === "heuristic")).toBe(true);
    const skipped = build.rules.filter((rule) => rule.status === "skipped");
    expect(skipped.some((rule) => rule.reason?.includes("quick build") === true)).toBe(true);
  });

  it("5 — a confirmed Author Voice rule suppresses the intentional-style warning (§7)", async () => {
    const bare = await run(fixture());
    expect(bare.findings.some((finding) => finding.ruleId === "sem_prose_repeated_phrases")).toBe(
      true,
    );

    const voiced = await run(
      fixture({
        voice: {
          rules: [
            {
              id: "VR_0001",
              kind: "prefer",
              category: "prose",
              scope: "project",
              statement: "Deliberate repetition as a refrain is part of this book's voice.",
              enabled: true,
              createdAt: "2026-08-15T00:00:00Z",
            } as unknown as VoiceRule,
          ],
          tendencies: [],
          samples: [],
        },
      }),
    );
    expect(voiced.findings.some((finding) => finding.ruleId === "sem_prose_repeated_phrases")).toBe(
      false,
    );
    const outcome = voiced.rules.find((rule) => rule.ruleId === "sem_prose_repeated_phrases");
    expect(outcome?.reason).toContain("suppressed by your voice rule");
  });

  it("6–7 — an ignored finding stays ignored on rebuild instead of nagging (§14)", async () => {
    const judge = new ScriptedJudge();
    const first = await run(fixture(), { model: judge });
    const target = first.findings.find((finding) => finding.category === "structure");
    expect(target?.status).toBe("open");

    const statuses: Record<string, SemanticStatusEntry> = {
      [target?.id ?? ""]: { status: "ignored", at: "2026-08-15T12:30:00Z" },
    };
    const second = await run(fixture(), { model: new ScriptedJudge(), ports: { statuses } });
    const again = second.findings.find((finding) => finding.id === target?.id);
    expect(again?.status).toBe("ignored");
    // Open counts no longer include it — the §15 numbers stay honest and calm.
    expect(second.counts.structure ?? 0).toBe((first.counts.structure ?? 0) - 1);
  });

  it("8 — a finding becomes a Story Debugger question, evidence attached (§16)", async () => {
    const judge = new ScriptedJudge();
    const build = await run(fixture(), { model: judge });
    const finding = build.findings.find(
      (held): held is SemanticFinding => held.ruleId === "sem_motivation",
    );
    expect(finding).toBeDefined();
    const question = debugQuestionFor(finding as SemanticFinding);
    expect(question).toContain("insufficiently motivated");
    expect(question).toContain("SCENE_0006");
    expect(question).toContain("model judgement");
    expect(question).toContain("Evidence:");
  });

  it("caches judgements against content, rule version and model (§13)", async () => {
    const held = new Map<string, SemanticCacheEntry>();
    const cache = {
      get: (key: string) => Promise.resolve(held.get(key) ?? null),
      set: (key: string, entry: SemanticCacheEntry) => {
        held.set(key, entry);
        return Promise.resolve();
      },
    };
    const first = new ScriptedJudge();
    await run(fixture(), { model: first, ports: { cache } });
    const calls = first.systems.length;
    expect(calls).toBeGreaterThan(0);

    // Unchanged material: everything comes from the cache, nothing is re-bought.
    const second = new ScriptedJudge();
    const rebuilt = await run(fixture(), { model: second, ports: { cache } });
    expect(second.systems).toHaveLength(0);
    expect(rebuilt.rules.some((rule) => rule.status === "cached")).toBe(true);

    // Changed prose: the affected judgements are re-made.
    const third = new ScriptedJudge();
    const changed = fixture();
    await run(
      { ...changed, prose: { ...changed.prose, SCENE_0001: "Rewritten entirely." } },
      { model: third, ports: { cache } },
    );
    expect(third.systems.length).toBeGreaterThan(0);
  });

  it("scene scope reads one scene, not the manuscript (§12)", async () => {
    const judge = new ScriptedJudge();
    const build = await run(fixture(), {
      model: judge,
      scope: { kind: "scene", sceneId: "SCENE_0006" },
    });
    for (const finding of build.findings) {
      for (const sceneId of finding.evidence.sceneIds) {
        expect(sceneId).toBe("SCENE_0006");
      }
    }
  });

  it("genre awareness: the mystery module reframes setup visibility as clue visibility (§8)", async () => {
    const plain = await run(fixture(), { model: new ScriptedJudge() });
    const generic = plain.findings.find(
      (finding) => finding.ruleId === "sem_foreshadow_visibility",
    );
    expect(generic?.message).not.toContain("clue");

    const mystery = await run(fixture({ modules: ["mystery"] }), { model: new ScriptedJudge() });
    const clue = mystery.findings.find((finding) => finding.ruleId === "sem_foreshadow_visibility");
    expect(clue?.message).toContain("clue");
  });

  it("reader simulations strengthen pacing evidence, labelled as simulation (§9)", async () => {
    const simulation = {
      id: "SIM_1",
      profileId: "p",
      profileName: "The impatient reader",
      status: "completed",
      chapterIds: ["CH_0002"],
      readings: [
        {
          chapterId: "CH_0002",
          position: 2,
          understanding: "",
          bored: ["The waiting scenes blur together."],
          interested: [],
          confusedBy: [],
          emotionalMoments: [],
          state: {
            known: [],
            remembered: [],
            suspicions: [],
            trust: [],
            attachment: [],
            predictions: [],
            questions: [],
            confusion: "none",
            interest: "low",
            emotionalResponse: "",
          },
          exposure: {
            chapterId: "CH_0002",
            chapterTitle: "The Wait",
            position: 2,
            sceneIds: [],
            charactersMet: [],
            factsOnPage: [],
            threadsSeen: [],
            words: 0,
          },
          fingerprint: "f",
          createdAt: "2026-08-15T00:00:00Z",
        },
      ],
      startedAt: "2026-08-15T00:00:00Z",
      rerunCount: 0,
    } as unknown as ReaderSimulation;

    const build = await run(fixture({ readerSimulations: [simulation] }));
    const stretch = build.findings.find((finding) => finding.ruleId === "sem_pacing_low_conflict");
    expect(
      stretch?.evidence.notes.some((note) => note.includes("simulation, not a real reader")),
    ).toBe(true);
    expect(stretch?.confidence).toBe("medium");
  });

  it("disabled rules are skipped and say so (§6)", async () => {
    const build = await run(fixture(), {
      config: { disabledRules: ["sem_structure_beats"] },
    });
    expect(build.findings.some((finding) => finding.ruleId === "sem_structure_beats")).toBe(false);
    const outcome = build.rules.find((rule) => rule.ruleId === "sem_structure_beats");
    expect(outcome?.status).toBe("skipped");
    expect(outcome?.reason).toContain("disabled");
  });
});

describe("§18–19 — semantic story tests", () => {
  const guarded: StoryTest = {
    id: "TEST_0001",
    name: "Elias stays guarded",
    description: "",
    type: "semantic",
    scope: { kind: "always" },
    enabled: true,
    severity: "warning",
    assertion: {
      kind: "character_disposition",
      characterId: ELIAS,
      expected: "emotionally guarded",
    },
    createdAt: "2026-08-15T00:00:00Z",
  } as unknown as StoryTest;

  it("returns pass / concern / inconclusive with the judgement's full record", async () => {
    const judge = new ScriptedJudge();
    const runResult = await runSemanticStoryTests({
      tests: [guarded],
      context: fixture(),
      model: judge,
    });
    expect(runResult.total).toBe(1);
    expect(runResult.concern).toBe(1);
    const result = runResult.results[0];
    expect(result?.verdict).toBe("concern");
    expect(result?.judgement).toContain("narrates his feelings");
    expect(result?.uncertainty).toBe("medium");
    expect(result?.scopeSceneIds.length).toBeGreaterThan(0);
    expect(result?.contextSummary).toContain("scene(s) in scope");
    expect(result?.evidence.sceneIds).toContain("SCENE_0005");
    expect(result?.modelId).toBe("mock:judge");
  });

  it("is honestly inconclusive with no model — never a silent pass", async () => {
    const runResult = await runSemanticStoryTests({
      tests: [guarded],
      context: fixture(),
      model: null,
    });
    expect(runResult.results[0]?.verdict).toBe("inconclusive");
    expect(runResult.results[0]?.judgement).toContain("No model");
  });
});
