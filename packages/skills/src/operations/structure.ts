import { orderScenes } from "@jellytind/domain";
import type { SkillFinding } from "@jellytind/domain";
import { countWords, mean, paragraphsOf, round, sentencesOf } from "../prose";
import type { SkillOperation } from "../types";
import { chapterProse, finding, labels, nothingToDo, operation } from "./shared";

/**
 * Structural operations: pacing, setups and payoffs, and what each scene is for.
 *
 * Everything here is a count with its basis attached. Whether 4,200 words in
 * one chapter is too many is not something a program can know, and a skill that
 * pretended otherwise would be a style guide with a progress bar
 * (AGENTS.md — "measurement is not judgement").
 */

export const measurePacing = operation({
  id: "measure_pacing",
  title: "Measure chapter and scene length",
  kind: "deterministic",
  produces: "pacing",
  requiredTools: ["get_manuscript_metrics", "read_chapter_prose"],
  async run(context) {
    const [prose, scenes, chapters] = await Promise.all([
      chapterProse(context.repo, context.inputs.chapterId),
      context.repo.listScenes(),
      context.repo.listChapters(),
    ]);
    if (prose.length === 0) return nothingToDo("No chapter prose to measure.");

    const ordered = orderScenes(scenes, chapters);
    const perChapter = prose.map((chapter) => {
      const sentences = sentencesOf(chapter.text);
      return {
        chapterId: chapter.chapterId,
        title: chapter.title,
        words: chapter.words,
        scenes: ordered.filter(
          (scene) => (scene.chapterId as string | undefined) === chapter.chapterId,
        ).length,
        paragraphs: paragraphsOf(chapter.text).length,
        meanSentenceWords: round(mean(sentences.map((sentence) => countWords(sentence)))),
      };
    });

    const words = perChapter.map((chapter) => chapter.words);
    const average = mean(words);
    // Chapters that run to twice the book's own average. Not a fault: a
    // measurement against the book's own habit, which is the only fair baseline.
    const outliers = perChapter.filter(
      (chapter) => average > 0 && chapter.words >= average * 2 && chapter.words > 0,
    );
    const empty = perChapter.filter((chapter) => chapter.words === 0);

    const findings: SkillFinding[] = outliers.map((chapter, index) =>
      finding(context, index, {
        kind: "measurement",
        statement: `${chapter.title} runs to ${String(chapter.words)} words, against a book average of ${String(Math.round(average))}.`,
        detail: "Long is not wrong. This is the chapter measured against the rest of this book.",
        basis: "word counts of chapter prose",
        entities: [chapter.chapterId],
      }),
    );

    return {
      summary: `Measured ${String(perChapter.length)} chapter(s) — mean ${String(Math.round(average))} words, ${String(outliers.length)} at twice that`,
      data: { perChapter, averageWords: round(average) },
      findings,
      measurements: [
        {
          label: "Mean chapter length",
          value: Math.round(average),
          unit: "words",
          basis: `${String(perChapter.length)} chapter(s)`,
        },
      ],
      ...(empty.length > 0
        ? {
            notMeasured: [
              `${String(empty.length)} chapter(s) have no prose written yet and were counted as zero rather than skipped`,
            ],
          }
        : {}),
    };
  },
});

