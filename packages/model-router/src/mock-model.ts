import { ModelError, unsupportedCapability, type ModelErrorCode } from "./errors";
import { parseModelJson, type LanguageModel } from "./model";
import type {
  GenerateRequest,
  GenerateResult,
  ModelCapabilities,
  RequestOptions,
  StreamEvent,
  StructuredRequest,
  ToolCall,
  ToolCallRequest,
  ToolCallResult,
  TokenUsage,
} from "./types";

export interface MockBehavior {
  readonly id?: string;
  /** Fixed reply text. If omitted, echoes the last user message. */
  readonly text?: string;
  /** Stream chunks. If omitted, `text` is split into small chunks. */
  readonly chunks?: readonly string[];
  /** Value returned (as JSON) by generateStructured, validated through the schema. */
  readonly structured?: unknown;
  readonly toolCalls?: readonly ToolCall[];
  readonly usage?: TokenUsage;
  /** Inject a typed failure on every call — for exercising error handling. */
  readonly failWith?: ModelErrorCode;
  readonly capabilities?: Partial<ModelCapabilities>;
}

const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/**
 * A deterministic, offline {@link LanguageModel} for tests. Supports the full
 * interface, records calls, and can inject typed failures — so provider
 * abstractions, structured-output validation and error handling can all be
 * tested without any real API call.
 */
export class MockLanguageModel implements LanguageModel {
  readonly id: string;
  readonly capabilities: ModelCapabilities;
  /** Requests received, for assertions. */
  readonly calls: GenerateRequest[] = [];

  constructor(private readonly behavior: MockBehavior = {}) {
    this.id = behavior.id ?? "mock:test";
    this.capabilities = {
      streaming: behavior.capabilities?.streaming ?? true,
      structuredOutput: behavior.capabilities?.structuredOutput ?? true,
      tools: behavior.capabilities?.tools ?? true,
    };
  }

  private guard(options?: RequestOptions): void {
    if (this.behavior.failWith !== undefined) {
      throw new ModelError(
        this.behavior.failWith,
        `Mock injected failure: ${this.behavior.failWith}`,
      );
    }
    if (options?.signal?.aborted === true) {
      throw new ModelError("cancelled", "Request was cancelled.");
    }
  }

  private replyText(request: GenerateRequest): string {
    if (this.behavior.text !== undefined) return this.behavior.text;
    return [...request.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  }

  private usageFor(request: GenerateRequest, text: string): TokenUsage {
    if (this.behavior.usage !== undefined) return this.behavior.usage;
    const input = estimateTokens(
      (request.system ?? "") + request.messages.map((m) => m.content).join(""),
    );
    return { inputTokens: input, outputTokens: estimateTokens(text) };
  }

  generateText(request: GenerateRequest, options?: RequestOptions): Promise<GenerateResult> {
    this.calls.push(request);
    try {
      this.guard(options);
    } catch (error) {
      return Promise.reject(error);
    }
    const text = this.replyText(request);
    const usage = this.usageFor(request, text);
    options?.onUsage?.(usage);
    return Promise.resolve({ text, usage, stopReason: "stop" });
  }

  async *streamText(
    request: GenerateRequest,
    options?: RequestOptions,
  ): AsyncIterable<StreamEvent> {
    this.calls.push(request);
    if (!this.capabilities.streaming) throw unsupportedCapability(this.id, "streaming");
    this.guard(options);
    const text = this.replyText(request);
    const chunks = this.behavior.chunks ?? text.match(/.{1,8}/gs) ?? (text === "" ? [] : [text]);
    for (const delta of chunks) yield { type: "text-delta", delta };
    const usage = this.usageFor(request, text);
    options?.onUsage?.(usage);
    yield { type: "done", usage, stopReason: "stop" };
  }

  generateStructured<T>(request: StructuredRequest<T>, options?: RequestOptions): Promise<T> {
    this.calls.push(request);
    try {
      this.guard(options);
    } catch (error) {
      return Promise.reject(error);
    }
    const raw =
      this.behavior.structured !== undefined
        ? JSON.stringify(this.behavior.structured)
        : this.replyText(request);
    options?.onUsage?.(this.usageFor(request, raw));
    try {
      return Promise.resolve(parseModelJson(request.schema, raw));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  runWithTools(request: ToolCallRequest, options?: RequestOptions): Promise<ToolCallResult> {
    this.calls.push(request);
    try {
      if (!this.capabilities.tools) throw unsupportedCapability(this.id, "tool calling");
      this.guard(options);
    } catch (error) {
      return Promise.reject(error);
    }
    const text = this.replyText(request);
    const toolCalls = this.behavior.toolCalls ?? [];
    const usage = this.usageFor(request, text);
    options?.onUsage?.(usage);
    return Promise.resolve({
      text,
      toolCalls,
      usage,
      stopReason: toolCalls.length > 0 ? "tool_use" : "stop",
    });
  }
}
