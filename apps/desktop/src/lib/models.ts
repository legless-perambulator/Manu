import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  ModelError,
  ProviderRegistry,
  capabilityRefusal,
  type ConnectionTestResult,
  type LanguageModel,
  type ModelCapabilities,
  type ModelDescriptor,
  type ModelProvider,
  type ProviderCredentials,
  type ProviderDescriptor,
  type SecretStore,
} from "@jellytind/model-router";
import { AnthropicProvider } from "@jellytind/provider-anthropic";
import { GoogleProvider } from "@jellytind/provider-google";
import {
  ollamaProvider,
  openAiCompatibleProvider,
  openAiProvider,
  openRouterProvider,
} from "@jellytind/provider-openai-compatible";
import { ROUTING_CLASSES, type RoutingClass } from "@jellytind/domain";
import { isTauri } from "../tauri";
import {
  choiceFor,
  loadAiSettings,
  secretKeyForConnection,
  type AiSettings,
  type ModelChoice,
  type ModelPurpose,
  type ProviderConnection,
} from "./connections";

/**
 * Model configuration for the desktop app.
 *
 * The app talks only to the provider-independent layer: it looks a provider up
 * in the registry, asks it for a {@link LanguageModel}, and calls the interface.
 * No provider SDK type appears here and nothing branches on a particular model
 * name — the catalogue is data, and adding a provider is registering an adapter
 * (docs/MODEL_ROUTER.md).
 */

/**
 * A `fetch` that goes through the Rust host.
 *
 * The browser inside Tauri cannot reach a provider directly — cross-origin
 * requests are blocked, and a local Ollama server would refuse them anyway.
 * Routing through the host also means every request is subject to the
 * capability allowlist in `src-tauri/capabilities/default.json`, which is where
 * "what may this application talk to" is actually decided.
 */
const hostFetch = async (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
): Promise<Response> =>
  tauriFetch(url, {
    method: init.method,
    headers: init.headers,
    ...(init.body !== undefined ? { body: init.body } : {}),
    ...(init.signal !== undefined ? { signal: init.signal } : {}),
  });

function buildRegistry(): ProviderRegistry {
  // Outside Tauri (the browser dev server) there is no host fetch; the adapters
  // fall back to the page's own `fetch`, which CORS will usually block. That
  // surfaces as a typed `network` failure rather than something mysterious.
  const options = isTauri() ? { fetch: hostFetch } : {};
  return new ProviderRegistry().register(
    new AnthropicProvider(options),
    openAiProvider(options),
    new GoogleProvider(options),
    openRouterProvider(options),
    ollamaProvider(options),
    openAiCompatibleProvider(options),
  );
}

/** Every provider adapter this build ships. */
export const PROVIDERS: ProviderRegistry = buildRegistry();

