import {
  ModelError,
  instrumentModel,
  planRoutes,
  profileFromDescriptor,
  profileKey,
  routeOperation,
  routingPolicy,
  usageRecordFor,
  ALLOW_CLOUD,
  ROUTED_OPERATIONS,
  type BudgetLimits,
  type LanguageModel,
  type ModelAvailability,
  type ModelPricing,
  type ModelProfile,
  type PrivacyPolicy,
  type QualityTier,
  type RouteContext,
  type RouteDecision,
  type RoutePlan,
  type RoutedOperation,
  type RoutingPolicyId,
  type SecretStore,
  type SpeedTier,
  type WorkPurpose,
} from "@jellytind/model-router";
import type { ModelRouteNote } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import { createModelForChoice, describeProvider, modelsFor } from "./models";
import { loadAiSettings, type AiSettings } from "./connections";

/**
 * The Model Router's home in the desktop app (Phase 36).
 *
 * Every workflow that needs a model asks HERE — `routeFor` to know, and
 * `createRoutedModel` to get a model whose calls are usage-recorded — so
 * routing logic exists exactly once (§21). The decision engine itself is the
 * pure `routeOperation` in @jellytind/model-router; this module supplies its
 * inputs: the configured connections as profiles, the writer's purpose
 * assignments as anchors (§5), and the routing settings below.
 */

// ── Routing settings ─────────────────────────────────────────────────────────

export interface RoutingSettings {
  readonly policyId: RoutingPolicyId;
  readonly privacy: PrivacyPolicy;
  /** Absent = no budget configured. Never invented (§13). */
  readonly budgets?: BudgetLimits;
  /** Per-operation pins (§22), as profile keys. */
  readonly pins: Partial<Record<RoutedOperation, string>>;
  /**
   * The writer's pricing table (§9), by profile key. Providers do not publish
   * machine-readable prices, so money enters the system only here — and where
   * it has not, costs are honestly unknown.
   */
  readonly pricing: Record<string, ModelPricing>;
  /** Writer-assigned tiers (§2), by profile key. Unknown until said. */
  readonly tiers: Record<string, { quality?: QualityTier; speed?: SpeedTier }>;
}

const KEY = "manu.routing-settings";

export const DEFAULT_ROUTING_SETTINGS: RoutingSettings = {
  policyId: "balanced",
  privacy: ALLOW_CLOUD,
  pins: {},
  pricing: {},
  tiers: {},
};

export function loadRoutingSettings(): RoutingSettings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return DEFAULT_ROUTING_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<RoutingSettings>;
    return {
      policyId: parsed.policyId ?? "balanced",
      privacy: parsed.privacy ?? ALLOW_CLOUD,
      ...(parsed.budgets !== undefined ? { budgets: parsed.budgets } : {}),
      pins: parsed.pins ?? {},
      pricing: parsed.pricing ?? {},
      tiers: parsed.tiers ?? {},
    };
  } catch {
    return DEFAULT_ROUTING_SETTINGS;
  }
}

export function saveRoutingSettings(settings: RoutingSettings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable: the choices are not remembered. Nothing is lost
    // from the project.
  }
}

// ── Availability (§15) ───────────────────────────────────────────────────────

/**
 * Runtime availability, in memory only: a rate limit is a fact about right
 * now, not configuration. Entries expire on their own.
 */
const unavailable = new Map<string, { until: number; state: "rate_limited" | "unavailable" }>();

export function markModelUnavailable(
  key: string,
  state: "rate_limited" | "unavailable",
  forMs = 60_000,
): void {
  unavailable.set(key, { until: Date.now() + forMs, state });
}

function availabilityOf(key: string): ModelAvailability {
  const held = unavailable.get(key);
  if (held === undefined) return { state: "available" };
  if (Date.now() >= held.until) {
    unavailable.delete(key);
    return { state: "available" };
  }
  return { state: held.state, retryAt: new Date(held.until).toISOString() };
}

// ── Profiles and anchors ─────────────────────────────────────────────────────

/** Every configured model, as a routing profile (§2). */
export function routingProfiles(
  ai: AiSettings = loadAiSettings(),
  routing: RoutingSettings = loadRoutingSettings(),
): ModelProfile[] {
  const profiles: ModelProfile[] = [];
  for (const connection of ai.connections) {
    const local = describeProvider(connection.providerId)?.local === true;
    for (const descriptor of modelsFor(connection)) {
      const key = `${connection.id}:${descriptor.modelId}`;
      const tier = routing.tiers[key];
      const priced = routing.pricing[key];
      const base = profileFromDescriptor(descriptor, {
        connectionId: connection.id,
        local,
        ...(tier?.quality !== undefined ? { qualityTier: tier.quality } : {}),
        ...(tier?.speed !== undefined ? { speedTier: tier.speed } : {}),
        availability: availabilityOf(key),
      });
      profiles.push(priced !== undefined ? { ...base, pricing: priced } : base);
    }
  }
  return profiles;
}