export const inspectThreadActivity = operation({
  id: "inspect_thread_activity",
  title: "Inspect plot-thread activity",
  kind: "deterministic",
  produces: "threadActivity",
  requiredTools: ["list_plot_threads", "get_thread_dormancy"],
  async run(context) {
    const threads = await context.repo.listPlotThreads();
    if (threads.length === 0) return nothingToDo("No plot threads are recorded.");

    const unresolved = await context.repo.getUnresolvedThreads();
    const dormant: Array<{ id: string; name: string; scenes: number }> = [];
    const timeline = await context.repo.getStoryTimeline();
    const lastScene = timeline.sceneOrder.at(-1);

    if (lastScene !== undefined) {
      for (const thread of threads) {
        const dormancy = await context.repo.getThreadDormancy(thread.id as string, {
          sceneId: lastScene,
          position: "after",
        });
        const since = dormancy.scenesSinceAppearance;
        if (since !== undefined && since > 0) {
          dormant.push({ id: thread.id as string, name: thread.name, scenes: since });
        }
      }
    }

    const quiet = dormant.sort((a, b) => b.scenes - a.scenes).slice(0, 8);
    const findings = quiet.map((thread, index) =>
      finding(context, index, {
        kind: "measurement",
        statement: `"${thread.name}" has been off the page for ${String(thread.scenes)} scene(s) at the end of the book.`,
        basis: "thread appearances recorded in scene order",
        entities: [thread.id],
      }),
    );

    return {
      summary: `${String(threads.length)} thread(s), ${String(unresolved.length)} unresolved, ${String(dormant.length)} quiet at the end`,
      data: {
        threads: threads.length,
        unresolved: unresolved.map((state) => ({ id: state.threadId, status: state.status })),
        quiet,
      },
      findings,
    };
  },
});

export const readPacing = operation({
  id: "read_pacing",
  title: "Read the pacing measurements",
  kind: "semantic",
  reads: ["pacing"],
  produces: "pacingReading",
  contextRecipe: "chapter_inspection",
  async run(context) {
    if (context.analyst === null) {
      return nothingToDo("No model is configured, so the measurements were not interpreted.");
    }
    const pacing = context.read<{
      perChapter: ReadonlyArray<{
        title: string;
        words: number;
        scenes: number;
        meanSentenceWords: number;
      }>;
      averageWords: number;
    }>("pacing");
    if (pacing === null) return nothingToDo("Nothing measured, so nothing to read.");

    const material = [
      `Book average: ${String(pacing.averageWords)} words per chapter.`,
      "",
      ...pacing.perChapter.map(
        (chapter) =>
          `${chapter.title}: ${String(chapter.words)} words, ${String(chapter.scenes)} scene(s), mean sentence ${String(chapter.meanSentenceWords)} words`,
      ),
    ].join("\n");

    const notes = await context.analyst.read({
      instruction:
        "These are counts, not verdicts. Say where the shape of the book changes — a chapter far off the book's own habit, a run of chapters that flattens — and say what you would look at. Do not claim a chapter is bad because it is long.",
      material,
      maxItems: 6,
    });

    return {
      summary: `Model offered ${String(notes.length)} reading(s) of the pacing measurements`,
      data: { notes },
      findings: notes.map((note, index) =>
        finding(context, index, {
          kind: "attention",
          statement: note.statement,
          ...(note.detail === undefined ? {} : { detail: note.detail }),
          basis: `model reading (${context.analyst?.modelId ?? "model"}) of the measurements above`,
          source: "model",
        }),
      ),
    };
  },
});

