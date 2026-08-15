/**
 * Routing policies (Phase 36 §4).
 *
 * A policy is a named, inspectable preference — not magic. Each one answers
 * the same question ("of the models that CAN do this work, which should?") a
 * different way, and the route preview shows the answer before anything runs.
 */

export const ROUTING_POLICY_IDS = [
  "best_quality",
  "balanced",
  "economy",
  "local_first",
  "custom",
] as const;
export type RoutingPolicyId = (typeof ROUTING_POLICY_IDS)[number];

/** What to do when the chosen model is temporarily unavailable (§14–15). */
export const FALLBACK_BEHAVIOURS = ["next_compatible", "wait", "pause"] as const;
export type FallbackBehaviour = (typeof FALLBACK_BEHAVIOURS)[number];

export interface FallbackPolicy {
  readonly onUnavailable: FallbackBehaviour;
  /** How long "wait" waits before giving up, when the provider gave no time. */
  readonly maxWaitMs?: number;
}

export interface RoutingPolicy {
  readonly id: RoutingPolicyId;
  readonly label: string;
  /** One sentence a writer can act on. */
  readonly summary: string;
  readonly fallback: FallbackPolicy;
}

export const ROUTING_POLICIES: Readonly<Record<RoutingPolicyId, RoutingPolicy>> = {
  best_quality: {
    id: "best_quality",
    label: "Best quality",
    summary: "The strongest configured model for every kind of work, whatever it costs.",
    fallback: { onUnavailable: "next_compatible" },
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    summary: "Premium models where quality genuinely matters; economical models for bulk analysis.",
    fallback: { onUnavailable: "next_compatible" },
  },
  economy: {
    id: "economy",
    label: "Economy",
    summary: "The cheapest capable model wherever the work allows it.",
    fallback: { onUnavailable: "next_compatible" },
  },
  local_first: {
    id: "local_first",
    label: "Local first",
    summary:
      "Local models for everything they can do well; cloud models only where the work needs them.",
    fallback: { onUnavailable: "next_compatible" },
  },
  custom: {
    id: "custom",
    label: "Custom",
    summary: "Your explicit per-purpose assignments, exactly as configured.",
    fallback: { onUnavailable: "next_compatible" },
  },
};

export function routingPolicy(id: RoutingPolicyId): RoutingPolicy {
  return ROUTING_POLICIES[id];
}
