import {
  ModelError,
  describeModel,
  parseModelJson,
  type ConnectionTestResult,
  type GenerateRequest,
  type GenerateResult,
  type LanguageModel,
  type ModelCapabilities,
  type ModelDescriptor,
  type ModelProvider,
  type ProviderCredentials,
  type ProviderDescriptor,
  type RequestOptions,
  type StopReason,
  type StreamEvent,
  type StructuredRequest,
  type ToolCall,
  type ToolCallRequest,
  type ToolCallResult,
  type TokenUsage,
} from "@jellytind/model-router";

/**
 * Google Gemini, over the official generative-language API with an API key.
 *
 * Gemini is the one provider here that does not speak the OpenAI shape, so it
 * gets its own adapter rather than being bent into one. The translation is
 * confined to this file: `contents`/`parts` in, provider-independent types out
 * (AGENTS.md — "Provider Independence").
 */

export const GOOGLE_PROVIDER_ID = "google";
export const GOOGLE_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface FetchLike {
  (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
  ): Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;
}

const FULL: ModelCapabilities = { streaming: true, structuredOutput: true, tools: true };

/**
 * Fallback catalogue.
 *
 * Gemini publishes `/models`, so discovery is the primary path; this is what
 * the settings interface can show before a key is entered.
 */
export const GOOGLE_MODELS: readonly ModelDescriptor[] = [
  describeModel({
    provider: GOOGLE_PROVIDER_ID,
    modelId: "gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    capabilities: FULL,
    contextWindow: 1_048_576,
    reasoning: true,
    vision: true,
  }),
  describeModel({
    provider: GOOGLE_PROVIDER_ID,
    modelId: "gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    capabilities: FULL,
    contextWindow: 1_048_576,
    vision: true,
  }),
];

interface ModelOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
}

export class GoogleLanguageModel implements LanguageModel {
  readonly id: string;
  readonly capabilities = FULL;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(private readonly options: ModelOptions) {
    this.id = `google:${options.model}`;
    this.baseUrl = (options.baseUrl ?? GOOGLE_DEFAULT_BASE_URL).replace(/\/+$/, "");
    const injected = options.fetch;
    if (injected !== undefined) this.fetchImpl = injected;
    else if (typeof globalThis.fetch === "function") {
      this.fetchImpl = globalThis.fetch.bind(globalThis) as unknown as FetchLike;
    } else throw new ModelError("unsupported", "No fetch implementation available.");
  }

  private body(request: GenerateRequest, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
      ...(request.system === undefined
        ? {}
        : { systemInstruction: { parts: [{ text: request.system }] } }),
      contents: request.messages.map((message) => ({
        // Gemini calls the assistant "model"; the rest of Manu does not need to.
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        ...(request.maxOutputTokens === undefined
          ? {}
          : { maxOutputTokens: request.maxOutputTokens }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.stopSequences === undefined ? {} : { stopSequences: request.stopSequences }),
        ...((extra.generationConfig as Record<string, unknown> | undefined) ?? {}),
      },
      ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== "generationConfig")),
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
      const response = await this.fetchImpl(
        `${this.baseUrl}/models/${this.options.model}:generateContent`,
        {
          method: "POST",
          // The key goes in a header rather than the query string, so it cannot
          // end up in a proxy's access log.
          headers: { "content-type": "application/json", "x-goog-api-key": this.options.apiKey },
          body,
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new ModelError(
          response.status === 401 || response.status === 403
            ? "auth"
            : response.status === 429
              ? "rate_limit"
              : response.status === 404
                ? "unsupported"
                : "provider_error",
          response.status === 404
            ? "The provider responded, but that model is not available on this connection."
            : `Gemini returned ${String(response.status)}.`,
          { details: { status: response.status, body: text.slice(0, 400) } },
        );
      }
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ModelError) throw error;
      if (options?.signal?.aborted === true) {
        throw new ModelError("cancelled", "The request was cancelled.");
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/abort/i.test(message)) throw new ModelError("timeout", "The request timed out.");
      throw new ModelError("network", "Could not reach Gemini.", { cause: error });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  async generateText(request: GenerateRequest, options?: RequestOptions): Promise<GenerateResult> {
    const json = await this.call(this.body(request), options);
    const usage = usageOf(json);
    options?.onUsage?.(usage);
    return { text: textOf(json), usage, stopReason: stopOf(json) };
  }

  async generateStructured<T>(request: StructuredRequest<T>, options?: RequestOptions): Promise<T> {
    const json = await this.call(
      this.body(request, { generationConfig: { responseMimeType: "application/json" } }),
      options,
    );
    options?.onUsage?.(usageOf(json));
    return parseModelJson(request.schema, textOf(json));
  }

  async runWithTools(request: ToolCallRequest, options?: RequestOptions): Promise<ToolCallResult> {
    const json = await this.call(
      this.body(request, {
        tools: [
          {
            functionDeclarations: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            })),
          },
        ],
      }),
      options,
    );
    const parts = partsOf(json);
    const toolCalls: ToolCall[] = parts
      .map((part) => (part as { functionCall?: { name?: unknown; args?: unknown } }).functionCall)
      .filter((call): call is { name?: unknown; args?: unknown } => call !== undefined)
      .map((call, index) => ({
        id: `call_${String(index)}`,
        name: String(call.name ?? ""),
        input: call.args ?? {},
      }));
    const usage = usageOf(json);
    options?.onUsage?.(usage);
    return {
      text: textOf(json),
      toolCalls,
      usage,
      stopReason: toolCalls.length > 0 ? "tool_use" : stopOf(json),
    };
  }

  /**
   * Streaming, as one chunk.
   *
   * Gemini's streaming endpoint uses a different response envelope, and a
   * half-correct SSE parser that silently drops text would be worse than
   * honest buffering. The interface contract is satisfied — deltas then done —
   * and the writer sees the same words.
   */
  async *streamText(
    request: GenerateRequest,
    options?: RequestOptions,
  ): AsyncIterable<StreamEvent> {
    const result = await this.generateText(request, options);
    if (result.text !== "") yield { type: "text-delta", delta: result.text };
    yield { type: "done", usage: result.usage, stopReason: result.stopReason };
  }
}