export const inspectSetups = operation({
  id: "inspect_setups",
  title: "Inspect setups and payoffs",
  kind: "deterministic",
  produces: "setups",
  requiredTools: ["list_setups"],
  async run(context) {
    const setups = await context.repo.listSetups();
    if (setups.length === 0) {
      return nothingToDo("No setups are recorded, so no promise could be traced to its payoff.");
    }

    const outstanding = setups.filter(
      (setup) => setup.payoffSceneIds.length === 0 && setup.abandoned !== true,
    );
    const abandoned = setups.filter((setup) => setup.abandoned === true);
    const unplanted = setups.filter((setup) => setup.setupSceneIds.length === 0);

    const findings: SkillFinding[] = [];
    for (const setup of outstanding.slice(0, 20)) {
      findings.push(
        finding(context, findings.length, {
          kind: "gap",
          statement: `Promise still outstanding: ${setup.description}`,
          detail:
            "Planted, with no payoff recorded. Deliberately dropped setups can be marked abandoned.",
          basis: "setup records",
          sceneIds: setup.setupSceneIds.map((id) => id as string),
          entities: [setup.id as string],
        }),
      );
    }
    for (const setup of unplanted) {
      findings.push(
        finding(context, findings.length, {
          kind: "gap",
          statement: `Payoff with nothing planted: ${setup.description}`,
          basis: "setup records",
          entities: [setup.id as string],
        }),
      );
    }

    return {
      summary: `${String(setups.length)} setup(s) — ${String(outstanding.length)} outstanding, ${String(abandoned.length)} deliberately abandoned`,
      data: {
        setups: setups.map((setup) => ({
          id: setup.id as string,
          description: setup.description,
          subtlety: setup.subtlety,
          setupSceneIds: setup.setupSceneIds.map((id) => id as string),
          payoffSceneIds: setup.payoffSceneIds.map((id) => id as string),
          abandoned: setup.abandoned === true,
        })),
      },
      findings,
      measurements: [
        {
          label: "Outstanding promises",
          value: outstanding.length,
          unit: "setups",
          basis: `of ${String(setups.length)} recorded`,
        },
      ],
    };
  },
});

export const measureSetupDistance = operation({
  id: "measure_setup_distance",
  title: "Measure setup-to-payoff distance",
  kind: "deterministic",
  reads: ["setups"],
  produces: "setupDistance",
  requiredTools: ["list_scenes", "list_chapters"],
  async run(context) {
    const recorded = context.read<{
      setups: ReadonlyArray<{
        id: string;
        description: string;
        subtlety: string;
        setupSceneIds: readonly string[];
        payoffSceneIds: readonly string[];
      }>;
    }>("setups");
    if (recorded === null) return nothingToDo("No setups to measure.");

    const [scenes, chapters] = await Promise.all([
      context.repo.listScenes(),
      context.repo.listChapters(),
    ]);
    const order = orderScenes(scenes, chapters).map((scene) => scene.id as string);
    const at = (id: string) => order.indexOf(id);

    const distances: Array<{ id: string; description: string; scenes: number }> = [];
    const backwards: Array<{ id: string; description: string }> = [];
    for (const setup of recorded.setups) {
      const plant = setup.setupSceneIds.map(at).filter((i) => i >= 0);
      const payoff = setup.payoffSceneIds.map(at).filter((i) => i >= 0);
      if (plant.length === 0 || payoff.length === 0) continue;
      const first = Math.min(...plant);
      const last = Math.max(...payoff);
      if (last < first) {
        backwards.push({ id: setup.id, description: setup.description });
        continue;
      }
      distances.push({ id: setup.id, description: setup.description, scenes: last - first });
    }

    const findings = backwards.map((setup, index) =>
      finding(context, index, {
        kind: "conflict",
        statement: `The payoff comes before the setup: ${setup.description}`,
        detail: "In manuscript order the promise is kept before it is made.",
        basis: "scene order",
        entities: [setup.id],
      }),
    );

    const values = distances.map((entry) => entry.scenes);
    return {
      summary:
        distances.length === 0
          ? "No setup has both a plant and a payoff placed in the manuscript"
          : `Measured ${String(distances.length)} kept promise(s) — mean distance ${String(round(mean(values)))} scenes`,
      data: { distances, backwards },
      findings,
      ...(distances.length === 0
        ? {}
        : {
            measurements: [
              {
                label: "Mean setup-to-payoff distance",
                value: round(mean(values)),
                unit: "scenes",
                basis: `${String(distances.length)} setup(s) with both ends placed`,
              },
            ],
          }),
    };
  },
});

