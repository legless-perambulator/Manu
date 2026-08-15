import { heuristicRule, voiceSanctions } from "./registry";
import {
  dialogueRatio,
  emotionalTells,
  filteringCount,
  ngramCounts,
  shorten,
  wordsOf,
} from "./text";
import type {
  RuleRun,
  SemanticBuildContext,
  SemanticCompilerRule,
  SemanticFindingDraft,
  SemanticTarget,
} from "./types";

/**
 * The light semantic rules: fixed procedures over the text, no model, run in
 * Quick builds. Their findings are HEURISTIC — a repeated phrase can be a
 * defect or a drumbeat, and the compiler does not pretend to know which.
 */

const orderedScenes = (context: SemanticBuildContext, target: SemanticTarget) =>
  target.sceneIds
    .map((sceneId) => context.scenes.find((scene) => scene.id === sceneId))
    .filter((scene): scene is NonNullable<typeof scene> => scene !== undefined);

const proseOf = (context: SemanticBuildContext, sceneId: string): string =>
  context.prose[sceneId] ?? "";

// ── Prose ────────────────────────────────────────────────────────────────────

export const repeatedPhrases: SemanticCompilerRule = heuristicRule({
  id: "sem_prose_repeated_phrases",
  name: "Repeated phrases",
  version: 1,
  category: "prose",
  description: "The same multi-word phrase recurring often across the analysed scenes.",
  run(context, target): RuleRun {
    // §7: a writer who has said repetition is their style is not warned about
    // repetition. The finding is suppressed, and the run says so.
    const sanction = voiceSanctions(
      context.voice,
      ["prose", "sentence_structure"],
      ["repetition", "repeated", "refrain", "echo", "anaphora"],
    );

    const combined = target.sceneIds.map((sceneId) => proseOf(context, sceneId)).join("\n");
    const counts = ngramCounts(combined, 4);
    const offenders = [...counts.entries()]
      .filter(([, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    if (offenders.length === 0) return { findings: [] };
    if (sanction !== null) {
      return {
        findings: [],
        note: `${String(offenders.length)} repeated-phrase finding(s) suppressed by ${sanction}`,
      };
    }
    const inScenes = target.sceneIds.filter((sceneId) =>
      offenders.some(([gram]) => proseOf(context, sceneId).toLowerCase().includes(gram)),
    );
    return {
      findings: [
        {
          category: "prose",
          kind: "heuristic",
          message: "The same phrasing recurs across these scenes.",
          evidence: {
            sceneIds: inScenes,
            entities: [],
            notes: offenders.map(([gram, count]) => `"${gram}" appears ${String(count)} times`),
          },
          confidence: offenders[0] !== undefined && offenders[0][1] >= 5 ? "high" : "medium",
          suggestedAction: "Read the occurrences together and keep the one that earns it.",
        },
      ],
    };
  },
});

export const filteringLanguage: SemanticCompilerRule = heuristicRule({
  id: "sem_prose_filtering",
  name: "Filtering language",
  version: 1,
  category: "prose",
  description: "Perception reported through “saw / felt / noticed” instead of rendered directly.",
  run(context, target): RuleRun {
    const findings: SemanticFindingDraft[] = [];
    for (const sceneId of target.sceneIds) {
      const prose = proseOf(context, sceneId);
      const words = wordsOf(prose).length;
      if (words < 120) continue;
      const { count, examples } = filteringCount(prose);
      const per1k = (count / words) * 1_000;
      if (per1k < 14) continue;
      findings.push({
        category: "prose",
        kind: "heuristic",
        message: "A high share of this scene's perception arrives through filter verbs.",
        evidence: {
          sceneIds: [sceneId],
          entities: [],
          notes: [
            `${String(count)} filtering constructions in ${String(words)} words`,
            ...examples,
          ],
        },
        confidence: per1k >= 22 ? "medium" : "low",
        key: sceneId,
        suggestedAction: "Consider rendering the observed thing rather than the observing.",
      });
    }
    return { findings };
  },
});

export const emotionalTellRepetition: SemanticCompilerRule = heuristicRule({
  id: "sem_prose_emotional_tells",
  name: "Repeated emotional tells",
  version: 1,
  category: "prose",
  description: "The same body-reaction shorthand carrying emotion again and again.",
  run(context, target): RuleRun {
    const combined = target.sceneIds.map((sceneId) => proseOf(context, sceneId)).join("\n");
    const tells = [...emotionalTells(combined).entries()].filter(([, count]) => count >= 3);
    if (tells.length === 0) return { findings: [] };
    const inScenes = target.sceneIds.filter((sceneId) =>
      tells.some(([tell]) => proseOf(context, sceneId).toLowerCase().includes(tell)),
    );
    return {
      findings: [
        {
          category: "prose",
          kind: "heuristic",
          message: "Emotion keeps arriving through the same physical tell.",
          evidence: {
            sceneIds: inScenes,
            entities: [],
            notes: tells.map(([tell, count]) => `"${tell}" — ${String(count)} times`),
          },
          confidence: "medium",
        },
      ],
    };
  },
});

export const sentenceOpenings: SemanticCompilerRule = heuristicRule({
  id: "sem_prose_sentence_openings",
  name: "Repeated sentence openings",
  version: 1,
  category: "prose",
  description: "Runs of consecutive sentences opening on the same word.",
  run(context, target): RuleRun {
    const sanction = voiceSanctions(
      context.voice,
      ["prose", "sentence_structure"],
      ["fragment", "repetition", "anaphora", "staccato", "sparse"],
    );
    const findings: SemanticFindingDraft[] = [];
    let suppressed = 0;
    for (const sceneId of target.sceneIds) {
      const prose = proseOf(context, sceneId);
      const openings = prose
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => (wordsOf(sentence)[0] ?? "").toLowerCase())
        .filter((word) => word !== "");
      let run = 1;
      for (let i = 1; i <= openings.length; i += 1) {
        if (i < openings.length && openings[i] === openings[i - 1]) {
          run += 1;
          continue;
        }
        if (run >= 4 && openings[i - 1] !== undefined) {
          if (sanction !== null) {
            suppressed += 1;
          } else {
            findings.push({
              category: "prose",
              kind: "heuristic",
              message: `A run of ${String(run)} sentences opens on "${openings[i - 1] ?? ""}".`,
              evidence: {
                sceneIds: [sceneId],
                entities: [],
                notes: [`${String(run)} consecutive sentences share their first word`],
              },
              confidence: "medium",
              key: `${sceneId}:${openings[i - 1] ?? ""}`,
            });
          }
        }
        run = 1;
      }
    }
    return {
      findings,
      ...(suppressed > 0
        ? {
            note: `${String(suppressed)} opening-repetition finding(s) suppressed by ${voiceSanctions(context.voice, ["prose", "sentence_structure"], ["fragment", "repetition", "anaphora", "staccato", "sparse"]) ?? "your voice"}`,
          }
        : {}),
    };
  },
});

// ── Pacing ───────────────────────────────────────────────────────────────────

export const sceneRhythm: SemanticCompilerRule = heuristicRule({
  id: "sem_pacing_scene_rhythm",
  name: "Repeated scene rhythm",
  version: 1,
  category: "pacing",
  description: "Adjacent scenes with near-identical length and dialogue balance.",
  run(context, target): RuleRun {
    const scenes = orderedScenes(context, target);
    const shapes = scenes.map((scene) => {
      const prose = proseOf(context, scene.id as string);
      return {
        sceneId: scene.id as string,
        words: wordsOf(prose).length,
        dialogue: dialogueRatio(prose),
      };
    });
    const alike = (a: (typeof shapes)[number], b: (typeof shapes)[number]): boolean =>
      a.words > 100 &&
      b.words > 100 &&
      Math.abs(a.words - b.words) / Math.max(a.words, b.words) <= 0.2 &&
      Math.abs(a.dialogue - b.dialogue) <= 0.12;

    let run: (typeof shapes)[number][] = [];
    const findings: SemanticFindingDraft[] = [];
    const flush = (): void => {
      if (run.length >= 3) {
        findings.push({
          category: "pacing",
          kind: "heuristic",
          message: `${String(run.length)} consecutive scenes share almost the same length and dialogue balance.`,
          evidence: {
            sceneIds: run.map((shape) => shape.sceneId),
            entities: [],
            notes: run.map(
              (shape) =>
                `${shape.sceneId}: ${String(shape.words)} words, ${String(Math.round(shape.dialogue * 100))}% dialogue`,
            ),
          },
          confidence: run.length >= 4 ? "medium" : "low",
          key: run[0]?.sceneId ?? "",
          suggestedAction: "Varying one scene's shape may reset the rhythm.",
        });
      }
      run = [];
    };
    for (const shape of shapes) {
      const last = run.at(-1);
      if (last === undefined || alike(last, shape)) run.push(shape);
      else {
        flush();
        run = [shape];
      }
    }
    flush();
    return { findings };
  },
});

export const lowConflictStretch: SemanticCompilerRule = heuristicRule({
  id: "sem_pacing_low_conflict",
  name: "Low-conflict stretch",
  version: 1,
  category: "pacing",
  description: "A long run of scenes where no thread moves and no state changes.",
  run(context, target): RuleRun {
    const scenes = orderedScenes(context, target);
    const touched = new Set(context.transitions.map((transition) => transition.sceneId));
    const quiet = (sceneId: string): boolean => {
      const scene = context.scenes.find((held) => held.id === sceneId);
      const threads = (scene?.plotThreadIds ?? []).length;
      return threads === 0 && !touched.has(sceneId);
    };

    let run: string[] = [];
    const findings: SemanticFindingDraft[] = [];
    const flush = (): void => {
      if (run.length >= 4) {
        const notes = [
          `${String(run.length)} consecutive scenes advance no plot thread and record no state change`,
        ];
        // §9: simulated readers may strengthen the structural evidence — and
        // are always labelled as simulations, never as real readers.
        const chapterIds = new Set<string>(
          run
            .map(
              (sceneId) =>
                context.scenes.find((scene) => scene.id === sceneId)?.chapterId as
                  string | undefined,
            )
            .filter((chapterId): chapterId is string => typeof chapterId === "string"),
        );
        for (const simulation of context.readerSimulations) {
          if (simulation.status !== "completed") continue;
          for (const reading of simulation.readings) {
            if (!chapterIds.has(reading.chapterId) || reading.bored.length === 0) continue;
            notes.push(
              `Simulated reader "${simulation.profileName}" reported boredom in ${reading.chapterId}: ${shorten(reading.bored[0] ?? "", 70)} (simulation, not a real reader)`,
            );
          }
        }
        findings.push({
          category: "pacing",
          kind: "heuristic",
          message: `An unusually long low-conflict stretch: ${String(run.length)} quiet scenes in a row.`,
          evidence: { sceneIds: [...run], entities: [], notes },
          confidence: notes.length > 1 ? "medium" : "low",
          key: run[0] ?? "",
        });
      }
      run = [];
    };
    for (const scene of scenes) {
      if (quiet(scene.id as string)) run.push(scene.id as string);
      else flush();
    }
    flush();
    return { findings };
  },
});

// ── Structure ────────────────────────────────────────────────────────────────

export const beatRepetition: SemanticCompilerRule = heuristicRule({
  id: "sem_structure_beats",
  name: "Structural repetition",
  version: 1,
  category: "structure",
  description: "Adjacent scenes following the same beat pattern (arrive, argue, reveal, leave…).",
  run(context, target): RuleRun {
    const scenes = orderedScenes(context, target);
    const signature = (purpose: readonly string[]): string =>
      purpose
        .map((line) => (wordsOf(line)[0] ?? "").toLowerCase())
        .filter((word) => word !== "")
        .join("→");
    const signatures = scenes.map((scene) => ({
      sceneId: scene.id as string,
      signature: signature(scene.purpose ?? []),
    }));

    let run: (typeof signatures)[number][] = [];
    const findings: SemanticFindingDraft[] = [];
    const flush = (): void => {
      const shape = run[0]?.signature ?? "";
      if (run.length >= 3 && shape.includes("→")) {
        findings.push({
          category: "structure",
          kind: "heuristic",
          message: `${String(run.length)} adjacent scenes follow the same beat pattern.`,
          evidence: {
            sceneIds: run.map((entry) => entry.sceneId),
            entities: [],
            notes: [`Shared pattern: ${shape.replaceAll("→", " → ")}`],
          },
          confidence: run.length >= 4 ? "high" : "medium",
          key: run[0]?.sceneId ?? "",
        });
      }
      run = [];
    };
    for (const entry of signatures) {
      const last = run.at(-1);
      if (entry.signature !== "" && (last === undefined || last.signature === entry.signature)) {
        run.push(entry);
      } else {
        flush();
        if (entry.signature !== "") run = [entry];
      }
    }
    flush();
    return { findings };
  },
});

// ── Foreshadowing ────────────────────────────────────────────────────────────

export const setupHammering: SemanticCompilerRule = heuristicRule({
  id: "sem_foreshadow_hammering",
  name: "Setup repetition",
  version: 1,
  category: "foreshadowing",
  description: "A setup planted so often it may stop being subtle.",
  run(context, target): RuleRun {
    const inScope = new Set(target.sceneIds);
    const findings: SemanticFindingDraft[] = [];
    for (const setup of context.setups) {
      const plantings = setup.setupSceneIds.filter((sceneId) => inScope.has(sceneId as string));
      if (plantings.length < 3) continue;
      const subtle = setup.subtlety === "subtle" || setup.subtlety === "buried";
      findings.push({
        category: "foreshadowing",
        kind: "heuristic",
        message: subtle
          ? `A setup marked "${setup.subtlety}" is planted ${String(plantings.length)} times — repetition works against the intended subtlety.`
          : `A setup is planted ${String(plantings.length)} times in this scope.`,
        evidence: {
          sceneIds: plantings.map((sceneId) => sceneId as string),
          entities: [setup.id as string],
          notes: [shorten(setup.description)],
        },
        confidence: subtle ? "medium" : "low",
        key: setup.id as string,
      });
    }
    return { findings };
  },
});

export const HEURISTIC_RULES: readonly SemanticCompilerRule[] = [
  repeatedPhrases,
  filteringLanguage,
  emotionalTellRepetition,
  sentenceOpenings,
  sceneRhythm,
  lowConflictStretch,
  beatRepetition,
  setupHammering,
];