/** The writer's explicit purpose assignments, as anchors (§5). */
export function routingAnchors(
  ai: AiSettings = loadAiSettings(),
): Partial<Record<WorkPurpose, string>> {
  const anchors: Partial<Record<WorkPurpose, string>> = {};
  for (const [purpose, choice] of Object.entries(ai.purposes)) {
    anchors[purpose as WorkPurpose] = `${choice.connectionId}:${choice.modelId}`;
  }
  return anchors;
}

// ── Routing ──────────────────────────────────────────────────────────────────

/** Where an operation would route right now. Pure — nothing is called (§20, §28). */
export function routeFor(
  operation: RoutedOperation,
  options: {
    readonly ai?: AiSettings;
    readonly routing?: RoutingSettings;
    readonly context?: RouteContext;
  } = {},
): RouteDecision {
  const ai = options.ai ?? loadAiSettings();
  const routing = options.routing ?? loadRoutingSettings();
  const pinned = routing.pins[operation];
  return routeOperation({
    operation,
    profiles: routingProfiles(ai, routing),
    policy: routingPolicy(routing.policyId),
    anchors: routingAnchors(ai),
    ...(pinned !== undefined ? { pinned } : {}),
    privacy: routing.privacy,
    ...(options.context !== undefined ? { context: options.context } : {}),
  });
}

/** The whole model plan — for "View model plan" before a build starts (§20). */
export function modelPlanFor(
  operations: readonly RoutedOperation[] = ROUTED_OPERATIONS,
  options: { readonly ai?: AiSettings; readonly routing?: RoutingSettings } = {},
): RoutePlan {
  const ai = options.ai ?? loadAiSettings();
  const routing = options.routing ?? loadRoutingSettings();
  return planRoutes(operations, {
    profiles: routingProfiles(ai, routing),
    policy: routingPolicy(routing.policyId),
    anchors: routingAnchors(ai),
    pins: routing.pins,
    privacy: routing.privacy,
  });
}

/** A decision as build provenance (§19): one sentence, kept on the record. */
export function routeNote(decision: RouteDecision): ModelRouteNote | null {
  if (decision.selected === undefined) return null;
  return {
    operation: decision.operation,
    modelId: decision.selected.modelId,
    reason: decision.reasons.join(" "),
  };
}

// ── Routed models with usage recording (§10, §21) ────────────────────────────

export interface RoutedModel {
  readonly model: LanguageModel;
  readonly decision: RouteDecision;
  readonly profile: ModelProfile;
}

/**
 * Resolve an operation to a ready model whose every call lands in the
 * project's usage ledger with its routing context and cost-at-the-time.
 * Throws a typed `ModelError` when routing is blocked — with the router's
 * full explanation, never a silent re-route (§13, §17, §22).
 */
export async function createRoutedModel(
  repo: StoryRepository,
  secrets: SecretStore,
  operation: RoutedOperation,
  options: {
    readonly buildId?: string;
    readonly ai?: AiSettings;
    readonly routing?: RoutingSettings;
    readonly context?: RouteContext;
  } = {},
): Promise<RoutedModel> {
  const ai = options.ai ?? loadAiSettings();
  const decision = routeFor(operation, {
    ai,
    ...(options.routing !== undefined ? { routing: options.routing } : {}),
    ...(options.context !== undefined ? { context: options.context } : {}),
  });
  const profile = decision.selected;
  if (profile === undefined) {
    throw new ModelError("unsupported", decision.blocked ?? "No model could be routed.");
  }
  const raw = await createModelForChoice(
    { connectionId: profile.connectionId, modelId: profile.modelId },
    secrets,
    ai,
  );
  const key = profileKey(profile);
  const model = instrumentModel(raw, (usage) => {
    const record = usageRecordFor({
      at: new Date().toISOString(),
      profile,
      usage,
      operation,
      ...(options.buildId !== undefined ? { buildId: options.buildId } : {}),
    });
    // Fire-and-forget: accounting must never fail the writer's actual work.
    repo.usage.append(record).catch(() => undefined);
  });
  // Rate limits are availability facts (§15): remember them so the next
  // routing decision can prefer a model that is actually up.
  const guarded: LanguageModel = {
    id: model.id,
    capabilities: model.capabilities,
    generateText: (request, opts) =>
      model.generateText(request, opts).catch((error: unknown) => {
        noteAvailability(key, error);
        throw error;
      }),
    streamText: model.streamText.bind(model),
    generateStructured: (request, opts) =>
      model.generateStructured(request, opts).catch((error: unknown) => {
        noteAvailability(key, error);
        throw error;
      }),
    runWithTools: (request, opts) =>
      model.runWithTools(request, opts).catch((error: unknown) => {
        noteAvailability(key, error);
        throw error;
      }),
  };
  return { model: guarded, decision, profile };
}

function noteAvailability(key: string, error: unknown): void {
  if (error instanceof ModelError && error.modelCode === "rate_limit") {
    markModelUnavailable(key, "rate_limited");
  }
}
