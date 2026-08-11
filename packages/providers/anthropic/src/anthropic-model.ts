import { AppError, NotImplementedError } from "@jellytind/shared";
import {
  parseModelJson,
  type GenerateRequest,
  type GenerateResult,
  type LanguageModel,
  type StreamEvent,
  type StructuredRequest,
  type ToolCallRequest,
  type ToolCallResult,
} from "@jellytind/model-router";
import { fromAnthropicResponse, toAnthropicRequest } from "./mapping";
import type { AnthropicResponseBody } from "./wire";

/** Minimal `fetch` shape so a custom implementation can be injected in tests. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export interface AnthropicModelOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly apiVersion?: string;
  /** Inject a `fetch` implementation (defaults to the global `fetch`). */
  readonly fetch?: FetchLike;
}

export class AnthropicApiError extends AppError {
  constructor(status: number, body: string) {
    super("anthropic_api_error", `Anthropic API request failed (${status}).`, {
      details: { status, body },
    });
  }
}

/**
 * Anthropic implementation of {@link LanguageModel}.
 *
 * The class exposes ONLY the provider-independent interface. All
 * Anthropic-specific request/response shapes stay inside this package (see
 * `wire.ts` and `mapping.ts`). Streaming and tool calling are planned; the
 * generate + structured paths are implemented via the Messages API.
 */
export class AnthropicLanguageModel implements LanguageModel {
  readonly id: string;
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

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const body = toAnthropicRequest(this.model, request);
    const response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": this.apiVersion,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new AnthropicApiError(response.status, await response.text());
    }
    const json = (await response.json()) as AnthropicResponseBody;
    return fromAnthropicResponse(json);
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<T> {
    const { text } = await this.generate(request);
    return parseModelJson(request.schema, text);
  }

  stream(_request: GenerateRequest): AsyncIterable<StreamEvent> {
    throw new NotImplementedError("AnthropicLanguageModel.stream");
  }

  generateWithTools(_request: ToolCallRequest): Promise<ToolCallResult> {
    return Promise.reject(new NotImplementedError("AnthropicLanguageModel.generateWithTools"));
  }
}
