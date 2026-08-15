import {
  ModelError,
  parseModelJson,
  type GenerateRequest,
  type GenerateResult,
  type LanguageModel,
  type ModelCapabilities,
  type RequestOptions,
  type StopReason,
  type StreamEvent,
  type StructuredRequest,
  type ToolCall,
  type ToolCallRequest,
  type ToolCallResult,
  type TokenUsage,
} from "@jellytind/model-router";

/** Minimal `fetch` shape so a custom implementation can be injected in tests. */
export interface FetchLike {
  (
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    },
  ): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
    json(): Promise<unknown>;
    body?: ReadableStream<Uint8Array> | null;
  }>;
}

export interface OpenAiCompatibleModelOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly fetch?: FetchLike;
  /** Extra headers a particular service wants (OpenRouter attribution). */
  readonly headers?: Readonly<Record<string, string>>;
  readonly capabilities?: ModelCapabilities;
}

/**
 * The OpenAI chat-completions wire format.
 *
 * Deliberately one adapter rather than four. OpenAI, OpenRouter, Ollama and
 * essentially every self-hosted inference server speak this same shape at
 * `/v1/chat/completions`, and writing it four times would be four places for
 * the same streaming bug to live. What differs between them — the address, the
 * auth header, how models are discovered — is configuration, and lives in the
 * provider rather than here (docs/MODEL_ROUTER.md).
 */
export class OpenAiCompatibleModel implements LanguageModel {
  readonly id: string;
  readonly capabilities: ModelCapabilities;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: OpenAiCompatibleModelOptions) {
    this.id = `${providerHint(options.baseUrl)}:${options.model}`;
    this.capabilities = options.capabilities ?? {
      streaming: true,
      structuredOutput: true,
      tools: true,
    };
    const injected = options.fetch;
    if (injected !== undefined) this.fetchImpl = injected;
    else if (typeof globalThis.fetch === "function") {
      this.fetchImpl = globalThis.fetch.bind(globalThis) as unknown as FetchLike;
    } else throw new ModelError("unsupported", "No fetch implementation available.");
  }

  private headers(): Record<string, string> {
    const key = this.options.apiKey;
    return {
      "content-type": "application/json",
      // A local server needs no key, and sending an empty Authorization header
      // makes some of them refuse the request outright.
      ...(key !== undefined && key.trim() !== "" ? { authorization: `Bearer ${key}` } : {}),
      ...this.options.headers,
    };
  }

  private body(request: GenerateRequest, extra: Record<string, unknown> = {}): string {
    const messages = [
      ...(request.system === undefined ? [] : [{ role: "system", content: request.system }]),
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    return JSON.stringify({
      model: this.options.model,
      messages,
      ...(request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens }),
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.stopSequences === undefined ? {} : { stop: request.stopSequences }),
      ...extra,
    });
  }

  private async call(
    body: string,
    options: RequestOptions | undefined,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout =
      options?.timeoutMs === undefined
        ? undefined
        : setTimeout(() => controller.abort(), options.timeoutMs);
    options?.signal?.addEventListener("abort", () => controller.abort());

    try {
      const response = await this.fetchImpl(`${trimEnd(this.options.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw await httpError(response);
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      throw normalise(error, options);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  async generateText(request: GenerateRequest, options?: RequestOptions): Promise<GenerateResult> {
    const json = await this.call(this.body(request), options);
    const usage = usageOf(json);
    options?.onUsage?.(usage);
    return { text: firstText(json), usage, stopReason: stopOf(json) };
  }

  async generateStructured<T>(request: StructuredRequest<T>, options?: RequestOptions): Promise<T> {
    // `json_object` is the portable instruction; services that ignore it still
    // return JSON because the prompt asks for it, and `parseModelJson` refuses
    // anything that is not valid — malformed output can never reach the project.
    const json = await this.call(
      this.body(request, { response_format: { type: "json_object" } }),
      options,
    );
    options?.onUsage?.(usageOf(json));
    return parseModelJson(request.schema, firstText(json));
  }

  async runWithTools(request: ToolCallRequest, options?: RequestOptions): Promise<ToolCallResult> {
    const json = await this.call(
      this.body(request, {
        tools: request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
      }),
      options,
    );

    const message = messageOf(json);
    const rawCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
    const toolCalls: ToolCall[] = rawCalls.map((entry) => {
      const call = entry as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
      let input: unknown = {};
      try {
        input = JSON.parse(String(call.function?.arguments ?? "{}"));
      } catch {
        // A model that emits unparsable arguments has made a tool call we
        // cannot honour; an empty input surfaces as a tool error rather than
        // crashing the run.
      }
      return { id: String(call.id ?? ""), name: String(call.function?.name ?? ""), input };
    });

    const usage = usageOf(json);
    options?.onUsage?.(usage);
    return {
      text: typeof message?.content === "string" ? message.content : "",
      toolCalls,
      usage,
      stopReason: toolCalls.length > 0 ? "tool_use" : stopOf(json),
    };
  }

  async *streamText(
    request: GenerateRequest,
    options?: RequestOptions,
  ): AsyncIterable<StreamEvent> {
    const controller = new AbortController();
    options?.signal?.addEventListener("abort", () => controller.abort());

    let response;
    try {
      response = await this.fetchImpl(`${trimEnd(this.options.baseUrl)}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: this.body(request, { stream: true }),
        signal: controller.signal,
      });
      if (!response.ok) throw await httpError(response);
    } catch (error) {
      throw normalise(error, options);
    }

    const stream = response.body;
    if (stream === null || stream === undefined) {
      // No streaming body: fall back to one shot rather than failing. A writer
      // does not care whether the text arrived in pieces.
      const result = await this.generateText(request, options);
      yield { type: "text-delta", delta: result.text };
      yield { type: "done", usage: result.usage, stopReason: result.stopReason };
      return;
    }

    const decoder = new TextDecoder();
    const reader = stream.getReader();
    let buffer = "";
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let stopReason: StopReason = "stop";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload) as Record<string, unknown>;
          const delta = deltaOf(event);
          if (delta !== "") yield { type: "text-delta", delta };
          const reason = finishOf(event);
          if (reason !== null) stopReason = reason;
          const reported = usageOf(event);
          if (reported.inputTokens > 0 || reported.outputTokens > 0) usage = reported;
        } catch {
          // A malformed chunk is skipped rather than ending the stream: the
          // rest of the response is still the writer's text.
        }
      }
    }
    options?.onUsage?.(usage);
    yield { type: "done", usage, stopReason };
  }
}

