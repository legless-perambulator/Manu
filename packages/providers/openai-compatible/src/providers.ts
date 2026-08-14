import {
  ModelError,
  describeModel,
  type ConnectionTestResult,
  type ModelCapabilities,
  type ModelDescriptor,
  type ModelProvider,
  type ProviderCredentials,
  type ProviderDescriptor,
} from "@jellytind/model-router";
import { OpenAiCompatibleModel, type FetchLike } from "./model";

const FULL: ModelCapabilities = { streaming: true, structuredOutput: true, tools: true };

/**
 * Everything an OpenAI-compatible service needs to differ by.
 *
 * Four providers, one transport. What actually varies between OpenAI,
 * OpenRouter, Ollama and a self-hosted server is the address, the auth, and how
 * you ask what models exist — so that is what this describes, and the wire
 * format is shared (docs/MODEL_ROUTER.md).
 */
export interface CompatibleProviderConfig {
  readonly id: string;
  readonly displayName: string;
  readonly summary: string;
  readonly auth: "api_key" | "none";
  readonly local: boolean;
  readonly configurableBaseUrl: boolean;
  readonly defaultBaseUrl: string;
  readonly credentialsUrl?: string;
  /** Path that lists models, relative to the base URL. */
  readonly modelsPath?: string;
  /**
   * Appended to the base URL for chat only.
   *
   * Ollama serves its own API at the root and an OpenAI-compatible one under
   * `/v1`. Keeping the writer's configured address as the root — what they
   * actually type into a browser to check the server is up — and adding the
   * suffix here is less surprising than asking them to remember `/v1`.
   */
  readonly chatSuffix?: string;
  /** Pull descriptors out of whatever that path returns. */
  readonly parseModels?: (body: unknown, providerId: string) => ModelDescriptor[];
  readonly fallbackModels?: readonly ModelDescriptor[];
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * What is genuinely unknown about a discovered model.
   *
   * For a local server this is everything interesting: the server reports a
   * name, and whether those weights do tool calling is not its business to know.
   */
  readonly unknownCapabilities?: readonly (keyof ModelCapabilities)[];
}

export interface CompatibleProviderOptions {
  readonly fetch?: FetchLike;
}

export class OpenAiCompatibleProvider implements ModelProvider {
  readonly name: string;

  constructor(
    private readonly config: CompatibleProviderConfig,
    private readonly options: CompatibleProviderOptions = {},
  ) {
    this.name = config.id;
  }

  describe(): ProviderDescriptor {
    return {
      id: this.config.id,
      displayName: this.config.displayName,
      summary: this.config.summary,
      auth: this.config.auth,
      local: this.config.local,
      configurableBaseUrl: this.config.configurableBaseUrl,
      defaultBaseUrl: this.config.defaultBaseUrl,
      supportsDiscovery: this.config.modelsPath !== undefined,
      ...(this.config.credentialsUrl === undefined
        ? {}
        : { credentialsUrl: this.config.credentialsUrl }),
      connectionKind: "api",
    };
  }

  models(): ModelDescriptor[] {
    return [...(this.config.fallbackModels ?? [])];
  }

  createModel(modelId: string, credentials: ProviderCredentials): OpenAiCompatibleModel {
    if (this.config.auth === "api_key" && (credentials.apiKey ?? "").trim() === "") {
      throw new ModelError("auth", `An API key is required for ${this.config.displayName}.`, {
        details: { provider: this.name, modelId },
      });
    }
    return new OpenAiCompatibleModel({
      baseUrl: `${this.baseUrl(credentials).replace(/\/+$/, "")}${this.config.chatSuffix ?? ""}`,
      model: modelId,
      ...(credentials.apiKey === undefined ? {} : { apiKey: credentials.apiKey }),
      ...(this.options.fetch === undefined ? {} : { fetch: this.options.fetch }),
      ...(this.config.headers === undefined ? {} : { headers: this.config.headers }),
    });
  }

  async discoverModels(credentials: ProviderCredentials): Promise<ModelDescriptor[]> {
    const path = this.config.modelsPath;
    if (path === undefined) return this.models();

    const fetchImpl = this.options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    const key = credentials.apiKey;
    let response;
    try {
      response = await fetchImpl(`${this.baseUrl(credentials).replace(/\/+$/, "")}${path}`, {
        method: "GET",
        headers: {
          "content-type": "application/json",
          ...(key !== undefined && key.trim() !== "" ? { authorization: `Bearer ${key}` } : {}),
          ...this.config.headers,
        },
      });
    } catch (cause) {
      throw new ModelError("network", `Could not reach ${this.config.displayName}.`, { cause });
    }
    if (!response.ok) {
      throw new ModelError(
        response.status === 401 || response.status === 403 ? "auth" : "provider_error",
        `${this.config.displayName} returned ${String(response.status)}.`,
        { details: { status: response.status } },
      );
    }
    const parse = this.config.parseModels ?? parseOpenAiModels;
    return parse(await response.json(), this.name).map((model) =>
      this.config.unknownCapabilities === undefined
        ? model
        : { ...model, unknownCapabilities: this.config.unknownCapabilities },
    );
  }

