import { operation } from "./shared";

/**
 * Research operations (Phase 35 §27): the deterministic backbone of
 * `/research-pass` — find every unresolved research gap, collect the open
 * research tasks, and group the questions for review.
 *
 * Deliberately nothing here performs research or changes prose: the pass
 * *identifies and organises*; working the approved questions is the Research
 * Agent's job, taken from the library, after the writer has seen the list.
 */

interface FoundGap {
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly sceneId?: string;
  readonly question: string;
}

interface OpenTask {
  readonly id: string;
  readonly question: string;
  readonly status: string;
  readonly findings: number;
}

export const scanResearchGaps = operation({
  id: "scan_research_gaps",
  title: "Find unresolved research placeholders",
  kind: "deterministic",
  produces: "research_gaps",
  requiredTools: ["list_research"],
  async run(context) {
    const chapterId = context.inputs.chapterId as string | undefined;
    const gaps = (await context.repo.findResearchGaps()).filter(
      (gap) => chapterId === undefined || gap.chapterId === chapterId,
    );
    if (gaps.length === 0) {
      return {
        summary: "No unresolved [RESEARCH: …] placeholders in scope",
        data: [] satisfies FoundGap[],
        measurements: [
          {
            label: "Unresolved research placeholders",
            value: 0,
            unit: "placeholders",
            basis: "every [RESEARCH: …] marker in the manuscript",
          },
        ],
      };
    }
    return {
      summary: `${String(gaps.length)} unresolved research placeholder(s)`,
      data: gaps satisfies FoundGap[],
      findings: gaps.map((gap, index) => ({
        id: context.finding(index),
        kind: "gap" as const,
        statement: `Research needed: ${gap.question}`,
        detail: `Marked in ${gap.chapterTitle}${gap.sceneId !== undefined ? ` (${gap.sceneId})` : ""}. The passage holding it is not finished prose.`,
        ...(gap.sceneId !== undefined ? { sceneIds: [gap.sceneId] } : {}),
        entities: [gap.chapterId],
        source: "deterministic" as const,
        stepId: context.stepId,
      })),
      measurements: [
        {
          label: "Unresolved research placeholders",
          value: gaps.length,
          unit: "placeholders",
          basis: "every [RESEARCH: …] marker in the manuscript",
        },
      ],
    };
  },
});

export const collectResearchTasks = operation({
  id: "collect_research_tasks",
  title: "Collect open research tasks",
  kind: "deterministic",
  produces: "research_tasks",
  requiredTools: ["list_research"],
  async run(context) {
    const open = (await context.repo.listResearchTasks()).filter(
      (task) =>
        task.status === "pending" ||
        task.status === "researching" ||
        task.status === "awaiting_review" ||
        task.status === "failed",
    );
    const data: OpenTask[] = open.map((task) => ({
      id: task.id,
      question: task.question,
      status: task.status,
      findings: task.findingItemIds.length,
    }));
    return {
      summary: `${String(open.length)} open research task(s)`,
      data,
      measurements: [
        {
          label: "Open research tasks",
          value: open.length,
          unit: "tasks",
          basis: "tasks not yet completed or cancelled",
        },
      ],
    };
  },
});

export const groupResearchQuestions = operation({
  id: "group_research_questions",
  title: "Group the questions",
  kind: "deterministic",
  reads: ["research_gaps", "research_tasks"],
  produces: "research_questions",
  async run(context) {
    const gaps = context.read<FoundGap[]>("research_gaps") ?? [];
    const tasks = context.read<OpenTask[]>("research_tasks") ?? [];
    const covered = new Set(tasks.map((task) => task.question.toLowerCase().trim()));

    const grouped = new Map<string, { question: string; count: number; hasTask: boolean }>();
    for (const gap of gaps) {
      const key = gap.question.toLowerCase().trim();
      const held = grouped.get(key);
      if (held !== undefined) held.count += 1;
      else grouped.set(key, { question: gap.question, count: 1, hasTask: covered.has(key) });
    }
    const questions = [...grouped.values()];
    const unassigned = questions.filter((entry) => !entry.hasTask);
    return {
      summary: `${String(questions.length)} distinct question(s), ${String(unassigned.length)} without a task`,
      data: questions,
      findings: unassigned.map((entry, index) => ({
        id: context.finding(index),
        kind: "proposal" as const,
        statement: `Create a research task: ${entry.question}`,
        detail:
          entry.count > 1
            ? `Asked in ${String(entry.count)} places. One task covers them all; run it from the Research panel.`
            : "Run it from the Research panel; the findings arrive in the library, linked to the scene.",
        source: "deterministic" as const,
        stepId: context.stepId,
      })),
      measurements: [
        {
          label: "Distinct research questions",
          value: questions.length,
          unit: "questions",
          basis: "placeholder questions, deduplicated",
        },
        {
          label: "Questions without a task",
          value: unassigned.length,
          unit: "questions",
          basis: "against the open research tasks",
        },
      ],
    };
  },
});

export const RESEARCH_OPERATIONS = [scanResearchGaps, collectResearchTasks, groupResearchQuestions];