function partsOf(json: Record<string, unknown>): unknown[] {
  const candidates = json.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const parts = (candidates[0] as { content?: { parts?: unknown } }).content?.parts;
  return Array.isArray(parts) ? parts : [];
}

function textOf(json: Record<string, unknown>): string {
  return partsOf(json)
    .map((part) => (part as { text?: unknown }).text)
    .filter((text): text is string => typeof text === "string")
    .join("");
}

function usageOf(json: Record<string, unknown>): TokenUsage {
  const usage = json.usageMetadata as
    | {
        promptTokenCount?: unknown;
        candidatesTokenCount?: unknown;
        cachedContentTokenCount?: unknown;
      }
    | undefined;
  const cached = usage?.cachedContentTokenCount;
  return {
    inputTokens: typeof usage?.promptTokenCount === "number" ? usage.promptTokenCount : 0,
    outputTokens: typeof usage?.candidatesTokenCount === "number" ? usage.candidatesTokenCount : 0,
    ...(typeof cached === "number" ? { cachedInputTokens: cached } : {}),
  };
}

function stopOf(json: Record<string, unknown>): StopReason {
  const candidates = json.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "other";
  const reason = (candidates[0] as { finishReason?: unknown }).finishReason;
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "max_tokens";
    default:
      return "other";
  }
}

export interface GoogleProviderOptions {
  readonly fetch?: FetchLike;
}

export class GoogleProvider implements ModelProvider {
  readonly name = GOOGLE_PROVIDER_ID;

  constructor(private readonly options: GoogleProviderOptions = {}) {}

  describe(): ProviderDescriptor {
    return {
      id: this.name,
      displayName: "Google Gemini",
      summary: "Gemini models over the official Google generative-language API.",
      auth: "api_key",
      local: false,
      configurableBaseUrl: false,
      defaultBaseUrl: GOOGLE_DEFAULT_BASE_URL,
      supportsDiscovery: true,
      credentialsUrl: "https://aistudio.google.com/apikey",
      connectionKind: "api",
    };
  }

  models(): ModelDescriptor[] {
    return [...GOOGLE_MODELS];
  }

  createModel(modelId: string, credentials: ProviderCredentials): GoogleLanguageModel {
    const apiKey = credentials.apiKey;
    if (apiKey === undefined || apiKey.trim() === "") {
      throw new ModelError("auth", "A Google AI API key is required.", {
        details: { provider: this.name, modelId },
      });
    }
    return new GoogleLanguageModel({
      apiKey,
      model: modelId,
      ...(credentials.baseUrl === undefined ? {} : { baseUrl: credentials.baseUrl }),
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
    });
  }

  async discoverModels(credentials: ProviderCredentials): Promise<ModelDescriptor[]> {
    const apiKey = credentials.apiKey ?? "";
    if (apiKey.trim() === "") throw new ModelError("auth", "A Google AI API key is required.");
    const fetchImpl = this.options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    const base = (credentials.baseUrl ?? GOOGLE_DEFAULT_BASE_URL).replace(/\/+$/, "");

    let response;
    try {
      response = await fetchImpl(`${base}/models`, {
        method: "GET",
        headers: { "x-goog-api-key": apiKey },
      });
    } catch (cause) {
      throw new ModelError("network", "Could not reach Gemini.", { cause });
    }
    if (!response.ok) {
      throw new ModelError(
        response.status === 401 || response.status === 403 ? "auth" : "provider_error",
        `Gemini returned ${String(response.status)}.`,
        { details: { status: response.status } },
      );
    }

    const body = (await response.json()) as { models?: unknown };
    if (!Array.isArray(body.models)) return [...GOOGLE_MODELS];
    return (
      body.models
        .map(
          (entry) =>
            entry as {
              name?: unknown;
              displayName?: unknown;
              inputTokenLimit?: unknown;
              supportedGenerationMethods?: unknown;
            },
        )
        // Only models that can actually generate content are useful to Manu;
        // embedding models would otherwise clutter the list.
        .filter(
          (entry) =>
            !Array.isArray(entry.supportedGenerationMethods) ||
            entry.supportedGenerationMethods.includes("generateContent"),
        )
        .filter((entry) => typeof entry.name === "string")
        .map((entry) => {
          const modelId = String(entry.name).replace(/^models\//, "");
          return describeModel({
            provider: this.name,
            modelId,
            displayName: typeof entry.displayName === "string" ? entry.displayName : modelId,
            capabilities: FULL,
            ...(typeof entry.inputTokenLimit === "number"
              ? { contextWindow: entry.inputTokenLimit }
              : {}),
          });
        })
    );
  }

  async testConnection(credentials: ProviderCredentials): Promise<ConnectionTestResult> {
    try {
      const models = await this.discoverModels(credentials);
      return {
        ok: true,
        message: `Connected to Google Gemini. ${String(models.length)} model(s) available.`,
        models: models.length,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (error instanceof ModelError && error.modelCode === "auth") {
        return {
          ok: false,
          message: "Authentication failed — check the Google AI API key.",
          detail,
        };
      }
      return { ok: false, message: "Cannot reach Google Gemini.", detail };
    }
  }
}