  async testConnection(credentials: ProviderCredentials): Promise<ConnectionTestResult> {
    const label =
      this.config.configurableBaseUrl && credentials.baseUrl !== undefined
        ? `${this.config.displayName} at ${hostOf(credentials.baseUrl)}`
        : this.config.displayName;
    try {
      const models = await this.discoverModels(credentials);
      if (models.length === 0) {
        return {
          ok: true,
          message: `Connected to ${label}, but it reported no models.`,
          models: 0,
        };
      }
      return {
        ok: true,
        message: `Connected to ${label}. ${String(models.length)} model(s) available.`,
        models: models.length,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (error instanceof ModelError && error.modelCode === "auth") {
        return {
          ok: false,
          message: `Authentication failed — check the API key for ${label}.`,
          detail,
        };
      }
      return { ok: false, message: `Cannot reach ${label}.`, detail };
    }
  }

  private baseUrl(credentials: ProviderCredentials): string {
    const chosen = this.config.configurableBaseUrl ? credentials.baseUrl : undefined;
    return (chosen ?? this.config.defaultBaseUrl).trim();
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** `{ data: [{ id }] }` — the shape OpenAI, OpenRouter and most others use. */
export function parseOpenAiModels(body: unknown, providerId: string): ModelDescriptor[] {
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => entry as { id?: unknown; name?: unknown; context_length?: unknown })
    .filter((entry) => typeof entry.id === "string")
    .map((entry) =>
      describeModel({
        provider: providerId,
        modelId: String(entry.id),
        displayName: typeof entry.name === "string" ? entry.name : String(entry.id),
        capabilities: FULL,
        ...(typeof entry.context_length === "number"
          ? { contextWindow: entry.context_length }
          : {}),
      }),
    );
}

/** Ollama's native `/api/tags` — `{ models: [{ name, details }] }`. */
export function parseOllamaModels(body: unknown, providerId: string): ModelDescriptor[] {
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  return models
    .map((entry) => entry as { name?: unknown; model?: unknown })
    .map((entry) => (typeof entry.name === "string" ? entry.name : entry.model))
    .filter((name): name is string => typeof name === "string")
    .map((name) =>
      describeModel({
        provider: providerId,
        modelId: name,
        displayName: name,
        // Streaming is a property of the server and is always available.
        // Whether these particular weights do tools or reliable JSON is not
        // something Ollama reports, so it is recorded as unknown rather than
        // asserted (docs/MODEL_ROUTER.md).
        capabilities: { streaming: true, structuredOutput: true, tools: true },
        unknownCapabilities: ["tools", "structuredOutput"],
      }),
    );
}

// ── The shipped provider identities ─────────────────────────────────────────

export const OPENAI_PROVIDER_ID = "openai";
export const OPENROUTER_PROVIDER_ID = "openrouter";
export const OLLAMA_PROVIDER_ID = "ollama";
export const OPENAI_COMPATIBLE_PROVIDER_ID = "openai_compatible";

/**
 * OpenAI, over the official API with an API key.
 *
 * A ChatGPT Plus or Pro subscription is a consumer entitlement to OpenAI's own
 * surfaces; it does not include API usage and cannot authenticate a third-party
 * application. Nothing here implies otherwise.
 */
export const openAiProvider = (options?: CompatibleProviderOptions) =>
  new OpenAiCompatibleProvider(
    {
      id: OPENAI_PROVIDER_ID,
      displayName: "OpenAI",
      summary: "GPT models over the official OpenAI API.",
      auth: "api_key",
      local: false,
      configurableBaseUrl: false,
      defaultBaseUrl: "https://api.openai.com/v1",
      credentialsUrl: "https://platform.openai.com/api-keys",
      modelsPath: "/models",
    },
    options ?? {},
  );

/** OpenRouter — many model families through one connection. */
export const openRouterProvider = (options?: CompatibleProviderOptions) =>
  new OpenAiCompatibleProvider(
    {
      id: OPENROUTER_PROVIDER_ID,
      displayName: "OpenRouter",
      summary: "Many model families — Anthropic, OpenAI, Google, open weights — through one key.",
      auth: "api_key",
      local: false,
      configurableBaseUrl: false,
      defaultBaseUrl: "https://openrouter.ai/api/v1",
      credentialsUrl: "https://openrouter.ai/keys",
      modelsPath: "/models",
      headers: { "HTTP-Referer": "https://manu.app", "X-Title": "Manu" },
    },
    options ?? {},
  );

/**
 * Ollama, wherever it is running.
 *
 * Discovery uses Ollama's native `/api/tags`; generation uses its
 * OpenAI-compatible endpoint. The address is the writer's to set — a model
 * server on another machine is the normal case for anyone with a GPU box, and
 * assuming localhost would quietly exclude them.
 */
export const ollamaProvider = (options?: CompatibleProviderOptions) =>
  new OpenAiCompatibleProvider(
    {
      id: OLLAMA_PROVIDER_ID,
      displayName: "Ollama",
      summary: "Local or self-hosted models. Nothing leaves your network.",
      auth: "none",
      local: true,
      configurableBaseUrl: true,
      defaultBaseUrl: "http://localhost:11434",
      chatSuffix: "/v1",
      modelsPath: "/api/tags",
      parseModels: parseOllamaModels,
      unknownCapabilities: ["tools", "structuredOutput"],
    },
    options ?? {},
  );

/** Any other service speaking the OpenAI chat-completions API. */
export const openAiCompatibleProvider = (options?: CompatibleProviderOptions) =>
  new OpenAiCompatibleProvider(
    {
      id: OPENAI_COMPATIBLE_PROVIDER_ID,
      displayName: "OpenAI-compatible",
      summary:
        "Any other service speaking the OpenAI API — LM Studio, vLLM, llama.cpp, a hosted gateway.",
      auth: "api_key",
      local: true,
      configurableBaseUrl: true,
      defaultBaseUrl: "http://localhost:8080/v1",
      modelsPath: "/models",
      unknownCapabilities: ["tools", "structuredOutput"],
    },
    options ?? {},
  );