export const inspectScenePurpose = operation({
  id: "inspect_scene_purpose",
  title: "Inspect what each scene is for",
  kind: "deterministic",
  produces: "purposes",
  requiredTools: ["list_scenes"],
  async run(context) {
    const [scenes, chapters] = await Promise.all([
      context.repo.listScenes(),
      context.repo.listChapters(),
    ]);
    if (scenes.length === 0) return nothingToDo("No scenes are recorded.");

    const ordered = orderScenes(scenes, chapters);
    const without = ordered.filter((scene) => scene.purpose.length === 0);

    // Two neighbouring scenes stating the same purpose, word for word.
    const duplicates: Array<{ a: string; b: string; purpose: string }> = [];
    for (let i = 1; i < ordered.length; i += 1) {
      const previous = ordered[i - 1];
      const current = ordered[i];
      if (previous === undefined || current === undefined) continue;
      const shared = current.purpose.find((purpose) =>
        previous.purpose.some((other) => other.toLowerCase() === purpose.toLowerCase()),
      );
      if (shared !== undefined) {
        duplicates.push({ a: previous.id as string, b: current.id as string, purpose: shared });
      }
    }

    const findings: SkillFinding[] = [];
    if (without.length > 0) {
      findings.push(
        finding(context, findings.length, {
          kind: "gap",
          statement: `${String(without.length)} of ${String(ordered.length)} scene(s) have no recorded purpose.`,
          detail:
            "An unrecorded purpose is not an absent one — but nothing can be checked against it, here or in the build.",
          basis: "scene records",
          sceneIds: without.slice(0, 20).map((scene) => scene.id as string),
        }),
      );
    }
    for (const duplicate of duplicates.slice(0, 10)) {
      findings.push(
        finding(context, findings.length, {
          kind: "attention",
          statement: `Consecutive scenes state the same purpose: "${duplicate.purpose}"`,
          basis: "scene purpose lines, compared exactly",
          sceneIds: [duplicate.a, duplicate.b],
        }),
      );
    }

    return {
      summary: `${String(ordered.length - without.length)} of ${String(ordered.length)} scene(s) state a purpose; ${String(duplicates.length)} neighbouring repeat(s)`,
      data: {
        total: ordered.length,
        withoutPurpose: without.map((scene) => scene.id as string),
        duplicates,
      },
      findings,
    };
  },
});

export const inspectSceneChange = operation({
  id: "inspect_scene_change",
  title: "Inspect what changes in each scene",
  kind: "deterministic",
  produces: "sceneChange",
  requiredTools: ["get_story_timeline"],
  async run(context) {
    const [scenes, chapters, timeline, names] = await Promise.all([
      context.repo.listScenes(),
      context.repo.listChapters(),
      context.repo.getStoryTimeline(),
      labels(context.repo),
    ]);
    if (scenes.length === 0) return nothingToDo("No scenes are recorded.");

    const ordered = orderScenes(scenes, chapters);
    const inert = ordered.filter(
      (scene) => timeline.transitionsAtScene(scene.id as string).length === 0,
    );

    const findings =
      inert.length === 0
        ? []
        : [
            finding(context, 0, {
              kind: "gap",
              statement: `${String(inert.length)} of ${String(ordered.length)} scene(s) record no change of any kind.`,
              detail:
                "No state, knowledge, relationship, object or thread transition. The scene may still change something on the page — this counts the record.",
              basis: "state transitions per scene",
              sceneIds: inert.slice(0, 20).map((scene) => scene.id as string),
            }),
          ];

    return {
      summary: `${String(ordered.length - inert.length)} of ${String(ordered.length)} scene(s) record a change`,
      data: {
        inert: inert.map((scene) => ({
          id: scene.id as string,
          title: scene.title,
          chapter: names.get((scene.chapterId as string | undefined) ?? "") ?? "",
        })),
      },
      findings,
      measurements: [
        {
          label: "Scenes recording no change",
          value: inert.length,
          unit: "scenes",
          basis: `of ${String(ordered.length)}`,
        },
      ],
    };
  },
});

export const STRUCTURE_OPERATIONS: readonly SkillOperation[] = [
  measurePacing,
  inspectThreadActivity,
  readPacing,
  inspectSetups,
  measureSetupDistance,
  inspectScenePurpose,
  inspectSceneChange,
];
