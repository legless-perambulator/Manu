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
import { ROUTING_CLASSES, type RoutingClass } from "@jellytind/domain";
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

/**
 * Which model each class of workflow work uses.
 *
 * Different agents may use different models: structure wants reasoning, prose
 * wants a prose model, bulk review is fine on something smaller, and metadata
 * wants none at all. Stored per machine like the model choice itself, and
 * defaulting to the configured model so a writer who has set one thing up has
 * set all of it up (docs/ORCHESTRATION.md).
 */
export type RoutingSettings = Partial<Record<RoutingClass, ModelSettings>>;

const ROUTING_KEY = "jellytind.routing-settings";

export function loadRoutingSettings(): RoutingSettings {
  try {
    const raw = window.localStorage.getItem(ROUTING_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as RoutingSettings;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveRoutingSettings(settings: RoutingSettings): void {
  try {
    window.localStorage.setItem(ROUTING_KEY, JSON.stringify(settings));
  } catch {
    // Not fatal: the routing simply falls back to the configured model.
  }
}

/** The model settings a routing class resolves to, falling back to the default. */
export function settingsForClass(
  routingClass: RoutingClass,
  routing: RoutingSettings = loadRoutingSettings(),
  fallback: ModelSettings = loadModelSettings(),
): ModelSettings {
  return routing[routingClass] ?? fallback;
}

/** The routing table the orchestrator runs against: class → model id. */
export function routingTable(): { models: Partial<Record<RoutingClass, string>> } {
  const routing = loadRoutingSettings();
  const fallback = loadModelSettings();
  const models: Partial<Record<RoutingClass, string>> = {};
  for (const routingClass of ROUTING_CLASSES) {
    if (routingClass === "local_metadata") continue;
    const chosen = settingsForClass(routingClass, routing, fallback);
    if (chosen.modelId !== "") models[routingClass] = chosen.modelId;
  }
  return { models };
}
