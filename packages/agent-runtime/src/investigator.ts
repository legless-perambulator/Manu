import { ModelError, type LanguageModel, type ModelMessage } from "@jellytind/model-router";
import { AGENT_ANSWER_SCHEMA, ANSWER_FORMAT_INSTRUCTIONS, type AgentAnswer } from "./answer";
import { describeActivity, type AgentActivityEvent } from "./activity";
import { AgentError } from "./errors";
import type { ToolExecutor } from "./executor";
import type { AgentStore } from "./ports";
import { transition, type AgentTask } from "./task";

const DEFAULT_MAX_STEPS = 8;
const MAX_RESULT_CHARS = 4_000;

const SYSTEM_PROMPT = `You are the investigating agent inside JellyTind, a fiction development environment.

You are working on a real story project. You do not have the project in front of you: you must retrieve what you need with the tools provided. Investigate before answering.

Rules:
- Use tools to find out what the project actually says. Never guess at content you have not retrieved.
- Entities have stable IDs (CHAR_0001, SCENE_0001, CHAPTER_0001, LOC_0001, THREAD_0001). Prefer ID-based tools over reading raw files, and start broad (get_project, search_project, get_scenes_by_character) before reading prose.
- Scenes are structured records; their prose lives in the chapter file named by the chapter's filePath.
- If a tool fails or returns nothing, adjust and try a different tool. Do not repeat an identical failing call.
- You are read-only in this session. You cannot change the project, and must not claim to have changed anything.
- Keep your replies between tool calls to a single short sentence stating what you are doing next. Do not narrate your reasoning.`;

export interface AgentRunResult {
  readonly task: AgentTask;
  readonly answer?: AgentAnswer;
  readonly events: readonly AgentActivityEvent[];
  readonly steps: number;
}

export interface InvestigationAgentOptions {
  readonly model: LanguageModel;
  readonly executor: ToolExecutor;
  readonly store: AgentStore;
  readonly maxSteps?: number;
  readonly now?: () => string;
}

export interface RunOptions {
  readonly signal?: AbortSignal;
  /** Called as each tool call is logged, for a live activity feed. */
  readonly onActivity?: (event: AgentActivityEvent, line: string) => void;
}

/** Trim a tool result so one enormous file cannot crowd out the conversation. */
function renderResult(name: string, payload: unknown): string {
  const json = JSON.stringify(payload);
  const body =
    json.length > MAX_RESULT_CHARS ? `${json.slice(0, MAX_RESULT_CHARS)}…(truncated)` : json;
  return `${name} → ${body}`;
}

/**
 * The Phase-7 investigating agent.
 *
 * It runs the `inspect → answer` half of the product's
 * investigate-before-modifying default (docs/AGENT_RUNTIME.md): a bounded loop
 * of model turn → tool calls → tool results, then one structured, schema-checked
 * answer. Every tool call goes through the {@link ToolExecutor}, so permissions,
 * validation and logging apply to the agent exactly as they would to any other
 * caller.
 *
 * Deliberately bounded rather than open-ended: the loop has a step ceiling, the
 * task's own allow-list constrains the tools, and cancellation is checked
 * between every step.
 */
export class InvestigationAgent {
  private readonly model: LanguageModel;
  private readonly executor: ToolExecutor;
  private readonly store: AgentStore;
  private readonly maxSteps: number;
  private readonly now: () => string;

  constructor(options: InvestigationAgentOptions) {
    this.model = options.model;
    this.executor = options.executor;
    this.store = options.store;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async run(task: AgentTask, options: RunOptions = {}): Promise<AgentRunResult> {
    if (!this.model.capabilities.tools) {
      throw new AgentError(
        "provider_failed",
        `The selected model (${this.model.id}) does not support tool calling, which this agent requires.`,
      );
    }

    let current = await this.store.saveTask(transition(task, "running", { now: this.now() }));
    const events: AgentActivityEvent[] = [];
    const messages: ModelMessage[] = [{ role: "user", content: current.goal }];
    const tools = this.executor.describeAvailableTools();
    let steps = 0;

    const finish = async (
      status: "completed" | "failed" | "cancelled",
      failureReason?: string,
    ): Promise<AgentTask> => {
      current = await this.store.saveTask(
        transition(current, status, {
          now: this.now(),
          ...(failureReason !== undefined ? { failureReason } : {}),
        }),
      );
      return current;
    };

    try {
      // ── Investigation loop ───────────────────────────────────────────────
      for (; steps < this.maxSteps; steps += 1) {
        if (options.signal?.aborted === true) {
          return { task: await finish("cancelled"), events, steps };
        }

        const turn = await this.model.runWithTools(
          { system: SYSTEM_PROMPT, messages, tools },
          { ...(options.signal !== undefined ? { signal: options.signal } : {}) },
        );

        if (turn.toolCalls.length === 0) break;

        const results: string[] = [];
        for (const call of turn.toolCalls) {
          const outcome = await this.executor.execute(current.id, call.name, call.input, {
            ...(options.signal !== undefined ? { signal: options.signal } : {}),
          });
          events.push(outcome.event);
          options.onActivity?.(outcome.event, describeActivity(outcome.event));

          if (outcome.event.status === "cancelled") {
            return { task: await finish("cancelled"), events, steps };
          }
          results.push(
            outcome.ok
              ? renderResult(call.name, outcome.output)
              : `${call.name} → ERROR: ${outcome.error ?? "failed"}`,
          );
        }

        messages.push({
          role: "assistant",
          content: turn.text === "" ? "(using tools)" : turn.text,
        });
        messages.push({ role: "user", content: `TOOL RESULTS\n${results.join("\n")}` });
      }

      if (options.signal?.aborted === true) {
        return { task: await finish("cancelled"), events, steps };
      }

      // ── Grounded answer ──────────────────────────────────────────────────
      const answer = await this.model.generateStructured(
        {
          system: SYSTEM_PROMPT,
          messages: [
            ...messages,
            {
              role: "user",
              content: `Answer the original request using only what the tools returned.\n\nOriginal request: ${current.goal}\n\n${ANSWER_FORMAT_INSTRUCTIONS}`,
            },
          ],
          schema: AGENT_ANSWER_SCHEMA,
          maxOutputTokens: 2048,
        },
        { ...(options.signal !== undefined ? { signal: options.signal } : {}) },
      );

      return { task: await finish("completed"), answer, events, steps };
    } catch (cause) {
      if (cause instanceof ModelError && cause.modelCode === "cancelled") {
        return { task: await finish("cancelled"), events, steps };
      }
      const reason = cause instanceof Error ? cause.message : String(cause);
      const failed = await finish("failed", reason);
      if (cause instanceof ModelError) {
        throw new AgentError(
          cause.modelCode === "invalid_output" ? "no_answer" : "provider_failed",
          reason,
          { cause, details: { taskId: failed.id, modelCode: cause.modelCode } },
        );
      }
      throw cause;
    }
  }
}
