import { describeTest, type StoryTest } from "@jellytind/domain";
import type { LanguageModel, OutputSchema } from "@jellytind/model-router";
import { resolveScope } from "../story-tests";
import { excerpt, shorten } from "./text";
import type {
  SemanticBuildContext,
  SemanticConfidence,
  SemanticTestResult,
  SemanticTestRun,
  SemanticTestVerdict,
} from "./types";
import { semanticTests } from "./types";

/**
 * Semantic story tests (Phase 37 §18–19): the scaffolded architecture, now
 * evaluated.
 *
 * A semantic test is a writer's intention no recorded state can decide —
 * *the romance should stay slow-burn*, *Elias should remain guarded*. The
 * verdicts are deliberately not booleans: PASS, CONCERN, or INCONCLUSIVE,
 * because a judgement can be honestly undecided and pretending otherwise is
 * the failure this product exists to avoid. Every result preserves what was
 * analysed, what was sent, what the model said, and how sure it was (§19).
 */

interface TestOutput {
  readonly verdict: string;
  readonly judgement: string;
  readonly sceneIds: readonly string[];
  readonly notes: readonly string[];
  readonly uncertainty: string;
}

const TEST_SCHEMA: OutputSchema<TestOutput> = {
  name: "SemanticTestJudgement",
  parse(value: unknown): TestOutput {
    if (typeof value !== "object" || value === null) throw new Error("Expected an object.");
    const record = value as Record<string, unknown>;
    const strings = (input: unknown): string[] =>
      Array.isArray(input) ? input.filter((item): item is string => typeof item === "string") : [];
    return {
      verdict: String(record.verdict ?? ""),
      judgement: String(record.judgement ?? ""),
      sceneIds: strings(record.sceneIds),
      notes: strings(record.notes),
      uncertainty: String(record.uncertainty ?? "medium"),
    };
  },
};

const VERDICTS = new Set(["pass", "concern", "inconclusive"]);
const CONFIDENCES = new Set(["low", "medium", "high"]);

/**
 * The material for one test: the scope's scenes with bounded excerpts, the
 * entities the assertion names, and — for reader-suspicion tests — what the
 * simulated readers actually reported, labelled as simulation.
 */
function testContext(
  test: StoryTest,
  sceneIds: readonly string[],
  context: SemanticBuildContext,
): string {
  const lines: string[] = [];
  const assertion = test.assertion as unknown as Record<string, unknown>;

  const characterId = typeof assertion.characterId === "string" ? assertion.characterId : null;
  if (characterId !== null) {
    const character = context.characters.find((held) => held.id === characterId);
    if (character !== undefined) lines.push(`CHARACTER ${characterId}: ${character.name}`);
  }
  const relationshipId =
    typeof assertion.relationshipId === "string" ? assertion.relationshipId : null;
  if (relationshipId !== null) {
    const relationship = context.relationships.find((held) => held.id === relationshipId);
    if (relationship !== undefined) {
      lines.push(
        `RELATIONSHIP ${relationshipId}: ${relationship.characterAId as string} · ${relationship.characterBId as string}`,
      );
    }
  }

  if (test.assertion.kind === "reader_suspicion") {
    for (const simulation of context.readerSimulations) {
      if (simulation.status !== "completed") continue;
      for (const reading of simulation.readings) {
        const suspicion = reading.state.suspicions.find(
          (attitude) => attitude.subject === characterId,
        );
        if (suspicion !== undefined) {
          lines.push(
            `SIMULATED READER "${simulation.profileName}" after ${reading.chapterId}: suspects ${characterId ?? ""} at "${suspicion.level}" — ${shorten(suspicion.because ?? "", 80)} (simulation, not a real reader)`,
          );
        }
      }
    }
  }

  const prose = sceneIds
    .filter((sceneId) => (context.prose[sceneId] ?? "").length > 0)
    .slice(0, 12)
    .map((sceneId) => `SCENE ${sceneId}\n${excerpt(context.prose[sceneId] ?? "", 250)}`);
  return [...lines, ...prose].join("\n\n");
}

