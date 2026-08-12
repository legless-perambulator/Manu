import { AppError } from "@jellytind/shared";
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
  type ToolCallRequest,
  type ToolCallResult,
} from "@jellytind/model-router";
import {
  errorFromStatus,
  errorFromThrown,
  fromAnthropicResponse,
  fromAnthropicToolResponse,
  mapStreamData,
  toAnthropicRequest,
} from "./mapping";
import { decodeByteStream, parseSseStream } from "./sse";
import type { AnthropicResponseBody, AnthropicStreamData } from "./wire";

/** A byte body a streaming response may expose. */
type ByteBody = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

/** Minimal `fetch` shape so a custom implementation can be injected in tests. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  body?: ByteBody | null;
}>;

export interface AnthropicModelOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly apiVersion?: string;
  /** Inject a `fetch` implementation (defaults to the global `fetch`). */
  readonly fetch?: FetchLike;
}

/**
 * Anthropic implementation of {@link LanguageModel}.
 *
 * The class exposes ONLY the provider-independent interface. Every
 * Anthropic-specific request/response shape stays inside this package (see
 * `wire.ts`, `sse.ts` and `mapping.ts`); no vendor type crosses the boundary.
 * All failures — HTTP status, network, abort, timeout, malformed output — are
 * normalised to a typed `ModelError` (docs/MODEL_ROUTER.md).
 */
export class AnthropicLanguageModel implements LanguageModel {
  readonly id: string;
  readonly capabilities: ModelCapabilities = {
    streaming: true,
    structuredOutput: true,
    tools: true,
  };

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiVersion: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: AnthropicModelOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com";
    this.apiVersion = options.apiVersion ?? "2023-06-01";
    this.id = `anthropic:${options.model}`;
    const injected = options.fetch;
    if (injected !== undefined) {
      this.fetchImpl = injected;
    } else if (typeof globalThis.fetch === "function") {
      this.fetchImpl = globalThis.fetch.bind(globalThis) as unknown as FetchLike;
    } else {
      throw new AppError("anthropic_no_fetch", "No fetch implementation available.");
    }
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": this.apiVersion,
    };
  }

  /**
   * Combine a caller's abort signal with a client-side timeout into one signal,
   * returning it plus a cleanup that clears the timer. Aborting maps to a
   * `cancelled` failure; the timeout maps to `timeout`.
   */
  private withSignal(options?: RequestOptions): { signal?: AbortSignal; cleanup: () => void } {
    const { signal: external, timeoutMs } = options ?? {};
    if (timeoutMs === undefined) return { signal: external, cleanup: () => {} };
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new DOMException("Request timed out.", "TimeoutError"));
    }, timeoutMs);
    const onExternalAbort = (): void => controller.abort(external?.reason);
    if (external !== undefined) {
      if (external.aborted) controller.abort(external.reason);
      else external.addEventListener("abort", onExternalAbort, { once: true });
    }
    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        external?.removeEventListener("abort", onExternalAbort);
      },
    };
  }

  /** POST to the Messages API, returning the parsed JSON body or throwing a `ModelError`. */
  private async post(body: unknown, options?: RequestOptions): Promise<AnthropicResponseBody> {
    const { signal, cleanup } = this.withSignal(options);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        ...(signal !== undefined ? { signal } : {}),
      });
      if (!response.ok) throw errorFromStatus(response.status, await response.text());
      return (await response.json()) as AnthropicResponseBody;
    } catch (cause) {
      throw errorFromThrown(cause);
    } finally {
      cleanup();
    }
  }

  async generateText(request: GenerateRequest, options?: RequestOptions): Promise<GenerateResult> {
    const json = await this.post(toAnthropicRequest(this.model, request), options);
    return fromAnthropicResponse(json);
  }

  async generateStructured<T>(request: StructuredRequest<T>, options?: RequestOptions): Promise<T> {
    const { text } = await this.generateText(request, options);
    return parseModelJson(request.schema, text);
  }

  async runWithTools(request: ToolCallRequest, options?: RequestOptions): Promise<ToolCallResult> {
    const body = toAnthropicRequest(this.model, request, { tools: request.tools });
    const json = await this.post(body, options);
    return fromAnthropicToolResponse(json);
  }

  async *streamText(
    request: GenerateRequest,
    options?: RequestOptions,
  ): AsyncIterable<StreamEvent> {
    const { signal, cleanup } = this.withSignal(options);
    const state: { outputTokens: number; stopReason: StopReason; inputTokens: number } = {
      outputTokens: 0,
      stopReason: "stop",
      inputTokens: 0,
    };
    let sawDone = false;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(toAnthropicRequest(this.model, request, { stream: true })),
        ...(signal !== undefined ? { signal } : {}),
      });
      if (!response.ok) throw errorFromStatus(response.status, await response.text());
      const stream = response.body;
      if (stream === undefined || stream === null) {
        throw new ModelError("provider_error", "Anthropic streaming response had no body.");
      }
      for await (const sse of parseSseStream(decodeByteStream(stream))) {
        let parsed: AnthropicStreamData;
        try {
          parsed = JSON.parse(sse.data) as AnthropicStreamData;
        } catch {
          continue;
        }
        const event = mapStreamData(parsed, state);
        if (event !== null) {
          if (event.type === "done") sawDone = true;
          yield event;
        }
      }
    } catch (cause) {
      throw errorFromThrown(cause);
    } finally {
      cleanup();
    }
    if (!sawDone) {
      yield {
        type: "done",
        usage: { inputTokens: state.inputTokens, outputTokens: state.outputTokens },
        stopReason: state.stopReason,
      };
    }
  }
}
