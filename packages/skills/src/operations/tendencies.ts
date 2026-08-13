import type { SkillFinding } from "@jellytind/domain";
import { checkVoiceRules } from "@jellytind/story-repository";
import { repeatedSentenceOpenings, scanTendencies, sentencesOf } from "../prose";
import type { SkillOperation } from "../types";
import { chapterProse, finding, nothingToDo, operation } from "./shared";

/**
 * The `/remove-ai-tendencies` workflow.
 *
 * The name is what writers call it; what it actually does is **count**. Every
 * hit is a phrase with a location and a number beside it, and the writer
 * decides whether eleven "began to"s is a habit worth breaking or a voice. The
 * skill removes nothing: the rewrite step, when a model is configured,
 * produces proposals that nothing applies (docs/AI_EDITING.md).
 */

export const scanProseTendencies = operation({
  id: "scan_prose_tendencies",
  title: "Scan prose for over-used constructions",
  kind: "deterministic",
  produces: "tendencies",
  requiredTools: ["read_chapter_prose"],
  async run(context) {
    const prose = await chapterProse(context.repo, context.inputs.chapterId);
    const text = prose.map((chapter) => chapter.text).join("\n\n");
    if (text.trim() === "") return nothingToDo("No prose has been written yet.");

    const hits = scanTendencies(text);
    const openings = repeatedSentenceOpenings(sentencesOf(text));
    const words = (text.match(/\S+/g) ?? []).length;

    const findings: SkillFinding[] = hits.map((hit, index) =>
      finding(context, index, {
        kind: "measurement",
        statement: `${hit.label} appears ${String(hit.count)} time(s).`,
        detail: `…${hit.example}…`,
        basis: `${String(words)} words of prose`,
      }),
    );
    for (const opening of openings.slice(0, 5)) {
      findings.push(
        finding(context, findings.length, {
          kind: "measurement",
          statement: `${String(opening.count)} sentences open with "${opening.word}".`,
          basis: "sentence openings across the prose inspected",
        }),
      );
    }

    return {
      summary: `Scanned ${String(words)} words — ${String(hits.length)} construction(s) and ${String(openings.length)} repeated opening(s)`,
      data: { hits, openings, words, chapters: prose.length },
      findings,
      measurements: [
        {
          label: "Flagged constructions",
          value: hits.reduce((sum, hit) => sum + hit.count, 0),
          unit: "occurrences",
          basis: `${String(words)} words, ${String(hits.length)} distinct pattern(s)`,
        },
      ],
      notMeasured: ["this is a fixed list of constructions, not a judgement about prose quality"],
    };
  },
});

export const checkAuthorVoiceRules = operation({
  id: "check_voice_rules",
  title: "Check the writer's own rules",
  kind: "deterministic",
  produces: "voiceRuleHits",
  requiredTools: ["get_author_voice"],
  contextRecipe: "author_voice",
  async run(context) {
    const [{ rules }, prose] = await Promise.all([
      context.repo.authorVoice({ operation: "prose_edit" }),
      chapterProse(context.repo, context.inputs.chapterId),
    ]);
    if (rules.length === 0) {
      return nothingToDo("No author voice rules are recorded, so none were checked.");
    }

    const text = prose.map((chapter) => chapter.text).join("\n\n");
    const result = checkVoiceRules(text, rules);

    const findings = result.hits.map((hit, index) =>
      finding(context, index, {
        kind: "attention",
        statement: `Against your own rule: ${hit.statement}`,
        detail: `${String(hit.occurrences.length)} occurrence(s), e.g. …${hit.occurrences[0]?.excerpt ?? ""}…`,
        basis: "exact pattern match on the rule",
      }),
    );

    return {
      summary: `Checked ${String(result.checked.length)} rule(s) exactly, ${String(result.hits.length)} hit(s); ${String(result.notChecked.length)} need a reading`,
      data: {
        checked: result.checked,
        notChecked: result.notChecked,
        hits: result.hits.length,
      },
      findings,
      ...(result.notChecked.length > 0
        ? {
            notMeasured: result.notChecked.map(
              (statement) => `"${statement}" carries no pattern, so it was not checked`,
            ),
          }
        : {}),
    };
  },
});

export const proposeRewrites = operation({
  id: "propose_rewrites",
  title: "Propose alternatives",
  kind: "semantic",
  reads: ["tendencies"],
  produces: "rewrites",
  contextRecipe: "author_voice",
  async run(context) {
    if (context.analyst === null) {
      return nothingToDo("No model is configured, so no alternatives were proposed.");
    }
    const tendencies = context.read<{
      hits: ReadonlyArray<{ label: string; count: number; example: string }>;
    }>("tendencies");
    if (tendencies === null || tendencies.hits.length === 0) {
      return nothingToDo("Nothing was flagged, so there is nothing to rewrite.");
    }

    const { rules } = await context.repo.authorVoice({ operation: "prose_edit" });
    const material = [
      "CONSTRUCTIONS FOUND, WITH ONE EXAMPLE EACH",
      ...tendencies.hits.map((hit) => `- ${hit.label} ×${String(hit.count)}: …${hit.example}…`),
      "",
      "THE WRITER'S OWN RULES — do not propose anything that breaks one",
      ...rules.map((rule) => `- ${rule.statement}`),
    ].join("\n");

    const notes = await context.analyst.read({
      instruction:
        "For each construction, say what it is doing in the sentence and offer one alternative in the writer's own register. Do not rewrite whole passages, and do not propose a change that breaks a stated rule.",
      material,
      maxItems: 10,
    });

    return {
      summary: `Model proposed ${String(notes.length)} alternative(s) — none applied`,
      data: { notes },
      findings: notes.map((note, index) =>
        finding(context, index, {
          kind: "proposal",
          statement: note.statement,
          ...(note.detail === undefined ? {} : { detail: note.detail }),
          basis: `model proposal (${context.analyst?.modelId ?? "model"}) — nothing has been changed in the manuscript`,
          source: "model",
        }),
      ),
    };
  },
});

export const TENDENCY_OPERATIONS: readonly SkillOperation[] = [
  scanProseTendencies,
  checkAuthorVoiceRules,
  proposeRewrites,
];