export async function runSemanticStoryTests(input: {
  readonly tests: readonly StoryTest[];
  readonly context: SemanticBuildContext;
  readonly model: LanguageModel | null;
  /** Restrict to these scenes (the semantic build's scope), when set. */
  readonly withinSceneIds?: readonly string[];
}): Promise<SemanticTestRun> {
  const results: SemanticTestResult[] = [];

  for (const test of semanticTests(input.tests)) {
    const statement = describeTest(test);
    const base = { testId: test.id as string, name: test.name, statement };

    let scopeScenes: string[];
    try {
      scopeScenes = resolveScope(test.scope, {
        scenes: input.context.scenes,
        chapters: input.context.chapters,
      });
    } catch (cause) {
      results.push({
        ...base,
        verdict: "inconclusive",
        judgement: `The scope could not be resolved: ${cause instanceof Error ? cause.message : String(cause)}`,
        uncertainty: "high",
        scopeSceneIds: [],
        contextSummary: "",
        evidence: { sceneIds: [], entities: [], notes: [] },
      });
      continue;
    }
    if (input.withinSceneIds !== undefined) {
      const within = new Set(input.withinSceneIds);
      scopeScenes = scopeScenes.filter((sceneId) => within.has(sceneId));
    }

    const material = testContext(test, scopeScenes, input.context);
    const contextSummary = `${String(scopeScenes.length)} scene(s) in scope; ${String(material.split("\n\n").length)} block(s) of material sent`;

    if (input.model === null || scopeScenes.length === 0 || material === "") {
      // An unanswered question is not a satisfied one (§18).
      results.push({
        ...base,
        verdict: "inconclusive",
        judgement:
          input.model === null
            ? "No model is available to make this judgement."
            : "The scope contains nothing to judge yet.",
        uncertainty: "high",
        scopeSceneIds: scopeScenes,
        contextSummary,
        evidence: { sceneIds: [], entities: [], notes: [] },
      });
      continue;
    }

    try {
      const output = await input.model.generateStructured(
        {
          system:
            'You evaluate a writer\'s stated intention against their manuscript. Verdicts: "pass" (the intention clearly holds), "concern" (specific material works against it), "inconclusive" (the material cannot answer it). Never guess: if you cannot point at evidence, the verdict is inconclusive. Reply with JSON only: {"verdict":"pass|concern|inconclusive","judgement":"two sentences at most","sceneIds":["scenes your judgement rests on"],"notes":["concrete observations"],"uncertainty":"low|medium|high"}.',
          messages: [{ role: "user", content: `THE INTENTION\n${statement}\n\n${material}` }],
          schema: TEST_SCHEMA,
          maxOutputTokens: 800,
        },
        { timeoutMs: 120_000 },
      );
      const verdict = (
        VERDICTS.has(output.verdict) ? output.verdict : "inconclusive"
      ) as SemanticTestVerdict;
      const sceneIds = output.sceneIds.filter((sceneId) => scopeScenes.includes(sceneId));
      results.push({
        ...base,
        // A concern with no evidence at all degrades to inconclusive (§4).
        verdict:
          verdict === "concern" && sceneIds.length === 0 && output.notes.length === 0
            ? "inconclusive"
            : verdict,
        judgement: output.judgement,
        uncertainty: (CONFIDENCES.has(output.uncertainty)
          ? output.uncertainty
          : "medium") as SemanticConfidence,
        scopeSceneIds: scopeScenes,
        contextSummary,
        evidence: { sceneIds, entities: [], notes: output.notes },
        modelId: input.model.id,
      });
    } catch (cause) {
      results.push({
        ...base,
        verdict: "inconclusive",
        judgement: `The judgement could not be made: ${cause instanceof Error ? cause.message : String(cause)}`,
        uncertainty: "high",
        scopeSceneIds: scopeScenes,
        contextSummary,
        evidence: { sceneIds: [], entities: [], notes: [] },
      });
    }
  }

  return {
    total: results.length,
    pass: results.filter((result) => result.verdict === "pass").length,
    concern: results.filter((result) => result.verdict === "concern").length,
    inconclusive: results.filter((result) => result.verdict === "inconclusive").length,
    results,
  };
}
