import {
  ModelError,
  describeModel,
  type ConnectionTestResult,
  type ModelDescriptor,
  type ModelProvider,
  type ProviderCredentials,
  type ProviderDescriptor,
} from "@jellytind/model-router";
import { AnthropicLanguageModel, type FetchLike } from "./anthropic-model";

export const ANTHROPIC_PROVIDER_NAME = "anthropic";
export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com";

const FULL_CAPABILITIES = { streaming: true, structuredOutput: true, tools: true } as const;

/**
 * Fallback catalogue for Anthropic.
 *
 * Anthropic publishes a `/v1/models` endpoint, so **discovery is the primary
 * path** and this list is what the settings interface shows before a key is
 * entered, or when the network is unavailable. Keeping it in one place is the
 * point: the audit found stale model IDs with no way to refresh them short of
 * shipping a build (MANU-006).
 *
 * Display names and capability metadata are still useful after discovery,
 * because `/v1/models` returns identifiers and little else.
 */
export const ANTHROPIC_MODELS: readonly ModelDescriptor[] = [
  describeModel({
    provider: ANTHROPIC_PROVIDER_NAME,
    modelId: "claude-opus-5",
    displayName: "Claude Opus 5",
    capabilities: FULL_CAPABILITIES,
    contextWindow: 200_000,
    reasoning: true,
    vision: true,
  }),
  describeModel({
    provider: ANTHROPIC_PROVIDER_NAME,
    modelId: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    capabilities: FULL_CAPABILITIES,
    contextWindow: 200_000,
    reasoning: true,
    vision: true,
  }),
  describeModel({
    provider: ANTHROPIC_PROVIDER_NAME,
    modelId: "claude-fable-5",
    displayName: "Claude Fable 5",
    capabilities: FULL_CAPABILITIES,
    contextWindow: 200_000,
    vision: true,
  }),
  describeModel({
    provider: ANTHROPIC_PROVIDER_NAME,
    modelId: "claude-haiku-4-5-20251001",
    displayName: "Claude Haiku 4.5",
    capabilities: FULL_CAPABILITIES,
    contextWindow: 200_000,
    vision: true,
  }),
];

/** Turn an Anthropic model id into something worth reading in a dropdown. */
function friendlyName(modelId: string): string {
  const known = ANTHROPIC_MODELS.find((model) => model.modelId === modelId);
  if (known !== undefined) return known.displayName;
  return modelId
    .replace(/-(\d{8})$/, "")
    .split("-")
    .map((part) => (/^\d/.test(part) ? part.replace(/(\d)(\d)/, "$1.$2") : part))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export interface AnthropicProviderOptions {
  /** Inject a `fetch` implementation (tests supply a fake; no network). */
  readonly fetch?: FetchLike;
  /** Extra models to offer beyond {@link ANTHROPIC_MODELS}. */
  readonly extraModels?: readonly ModelDescriptor[];
}

/**
 * {@link ModelProvider} implementation for Anthropic, over the official API
 * with an API key. This is an **API connection**: a Claude Pro or Max
 * subscription is an entitlement to Anthropic's own surfaces and does not
 * include API usage, and nothing here implies otherwise
 * (docs/MODEL_ROUTER.md — "Subscriptions").
 */
export class AnthropicProvider implements ModelProvider {
  readonly name = ANTHROPIC_PROVIDER_NAME;

  constructor(private readonly options: AnthropicProviderOptions = {}) {}

  describe(): ProviderDescriptor {
    return {
      id: this.name,
      displayName: "Anthropic",
      summary: "Claude models over the official Anthropic API.",
      auth: "api_key",
      local: false,
      configurableBaseUrl: false,
      defaultBaseUrl: ANTHROPIC_DEFAULT_BASE_URL,
      supportsDiscovery: true,
      credentialsUrl: "https://console.anthropic.com/settings/keys",
      connectionKind: "api",
    };
  }

  models(): ModelDescriptor[] {
    return [...ANTHROPIC_MODELS, ...(this.options.extraModels ?? [])];
  }

  createModel(modelId: string, credentials: ProviderCredentials): AnthropicLanguageModel {
    const apiKey = credentials.apiKey;
    if (apiKey === undefined || apiKey.trim() === "") {
      throw new ModelError("auth", "An Anthropic API key is required.", {
        details: { provider: this.name, modelId },
      });
    }
    return new AnthropicLanguageModel({
      apiKey,
      model: modelId,
      ...(credentials.baseUrl !== undefined ? { baseUrl: credentials.baseUrl } : {}),
      ...(this.options.fetch !== undefined ? { fetch: this.options.fetch } : {}),
    });
  }

  async discoverModels(credentials: ProviderCredentials): Promise<ModelDescriptor[]> {
    const body = await this.request(credentials, "/v1/models?limit=100");
    const data = (body as { data?: unknown }).data;
    if (!Array.isArray(data)) return [...ANTHROPIC_MODELS];

    return data
      .map((entry) => (entry as { id?: unknown }).id)
      .filter((id): id is string => typeof id === "string")
      .map((modelId) =>
        describeModel({
          provider: this.name,
          modelId,
          displayName: friendlyName(modelId),
          // Every model Anthropic serves through the Messages API does all
          // three; this is a documented property of the API, not a guess.
          capabilities: FULL_CAPABILITIES,
          contextWindow:
            ANTHROPIC_MODELS.find((m) => m.modelId === modelId)?.contextWindow ?? 200_000,
        }),
      );
  }

  async testConnection(credentials: ProviderCredentials): Promise<ConnectionTestResult> {
    try {
      const models = await this.discoverModels(credentials);
      return {
        ok: true,
        message: `Connected to Anthropic. ${String(models.length)} model(s) available.`,
        models: models.length,
      };
    } catch (error) {
      return failure(error, "Anthropic");
    }
  }

  private async request(credentials: ProviderCredentials, path: string): Promise<unknown> {
    const apiKey = credentials.apiKey ?? "";
    if (apiKey.trim() === "") {
      throw new ModelError("auth", "An Anthropic API key is required.");
    }
    const fetchImpl = this.options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    const base = credentials.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL;
    const response = await fetchImpl(`${base}${path}`, {
      method: "GET",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: "",
    });
    if (!response.ok) {
      throw new ModelError(
        response.status === 401 || response.status === 403 ? "auth" : "provider_error",
        `Anthropic returned ${String(response.status)}.`,
        { details: { status: response.status } },
      );
    }
    return response.json();
  }
}

/** Map any failure onto something a writer can act on. */
export function failure(error: unknown, label: string): ConnectionTestResult {
  const detail = error instanceof Error ? error.message : String(error);
  if (error instanceof ModelError && error.modelCode === "auth") {
    return {
      ok: false,
      message: `Authentication failed — check the API key for ${label}.`,
      detail,
    };
  }
  return {
    ok: false,
    message: `Could not reach ${label}. Check the address and your network connection.`,
    detail,
  };
}
