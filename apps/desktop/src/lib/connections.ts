import type { ModelDescriptor } from "@jellytind/model-router";

/**
 * A provider the writer has actually configured.
 *
 * The distinction that matters: a **provider** is a kind of service Manu can
 * talk to; a **connection** is one the writer has set up. Somebody may run two
 * Ollama servers — a laptop and a GPU box — and both are Ollama. The audit
 * found a single global "which provider" dropdown, which cannot express that
 * (docs/MODEL_ROUTER.md).
 *
 * The API key is **not** here. Only its presence is implied by the connection
 * existing; the secret itself lives in the OS credential store, keyed by
 * connection id, and never touches this record (AGENTS.md — "Secrets").
 */
export interface ProviderConnection {
  /** Stable id, also the secret-store key suffix. */
  readonly id: string;
  readonly providerId: string;
  /** The writer's name for it: "Ollama — home server". */
  readonly label: string;
  /** Only for providers whose address the writer sets. */
  readonly baseUrl?: string;
  /** Last discovered models, so the interface is useful while offline. */
  readonly models?: readonly ModelDescriptor[];
  readonly modelsRefreshedAt?: string;
}

/** Which model a kind of work uses. Not routing — just not one model for all. */
export const MODEL_PURPOSES = [
  "default",
  "reasoning",
  "drafting",
  "utility",
  "simulation",
] as const;
export type ModelPurpose = (typeof MODEL_PURPOSES)[number];

export const PURPOSE_LABEL: Readonly<Record<ModelPurpose, string>> = {
  default: "Default",
  reasoning: "Reasoning and structure",
  drafting: "Prose and drafting",
  utility: "Fast utility work",
  simulation: "Reader and character simulation",
};

export const PURPOSE_HINT: Readonly<Record<ModelPurpose, string>> = {
  default: "Used whenever a kind of work has no model of its own.",
  reasoning: "Story architecture, refactor analysis, debugging.",
  drafting: "Writing and rewriting prose.",
  utility: "Short, cheap, frequent work.",
  simulation: "Simulated readers and character behaviour.",
};

/** A model chosen for a purpose: which connection, and which model on it. */
export interface ModelChoice {
  readonly connectionId: string;
  readonly modelId: string;
}

export interface AiSettings {
  readonly connections: readonly ProviderConnection[];
  readonly purposes: Partial<Record<ModelPurpose, ModelChoice>>;
}

const KEY = "manu.ai-settings";
/** The pre-connections key, read once so nobody loses their configuration. */
const LEGACY_KEY = "jellytind.model-settings";

const EMPTY: AiSettings = { connections: [], purposes: {} };

/**
 * Read AI settings, migrating the old single-provider shape if it is all there
 * is.
 *
 * The old format recorded `{ provider, modelId }` and kept the key in the OS
 * credential store under `provider:anthropic:apiKey`. That key is left exactly
 * where it is and the connection is given the matching id, so an existing
 * Anthropic setup keeps working without the writer re-entering anything — and
 * without this code ever reading, logging or moving the secret itself
 * (MANU-016).
 */
export function loadAiSettings(): AiSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<AiSettings>;
      return {
        connections: Array.isArray(parsed.connections) ? parsed.connections : [],
        purposes:
          typeof parsed.purposes === "object" && parsed.purposes !== null ? parsed.purposes : {},
      };
    }
    return migrateLegacy();
  } catch {
    return EMPTY;
  }
}

function migrateLegacy(): AiSettings {
  try {
    const raw = window.localStorage.getItem(LEGACY_KEY);
    if (raw === null) return EMPTY;
    const old = JSON.parse(raw) as { provider?: unknown; modelId?: unknown };
    if (typeof old.provider !== "string" || old.provider === "") return EMPTY;

    // The legacy secret key was `provider:<name>:apiKey`; giving the connection
    // the id `<name>` means `secretKeyForConnection` resolves to the same
    // string, so the existing key is found where it already is.
    const connection: ProviderConnection = {
      id: old.provider,
      providerId: old.provider,
      label: old.provider === "anthropic" ? "Anthropic" : old.provider,
    };
    const migrated: AiSettings = {
      connections: [connection],
      purposes:
        typeof old.modelId === "string" && old.modelId !== ""
          ? { default: { connectionId: connection.id, modelId: old.modelId } }
          : {},
    };
    saveAiSettings(migrated);
    return migrated;
  } catch {
    return EMPTY;
  }
}

export function saveAiSettings(settings: AiSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the writer's choices are not remembered, which is a
    // nuisance rather than a failure. Nothing is lost from the project.
  }
}

/**
 * Where a connection's API key lives.
 *
 * Matches the legacy `provider:<id>:apiKey` shape exactly, which is what makes
 * the migration above a no-op for the secret itself.
 */
export const secretKeyForConnection = (connectionId: string): string =>
  `provider:${connectionId}:apiKey`;

/** The choice for a purpose, falling back to the default. */
export function choiceFor(settings: AiSettings, purpose: ModelPurpose): ModelChoice | null {
  return settings.purposes[purpose] ?? settings.purposes.default ?? null;
}

/** Mint a connection id that does not collide with an existing one. */
export function newConnectionId(
  providerId: string,
  existing: readonly ProviderConnection[],
): string {
  if (!existing.some((c) => c.id === providerId)) return providerId;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${providerId}-${String(n)}`;
    if (!existing.some((c) => c.id === candidate)) return candidate;
  }
  return `${providerId}-${Date.now().toString(36)}`;
}
