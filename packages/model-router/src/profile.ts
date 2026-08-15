import type { ModelDescriptor } from "./registry";
import type { ModelCapabilities } from "./types";

/**
 * The routing profile of a configured model (Phase 36 §2).
 *
 * A {@link ModelDescriptor} says what a model *is*; a profile says what it is
 * **to this writer's configuration**: which connection reaches it, whether it
 * runs locally, what it costs, and how good and how fast the writer (or the
 * catalogue) believes it to be. The router reads profiles and nothing else.
 *
 * Unknown values stay unknown. A discovered local model with no published
 * capability table is not assigned guesses — `unknownCapabilities`, an absent
 * `qualityTier`, an absent `pricing` are all honest answers, and every routing
 * rule that reads them says what it does about "unknown"
 * (docs/MODEL_ROUTER.md — "Do not guess unknown capabilities").
 */

/** How good the model's output is believed to be. Assigned, never guessed. */
export const QUALITY_TIERS = ["frontier", "strong", "basic"] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

/** How quickly it answers, relative to its peers. Assigned, never guessed. */
export const SPEED_TIERS = ["fast", "standard", "slow"] as const;
export type SpeedTier = (typeof SPEED_TIERS)[number];

/**
 * Where a request to this model goes. `local` means the writer's own machine
 * or network; everything else is `cloud`, whatever the vendor calls it.
 */
export const PRIVACY_CLASSES = ["local", "cloud"] as const;
export type PrivacyClass = (typeof PRIVACY_CLASSES)[number];

export const AVAILABILITY_STATES = ["available", "rate_limited", "unavailable"] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];

/**
 * Whether the model can currently be called. Rate limiting is *temporary*
 * unavailability — a fact with an expiry, not a failure of the model
 * (Phase 36 §15).
 */
export interface ModelAvailability {
  readonly state: AvailabilityState;
  /** When a rate limit is expected to lift, if the provider said. */
  readonly retryAt?: string;
  readonly reason?: string;
}

/** Price per million tokens, in `currency`. Absent fields mean *unknown*. */
export interface ModelPricing {
  readonly inputPer1M?: number;
  readonly outputPer1M?: number;
  /** ISO 4217, e.g. "USD". */
  readonly currency?: string;
}

export interface ModelProfile {
  /** The configured connection that reaches this model. */
  readonly connectionId: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly capabilities: ModelCapabilities;
  /** Capabilities nobody has actually told us about. */
  readonly unknownCapabilities?: readonly (keyof ModelCapabilities)[];
  /** True when the model accepts images. Absent when nobody has said. */
  readonly vision?: boolean;
  /** True when the model is a reasoning model. Absent when nobody has said. */
  readonly reasoning?: boolean;
  /** Maximum context, in tokens. Absent when unknown. */
  readonly contextWindow?: number;
  /** Maximum output, in tokens. Absent when unknown. */
  readonly outputLimit?: number;
  readonly qualityTier?: QualityTier;
  readonly speedTier?: SpeedTier;
  /** Absent entirely when no pricing is known (§9). */
  readonly pricing?: ModelPricing;
  readonly local: boolean;
  readonly privacyClass: PrivacyClass;
  readonly availability: ModelAvailability;
}

export const AVAILABLE: ModelAvailability = { state: "available" };

/** The stable key routing decisions and pins refer to a profile by. */
export const profileKey = (profile: Pick<ModelProfile, "connectionId" | "modelId">): string =>
  `${profile.connectionId}:${profile.modelId}`;

/**
 * Build a profile from a catalogue descriptor plus what only the configuration
 * knows: the connection, whether it is local, and any writer-assigned tiers.
 */
export function profileFromDescriptor(
  descriptor: ModelDescriptor,
  config: {
    readonly connectionId: string;
    readonly local: boolean;
    readonly qualityTier?: QualityTier;
    readonly speedTier?: SpeedTier;
    readonly availability?: ModelAvailability;
    readonly outputLimit?: number;
  },
): ModelProfile {
  const cost = descriptor.costMetadata;
  const pricing: ModelPricing | undefined =
    cost !== undefined && (cost.inputPer1M !== undefined || cost.outputPer1M !== undefined)
      ? {
          ...(cost.inputPer1M !== undefined ? { inputPer1M: cost.inputPer1M } : {}),
          ...(cost.outputPer1M !== undefined ? { outputPer1M: cost.outputPer1M } : {}),
          ...(cost.currency !== undefined ? { currency: cost.currency } : {}),
        }
      : undefined;
  return {
    connectionId: config.connectionId,
    providerId: descriptor.provider,
    modelId: descriptor.modelId,
    displayName: descriptor.displayName,
    capabilities: descriptor.capabilities,
    ...(descriptor.unknownCapabilities !== undefined
      ? { unknownCapabilities: descriptor.unknownCapabilities }
      : {}),
    ...(descriptor.vision !== undefined ? { vision: descriptor.vision } : {}),
    ...(descriptor.reasoning !== undefined ? { reasoning: descriptor.reasoning } : {}),
    ...(descriptor.contextWindow !== undefined ? { contextWindow: descriptor.contextWindow } : {}),
    ...(config.outputLimit !== undefined ? { outputLimit: config.outputLimit } : {}),
    ...(config.qualityTier !== undefined ? { qualityTier: config.qualityTier } : {}),
    ...(config.speedTier !== undefined ? { speedTier: config.speedTier } : {}),
    ...(pricing !== undefined ? { pricing } : {}),
    local: config.local,
    privacyClass: config.local ? "local" : "cloud",
    availability: config.availability ?? AVAILABLE,
  };
}