/** What can be connected to, for the settings interface to render. */
export function providerDescriptors(): ProviderDescriptor[] {
  return PROVIDERS.describeAll().sort((a, b) => {
    // Local servers last, so the list opens with what most writers will pick,
    // but they are never hidden — a self-hosted model is a first-class choice.
    if (a.local !== b.local) return a.local ? 1 : -1;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function providerFor(connection: ProviderConnection): ModelProvider | undefined {
  return PROVIDERS.get(connection.providerId);
}

export function describeProvider(providerId: string): ProviderDescriptor | undefined {
  return PROVIDERS.get(providerId)?.describe();
}

/**
 * Assemble the credentials for a connection.
 *
 * The key is read from the OS credential store at the moment of use and handed
 * straight to the adapter. It is never held in React state, never written to a
 * project, and never logged (AGENTS.md — "Secrets").
 */
export async function credentialsFor(
  connection: ProviderConnection,
  secrets: SecretStore,
): Promise<ProviderCredentials> {
  const descriptor = describeProvider(connection.providerId);
  const apiKey =
    descriptor?.auth === "api_key"
      ? await secrets.get(secretKeyForConnection(connection.id))
      : null;
  return {
    ...(apiKey !== null && apiKey !== "" ? { apiKey } : {}),
    ...(connection.baseUrl !== undefined && connection.baseUrl !== ""
      ? { baseUrl: connection.baseUrl }
      : {}),
  };
}

/**
 * The models a connection offers.
 *
 * Discovered models are preferred and cached on the connection, so the
 * interface still lists them when the machine is offline. A provider's built-in
 * catalogue is the fallback, never a replacement — the audit found a frozen
 * dropdown that could only be corrected by shipping a build (MANU-006).
 */
export function modelsFor(connection: ProviderConnection): readonly ModelDescriptor[] {
  const discovered = connection.models;
  if (discovered !== undefined && discovered.length > 0) return discovered;
  return providerFor(connection)?.models() ?? [];
}

export function connectionById(
  settings: AiSettings,
  connectionId: string,
): ProviderConnection | undefined {
  return settings.connections.find((connection) => connection.id === connectionId);
}

/** The descriptor a choice points at, when it is still a real model. */
export function describeChoice(
  settings: AiSettings,
  choice: ModelChoice | null,
): ModelDescriptor | undefined {
  if (choice === null) return undefined;
  const connection = connectionById(settings, choice.connectionId);
  if (connection === undefined) return undefined;
  return modelsFor(connection).find((model) => model.modelId === choice.modelId);
}

/** Ask the provider what it actually has. */
export async function discoverModels(
  connection: ProviderConnection,
  secrets: SecretStore,
): Promise<readonly ModelDescriptor[]> {
  const provider = providerFor(connection);
  if (provider === undefined) {
    throw new ModelError("unsupported", `Unknown provider "${connection.providerId}".`);
  }
  const credentials = await credentialsFor(connection, secrets);
  if (provider.discoverModels === undefined) return provider.models();
  return provider.discoverModels(credentials);
}

/** One small round trip, phrased for a writer rather than a developer. */
export async function testConnection(
  connection: ProviderConnection,
  secrets: SecretStore,
): Promise<ConnectionTestResult> {
  const provider = providerFor(connection);
  if (provider === undefined) {
    return {
      ok: false,
      message: `This build has no adapter for "${connection.providerId}".`,
    };
  }
  try {
    return await provider.testConnection(await credentialsFor(connection, secrets));
  } catch (error) {
    return { ok: false, message: explainModelError(error) };
  }
}

/** Build the model a specific choice names. */
export async function createModelForChoice(
  choice: ModelChoice,
  secrets: SecretStore,
  settings: AiSettings = loadAiSettings(),
): Promise<LanguageModel> {
  const connection = connectionById(settings, choice.connectionId);
  if (connection === undefined) {
    throw new ModelError(
      "unsupported",
      "The configured connection no longer exists. Choose a model in Settings → AI Providers.",
    );
  }
  const provider = providerFor(connection);
  if (provider === undefined) {
    throw new ModelError("unsupported", `Unknown provider "${connection.providerId}".`);
  }
  return provider.createModel(choice.modelId, await credentialsFor(connection, secrets));
}

/**
 * Build the model configured for a kind of work.
 *
 * Anything with no model of its own falls back to the default, so a writer who
 * has configured one thing has configured all of it.
 */
export async function createConfiguredModel(
  secrets: SecretStore,
  purpose: ModelPurpose = "default",
  settings: AiSettings = loadAiSettings(),
): Promise<LanguageModel> {
  const choice = choiceFor(settings, purpose);
  if (choice === null) {
    throw new ModelError(
      "unsupported",
      "No model is configured. Add a provider in Settings → AI Providers.",
    );
  }
  return createModelForChoice(choice, secrets, settings);
}

/**
 * Why the model chosen for a purpose cannot do a piece of work, or `null`.
 *
 * A model that is only *unknown* to support something is allowed through — see
 * `capabilityRefusal`. What is refused is a model known not to do the thing, so
 * the writer is told before the run rather than after it fails.
 */
export function capabilityProblem(
  purpose: ModelPurpose,
  required: readonly (keyof ModelCapabilities)[],
  settings: AiSettings = loadAiSettings(),
): string | null {
  const descriptor = describeChoice(settings, choiceFor(settings, purpose));
  if (descriptor === undefined) return null;
  return capabilityRefusal(descriptor, required);
}

/** Turn a typed model failure into guidance a writer can act on. */
export function explainModelError(error: unknown): string {
  if (!(error instanceof ModelError)) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (error.modelCode) {
    case "auth":
      return "Authentication failed — check the API key for this connection.";
    case "rate_limit":
      return "Rate limited by the provider. Wait a moment and try again.";
    case "network":
      return "Could not reach the provider. Check the address and your network connection.";
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
 * Which purpose a workflow routing class resolves to.
 *
 * The orchestrator asks for a *kind* of thinking; the writer configures a kind
 * of work. `local_metadata` maps to nothing on purpose: the project answers it
 * and no model is involved (docs/ORCHESTRATION.md).
 */
export function purposeForClass(routingClass: RoutingClass): ModelPurpose | null {
  switch (routingClass) {
    case "premium_reasoning":
      return "reasoning";
    case "premium_prose":
      return "drafting";
    case "cheap_analysis":
      return "utility";
    case "local_metadata":
      return null;
  }
}

/** Build the model a workflow step's routing class resolves to. */
export async function createModelForClass(
  routingClass: RoutingClass,
  secrets: SecretStore,
): Promise<LanguageModel> {
  const purpose = purposeForClass(routingClass);
  if (purpose === null) {
    throw new ModelError("unsupported", "This routing class needs no model.");
  }
  return createConfiguredModel(secrets, purpose);
}

/** The routing table the orchestrator runs against: class → model id. */
export function routingTable(settings: AiSettings = loadAiSettings()): {
  models: Partial<Record<RoutingClass, string>>;
} {
  const models: Partial<Record<RoutingClass, string>> = {};
  for (const routingClass of ROUTING_CLASSES) {
    const purpose = purposeForClass(routingClass);
    if (purpose === null) continue;
    const choice = choiceFor(settings, purpose);
    if (choice !== null && choice.modelId !== "") models[routingClass] = choice.modelId;
  }
  return { models };
}