// ── Wire helpers ────────────────────────────────────────────────────────────

const trimEnd = (url: string): string => url.replace(/\/+$/, "");

/** A stable-enough label for logging and cost attribution. */
function providerHint(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "openai-compatible";
  }
}

function messageOf(json: Record<string, unknown>): Record<string, unknown> | undefined {
  const choices = json.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  return (choices[0] as { message?: Record<string, unknown> }).message;
}

function firstText(json: Record<string, unknown>): string {
  const content = messageOf(json)?.content;
  return typeof content === "string" ? content : "";
}

function deltaOf(event: Record<string, unknown>): string {
  const choices = event.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "";
  const delta = (choices[0] as { delta?: { content?: unknown } }).delta;
  return typeof delta?.content === "string" ? delta.content : "";
}

function finishOf(event: Record<string, unknown>): StopReason | null {
  const choices = event.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const reason = (choices[0] as { finish_reason?: unknown }).finish_reason;
  if (typeof reason !== "string") return null;
  return mapStop(reason);
}

function stopOf(json: Record<string, unknown>): StopReason {
  const choices = json.choices;
  if (!Array.isArray(choices) || choices.length === 0) return "other";
  const reason = (choices[0] as { finish_reason?: unknown }).finish_reason;
  return typeof reason === "string" ? mapStop(reason) : "other";
}

function mapStop(reason: string): StopReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "max_tokens";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    default:
      return "other";
  }
}

function usageOf(json: Record<string, unknown>): TokenUsage {
  const usage = json.usage as
    | {
        prompt_tokens?: unknown;
        completion_tokens?: unknown;
        prompt_tokens_details?: { cached_tokens?: unknown };
      }
    | undefined;
  const cached = usage?.prompt_tokens_details?.cached_tokens;
  return {
    inputTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0,
    outputTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0,
    ...(typeof cached === "number" ? { cachedInputTokens: cached } : {}),
  };
}

async function httpError(response: {
  status: number;
  text(): Promise<string>;
}): Promise<ModelError> {
  const body = await response.text().catch(() => "");
  const code =
    response.status === 401 || response.status === 403
      ? "auth"
      : response.status === 429
        ? "rate_limit"
        : response.status === 404
          ? "unsupported"
          : "provider_error";
  const message =
    response.status === 404
      ? "The provider responded, but that model is not available on this connection."
      : `Provider returned ${String(response.status)}.`;
  return new ModelError(code, message, {
    details: { status: response.status, body: body.slice(0, 400) },
  });
}

function normalise(error: unknown, options: RequestOptions | undefined): unknown {
  if (error instanceof ModelError) return error;
  if (options?.signal?.aborted === true) {
    return new ModelError("cancelled", "The request was cancelled.");
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/abort/i.test(message)) return new ModelError("timeout", "The request timed out.");
  return new ModelError("network", "Could not reach the provider.", { cause: error });
}
