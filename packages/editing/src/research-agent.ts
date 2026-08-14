import {
  checkPermission,
  createTask,
  transition,
  type PermissionGrant,
} from "@jellytind/agent-runtime";
import type { ResearchItem, ResearchScope, ResearchTask } from "@jellytind/domain";
import { ModelError, type LanguageModel, type OutputSchema } from "@jellytind/model-router";
import { findSceneSpan, type StoryRepository } from "@jellytind/story-repository";
import { findResearchPlaceholders } from "@jellytind/domain";
import { EditError } from "./types";

/**
 * The Research Agent (Phase 35 §6–8): a research question in, sourced
 * research items out — never chat that evaporates, and never canon.
 *
 * Three boundaries define it:
 *
 * - **Provenance is real or absent** (§8). With a search provider, every cited
 *   URL must be one the provider actually returned — anything else is dropped.
 *   With no provider, the model's own knowledge is used and *no URL survives
 *   at all*: `retrievalMethod: "model_knowledge"` says exactly what the item
 *   is, and the writer's review decides what it is worth. Invented sources
 *   cannot enter the library.
 * - **Privacy is minimal context** (§24). The agent sends the question and the
 *   scope's own material — a scene's title and purpose lines, the named
 *   entities' names — never the manuscript. Researching one factual question
 *   does not upload the book.
 * - **Canon is out of reach** (§25). The agent creates research items, links
 *   them, and finishes its task. It cannot edit prose, canonise a claim, or
 *   delete research; those paths simply do not exist here.
 */

/** What an external research tool looks like, when the writer connects one. */
export interface ResearchSearchProvider {
  readonly name: string;
  search(query: string): Promise<readonly ResearchSource[]>;
}

export interface ResearchSource {
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
  readonly author?: string;
  readonly publishedAt?: string;
}

interface RawFinding {
  readonly title: string;
  readonly summary: string;
  readonly content?: string;
  readonly sourceUrl?: string;
  readonly facts: readonly { statement: string; confidence?: number }[];
  readonly tags: readonly string[];
  /** Index of another finding in this batch whose account differs (§16). */
  readonly conflictsWithFinding?: number;
}

interface RawResearch {
  readonly findings: readonly RawFinding[];
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const RESEARCH_SCHEMA: OutputSchema<RawResearch> = {
  name: "ResearchFindings",
  parse(value: unknown): RawResearch {
    if (typeof value !== "object" || value === null) {
      throw new EditError("empty_response", "ResearchFindings: expected an object.");
    }
    const raw = (value as { findings?: unknown }).findings;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new EditError("empty_response", "ResearchFindings: no findings were produced.");
    }
    return {
      findings: raw
        .filter((entry): entry is Record<string, unknown> => typeof entry === "object")
        .map((entry) => ({
          title: typeof entry.title === "string" ? entry.title : "Untitled finding",
          summary: typeof entry.summary === "string" ? entry.summary : "",
          ...(typeof entry.content === "string" && entry.content !== ""
            ? { content: entry.content }
            : {}),
          ...(typeof entry.sourceUrl === "string" ? { sourceUrl: entry.sourceUrl } : {}),
          facts: Array.isArray(entry.facts)
            ? entry.facts
                .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
                .map((f) => ({
                  statement: typeof f.statement === "string" ? f.statement : "",
                  ...(typeof f.confidence === "number" ? { confidence: f.confidence } : {}),
                }))
                .filter((f) => f.statement !== "")
            : [],
          tags: strings(entry.tags),
          ...(typeof entry.conflictsWithFinding === "number"
            ? { conflictsWithFinding: entry.conflictsWithFinding }
            : {}),
        })),
    };
  },
};

export interface ResearchAgentOptions {
  readonly repo: StoryRepository;
  readonly model: LanguageModel;
  readonly grant: PermissionGrant;
  /** External research tooling, when the writer has connected any. */
  readonly searchProvider?: ResearchSearchProvider;
  readonly now?: () => string;
}

