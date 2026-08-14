import type { LanguageModel } from "./model";
import type { ModelDescriptor } from "./registry";

/**
 * How a provider is authenticated.
 *
 * `none` is not an oversight: a local Ollama server needs no credential, and
 * demanding a fake one would be the kind of small lie that makes local models
 * feel second-class (docs/MODEL_ROUTER.md).
 */
export const AUTH_METHODS = ["api_key", "none"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

/** Credentials/config needed to instantiate a provider's model. */
export interface ProviderCredentials {
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

/**
 * What a provider *is*, before anyone configures one.
 *
 * The settings interface is built from these rather than from a list of
 * hard-coded names, so adding an adapter adds a provider to the product
 * without touching interface code.
 */
export interface ProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  /** One line about what connecting this gets you. */
  readonly summary: string;
  readonly auth: AuthMethod;
  /**
   * True when the service runs on the writer's own machine or network.
   *
   * Surfaced in the interface, because "this never leaves your network" is the
   * single most important thing about a local model and the writer should not
   * have to infer it from a hostname.
   */
  readonly local: boolean;
  /** Whether the writer sets the address themselves (Ollama, self-hosted). */
  readonly configurableBaseUrl: boolean;
  readonly defaultBaseUrl?: string;
  /** Whether the provider can be asked what models it has. */
  readonly supportsDiscovery: boolean;
  /** Where to get a key, for providers that need one. */
  readonly credentialsUrl?: string;
  /**
   * What kind of connection this is, in the writer's terms.
   *
   * Always "API connection" today. A consumer subscription is **not** an API
   * entitlement at any provider Manu supports, and the interface must never
   * imply otherwise (docs/MODEL_ROUTER.md — "Subscriptions").
   */
  readonly connectionKind: "api";
}

/** What a connection test found. */
export interface ConnectionTestResult {
  readonly ok: boolean;
  /** One sentence a writer can act on. Never a stack trace. */
  readonly message: string;
  /** How many models the provider reported, when it was asked. */
  readonly models?: number;
  /** The underlying failure, kept for a diagnostics disclosure. */
  readonly detail?: string;
}

/**
 * A model provider.
 *
 * Adapters translate to and from their own wire formats internally; no
 * provider-specific object crosses this boundary (AGENTS.md — "Provider
 * Independence").
 */
export interface ModelProvider {
  readonly name: string;
  /** Identity and connection shape, for the settings interface. */
  describe(): ProviderDescriptor;
  /** The built-in catalogue. May be empty for discovery-only providers. */
  models(): ModelDescriptor[];
  createModel(modelId: string, credentials: ProviderCredentials): LanguageModel;
  /**
   * Ask the provider what models it has.
   *
   * Present only where the provider genuinely offers it. A frozen dropdown is
   * obsolete the day it ships, so discovery is preferred wherever it exists.
   */
  discoverModels?(credentials: ProviderCredentials): Promise<ModelDescriptor[]>;
  /** One small round trip, mapped to something a writer can act on. */
  testConnection(credentials: ProviderCredentials): Promise<ConnectionTestResult>;
}

/**
 * The registry of provider adapters.
 *
 * Replaces the hard-coded single-element array the audit found (MANU-005).
 * Adding a provider is registering an adapter; nothing else in the application
 * changes.
 */
export class ProviderRegistry {
  private readonly providers = new Map<string, ModelProvider>();

  register(...providers: ModelProvider[]): this {
    for (const provider of providers) this.providers.set(provider.name, provider);
    return this;
  }

  get(id: string): ModelProvider | undefined {
    return this.providers.get(id);
  }

  has(id: string): boolean {
    return this.providers.has(id);
  }

  list(): ModelProvider[] {
    return [...this.providers.values()];
  }

  describeAll(): ProviderDescriptor[] {
    return this.list().map((provider) => provider.describe());
  }
}
