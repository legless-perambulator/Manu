import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  ModelError,
  ModelRegistry,
  secretKeyForProvider,
  type LanguageModel,
  type ModelDescriptor,
  type ModelProvider,
  type SecretStore,
} from "@jellytind/model-router";
import { AnthropicProvider, type FetchLike } from "@jellytind/provider-anthropic";
import { isTauri } from "../tauri";

/**
 * Model configuration for the desktop app.
 *
 * The app talks only to the provider-independent layer: it picks a
 * {@link ModelProvider} by name, asks it for a {@link LanguageModel}, and calls
 * the interface. No Anthropic SDK type appears here, and nothing branches on a
 * particular model name — the catalog is data (docs/MODEL_ROUTER.md).
 */

/** Route provider HTTP through the Rust host, which is scoped by capabilities. */
const hostFetch: FetchLike = async (url, init) => {
  const response = await tauriFetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    ...(init.signal !== undefined ? { signal: init.signal } : {}),
  });
  return response;
};

function buildProviders(): ModelProvider[] {
  // Outside Tauri there is no host fetch; the browser's own fetch is used and
  // will be blocked by CORS, surfacing as a typed `network` failure.
  const anthropic = isTauri()
    ? new AnthropicProvider({ fetch: hostFetch })
    : new AnthropicProvider();
  return [anthropic];
}

/** Providers available in this build, keyed by name. */
export const PROVIDERS: ReadonlyMap<string, ModelProvider> = new Map(
  buildProviders().map((provider) => [provider.name, provider]),
);

/** Catalog of every model every registered provider offers. */
export const MODEL_REGISTRY: ModelRegistry = new ModelRegistry().register(
  ...[...PROVIDERS.values()].flatMap((provider) => provider.models()),
);

export interface ModelSettings {
  readonly provider: string;
  readonly modelId: string;
}

const SETTINGS_KEY = "jellytind.model-settings";

function firstModel(): ModelSettings {
  const first = MODEL_REGISTRY.list()[0];
  return first === undefined
    ? { provider: "", modelId: "" }
    : { provider: first.provider, modelId: first.modelId };
}

/**
 * Load the selected provider/model. This is a non-secret machine preference, so
 * it lives in browser-local storage — never in a Story Repository, which stays
 * portable and free of machine-specific configuration.
 */
export function loadModelSettings(): ModelSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return firstModel();
    const parsed = JSON.parse(raw) as Partial<ModelSettings>;
    if (typeof parsed.provider === "string" && typeof parsed.modelId === "string") {
      return { provider: parsed.provider, modelId: parsed.modelId };
    }
  } catch {
    // Corrupt or unavailable storage falls back to the first known model.
  }
  return firstModel();
}

export function saveModelSettings(settings: ModelSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage being unavailable is not fatal; the choice just is not remembered.
  }
}

export function describeSelected(settings: ModelSettings): ModelDescriptor | undefined {
  return MODEL_REGISTRY.get(settings.provider, settings.modelId);
}

/**
 * Build the configured {@link LanguageModel}, reading the API key from secure
 * storage at call time so the key is never held in application state longer than
 * a request needs it.
 */
export async function createConfiguredModel(
  settings: ModelSettings,
  secrets: SecretStore,
): Promise<LanguageModel> {
  const provider = PROVIDERS.get(settings.provider);
  if (provider === undefined) {
    throw new ModelError("unsupported", `Unknown provider "${settings.provider}".`);
  }
  const apiKey = await secrets.get(secretKeyForProvider(settings.provider));
  return provider.createModel(settings.modelId, {
    ...(apiKey !== null ? { apiKey } : {}),
  });
}

export interface ConnectionTestResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Perform one small real call through the provider-independent layer. Every
 * failure mode arrives as a typed {@link ModelError}, so the UI can explain what
 * went wrong without knowing anything about the provider's HTTP semantics.
 */
export async function testConnection(
  settings: ModelSettings,
  secrets: SecretStore,
): Promise<ConnectionTestResult> {
  try {
    const model = await createConfiguredModel(settings, secrets);
    const result = await model.generateText(
      {
        system: "Reply with the single word: ready.",
        messages: [{ role: "user", content: "Connection test." }],
        maxOutputTokens: 16,
      },
      { timeoutMs: 30_000 },
    );
    const reply = result.text.trim();
    return {
      ok: true,
      message: `Connected. Model replied "${reply === "" ? "(empty)" : reply}" (${
        result.usage.inputTokens
      } in / ${result.usage.outputTokens} out tokens).`,
    };
  } catch (error) {
    return { ok: false, message: explainModelError(error) };
  }
}

/** Turn a typed model failure into guidance a writer can act on. */
export function explainModelError(error: unknown): string {
  if (!(error instanceof ModelError)) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (error.modelCode) {
    case "auth":
      return "Authentication failed — check the API key for this provider.";
    case "rate_limit":
      return "Rate limited by the provider. Wait a moment and try again.";
    case "network":
      return "Could not reach the provider. Check your network connection.";
    case "timeout":
      return "The request timed out before the provider responded.";
    case "cancelled":
      return "The request was cancelled.";
    case "invalid_output":
      return "The model returned output that did not match the expected shape.";
    case "unsupported":
      return error.message;
    default:
      return `Provider error: ${error.message}`;
  }
}