export interface ResearchRunResult {
  readonly task: ResearchTask;
  readonly items: readonly ResearchItem[];
}

export class ResearchAgent {
  private readonly repo: StoryRepository;
  private readonly model: LanguageModel;
  private readonly grant: PermissionGrant;
  private readonly searchProvider: ResearchSearchProvider | undefined;
  private readonly now: () => string;

  constructor(options: ResearchAgentOptions) {
    this.repo = options.repo;
    this.model = options.model;
    this.grant = options.grant;
    this.searchProvider = options.searchProvider;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /**
   * Work one research task (§7): search where a provider exists, distil,
   * preserve provenance, file items, link them to the task's scope, and leave
   * the task `awaiting_review` — the writer's judgement is the last step,
   * never the model's.
   */
  async run(taskId: string): Promise<ResearchRunResult> {
    const decision = checkPermission(
      { name: "run_research", permission: "run_research" },
      this.grant,
    );
    if (!decision.allowed) {
      throw new EditError("permission_denied", decision.reason);
    }
    const task = await this.repo.getResearchTask(taskId);
    if (task === null) {
      throw new EditError("unknown_target", `No research task "${taskId}".`);
    }
    if (task.status === "completed" || task.status === "cancelled") {
      throw new EditError("unknown_target", `${taskId} is ${task.status}.`);
    }
    await this.repo.updateResearchTask(taskId, { status: "researching" });

    const agentTask = createTask({
      id: await this.repo.agents.nextTaskId(),
      goal: `research: ${task.question}`,
      now: this.now(),
      scope: [
        ...(task.scope?.sceneId !== undefined ? [task.scope.sceneId] : []),
        ...(task.scope?.entityIds ?? []),
      ],
      allowedTools: [],
      approvalPolicy: "approve_every_edit",
    });
    await this.repo.agents.saveTask(agentTask);
    const running = await this.repo.agents.saveTask(
      transition(agentTask, "running", { now: this.now() }),
    );

    try {
      const sources =
        this.searchProvider === undefined ? [] : await this.searchProvider.search(task.question);
      const scopeText = await this.minimalScope(task.scope);
      const raw = await this.model.generateStructured(
        {
          system:
            this.searchProvider === undefined
              ? "You are a research assistant inside a fiction development environment. Answer the research question from your own knowledge, honestly. Produce structured findings with extracted factual claims and a confidence between 0 and 1 for each. You have NO sources to cite: do not include any sourceUrl, and never invent a citation. Where accounts genuinely differ in the real world, produce separate findings and mark the conflict."
              : "You are a research assistant inside a fiction development environment. Answer the research question using ONLY the sources provided below. Every finding must cite one of the provided URLs as its sourceUrl — never any other URL, never an invented one. Quote or extract the relevant material into content, and distil it into summary and factual claims with a confidence between 0 and 1. Where sources disagree, produce separate findings — one per account — and mark the conflict; do not merge them.",
          messages: [
            {
              role: "user",
              content: `RESEARCH QUESTION\n${task.question}\n${scopeText}${this.renderSources(
                sources,
              )}\n\nReply with JSON only: {"findings":[{"title":"…","summary":"…","content":"extract or quotation (optional)","sourceUrl":"one of the provided URLs (only when sources were provided)","facts":[{"statement":"…","confidence":0.0}],"tags":["…"],"conflictsWithFinding":0}]} — conflictsWithFinding names the index of another finding whose account differs, when one does.`,
            },
          ],
          schema: RESEARCH_SCHEMA,
          maxOutputTokens: 4_000,
        },
        { timeoutMs: 240_000 },
      );

      const allowed = new Map(sources.map((source) => [source.url, source]));
      const items: ResearchItem[] = [];
      const droppedUrls: number[] = [];
      for (const finding of raw.findings) {
        // §8: a citation is real or it is nothing. URLs are kept only when
        // the provider returned them; with no provider, none survive.
        const source = finding.sourceUrl !== undefined ? allowed.get(finding.sourceUrl) : undefined;
        if (finding.sourceUrl !== undefined && source === undefined) {
          droppedUrls.push(items.length);
        }
        const item = await this.repo.addResearchItem(
          {
            title: finding.title,
            type: source !== undefined ? "web" : "manual_note",
            status: "unreviewed",
            ...(finding.summary !== "" ? { summary: finding.summary } : {}),
            ...(finding.content !== undefined ? { content: finding.content } : {}),
            ...(source !== undefined
              ? {
                  sourceUrl: source.url,
                  sourceTitle: source.title,
                  ...(source.author !== undefined ? { sourceAuthor: source.author } : {}),
                  ...(source.publishedAt !== undefined ? { publishedAt: source.publishedAt } : {}),
                  accessedAt: this.now(),
                }
              : {}),
            tags: finding.tags,
            linkedEntityIds: task.scope?.entityIds ?? [],
            linkedSceneIds: task.scope?.sceneId !== undefined ? [task.scope.sceneId] : [],
            facts: finding.facts.map((fact) => ({
              statement: fact.statement,
              proposedBy: "model" as const,
              ...(fact.confidence !== undefined ? { confidence: fact.confidence } : {}),
            })),
            provenance: {
              origin: "agent",
              retrievalMethod:
                source !== undefined
                  ? `web_search (${this.searchProvider?.name ?? "provider"})`
                  : "model_knowledge",
              modelId: this.model.id,
              taskId,
            },
          },
          { actor: "agent", taskId: running.id, modelId: this.model.id },
        );
        items.push(item);
      }

      // §16: cross-reference conflicting accounts, kept as separate items.
      for (const [index, finding] of raw.findings.entries()) {
        const other =
          finding.conflictsWithFinding === undefined
            ? undefined
            : items[finding.conflictsWithFinding];
        const item = items[index];
        if (other === undefined || item === undefined || other.id === item.id) continue;
        await this.repo.updateResearchItem(
          item.id,
          {
            facts: item.facts.map((fact) => ({ ...fact, conflictsWithItemId: other.id })),
          },
          { actor: "agent" },
        );
      }

      const updated = await this.repo.updateResearchTask(taskId, {
        status: "awaiting_review",
        findingItemIds: items.map((item) => item.id),
      });
      await this.repo.agents.saveTask(
        transition(running, "awaiting_approval", { now: this.now() }),
      );
      await this.repo.agents.appendActivity({
        taskId: running.id,
        timestamp: this.now(),
        tool: "run_research",
        argumentsSummary: `task=${taskId}`,
        resultSummary: `${String(items.length)} item(s) filed, ${String(sources.length)} source(s) consulted${droppedUrls.length > 0 ? `, ${String(droppedUrls.length)} invented citation(s) refused` : ""}`,
        status: "ok",
      });
      const finalItems = await Promise.all(
        items.map(async (item) => (await this.repo.getResearchItem(item.id)) ?? item),
      );
      return { task: updated, items: finalItems };
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      const failed = await this.repo.updateResearchTask(taskId, {
        status: "failed",
        failureReason: reason,
      });
      await this.repo.agents.saveTask(
        transition(running, "failed", { now: this.now(), failureReason: reason }),
      );
      if (cause instanceof ModelError) {
        return { task: failed, items: [] };
      }
      throw cause;
    }
  }

  /**
   * "Research this" for a scene (§18): the question comes from the scene's own
   * placeholders when it has any, else from its recorded purpose. A task is
   * created and worked; the prose is not touched.
   */
  async researchScene(sceneId: string, instruction?: string): Promise<ResearchRunResult> {
    const scene = (await this.repo.listScenes()).find((s) => (s.id as string) === sceneId);
    if (scene === undefined) {
      throw new EditError("unknown_target", `No scene exists with ID "${sceneId}".`);
    }
    let question = instruction;
    if (question === undefined) {
      const prose = await this.sceneProse(sceneId);
      const gaps = findResearchPlaceholders(prose ?? "");
      question =
        gaps[0]?.question ??
        `The factual background a writer needs for: ${scene.purpose.join("; ") || scene.title}`;
    }
    const task = await this.repo.addResearchTask({
      question,
      scope: {
        sceneId,
        entityIds: [
          ...(scene.pov !== undefined ? [scene.pov as string] : []),
          ...(scene.characterIds as readonly string[]),
          ...(scene.locationId !== undefined ? [scene.locationId as string] : []),
        ],
      },
    });
    return this.run(task.id);
  }

  /**
   * "/research-pass" (§27): sweep the scope for unresolved placeholders and
   * open tasks, group duplicate questions into one task each, research them,
   * and hand back the findings for review. Prose is never changed.
   */
  async researchPass(
    options: { chapterId?: string } = {},
  ): Promise<{ created: ResearchTask[]; results: ResearchRunResult[] }> {
    const gaps = (await this.repo.findResearchGaps()).filter(
      (gap) => options.chapterId === undefined || gap.chapterId === options.chapterId,
    );
    const open = (await this.repo.listResearchTasks()).filter(
      (task) => task.status === "pending" || task.status === "failed",
    );
    const known = new Set(open.map((task) => task.question.toLowerCase().trim()));

    const created: ResearchTask[] = [];
    for (const gap of gaps) {
      const key = gap.question.toLowerCase().trim();
      if (known.has(key)) continue;
      known.add(key);
      created.push(
        await this.repo.addResearchTask({
          question: gap.question,
          scope: {
            chapterId: gap.chapterId,
            ...(gap.sceneId !== undefined ? { sceneId: gap.sceneId } : {}),
          },
        }),
      );
    }
    const results: ResearchRunResult[] = [];
    for (const task of [...open, ...created]) {
      results.push(await this.run(task.id));
    }
    return { created, results };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /**
   * §24: the whole of what leaves the project — the scope's own material,
   * spelled out. Never prose beyond the named scene's purpose, never other
   * chapters, never the manuscript.
   */
  private async minimalScope(scope: ResearchScope | undefined): Promise<string> {
    if (scope === undefined) return "";
    const lines: string[] = [];
    if (scope.sceneId !== undefined) {
      const scene = (await this.repo.listScenes()).find((s) => (s.id as string) === scope.sceneId);
      if (scene !== undefined) {
        lines.push(`For a scene titled "${scene.title}" about: ${scene.purpose.join("; ")}`);
      }
    }
    if (scope.entityIds !== undefined && scope.entityIds.length > 0) {
      const names: string[] = [];
      for (const id of scope.entityIds) {
        const entity = (await this.repo.getEntity(id)) as { name?: string; title?: string } | null;
        const name = entity?.name ?? entity?.title;
        if (name !== undefined) names.push(name);
      }
      if (names.length > 0) lines.push(`Involving: ${names.join(", ")}`);
    }
    if (scope.note !== undefined) lines.push(scope.note);
    return lines.length === 0
      ? ""
      : `\nCONTEXT (all of it — nothing else leaves the project)\n${lines.join("\n")}\n`;
  }

  private renderSources(sources: readonly ResearchSource[]): string {
    if (sources.length === 0) return "";
    return `\nSOURCES (cite only these)\n${sources
      .map(
        (source, index) =>
          `${String(index + 1)}. ${source.title} — ${source.url}${source.snippet !== undefined ? `\n   ${source.snippet}` : ""}`,
      )
      .join("\n")}\n`;
  }

  private async sceneProse(sceneId: string): Promise<string | null> {
    const scenes = await this.repo.listScenes();
    const scene = scenes.find((s) => (s.id as string) === sceneId);
    if (scene?.chapterId === undefined) return null;
    const chapter = (await this.repo.listChapters()).find((c) => c.id === scene.chapterId);
    if (chapter === undefined) return null;
    const file = (await this.repo.readProjectFile(chapter.filePath)) ?? "";
    const span = findSceneSpan(file, sceneId);
    return span === null ? null : file.slice(span.start, span.end);
  }
}
