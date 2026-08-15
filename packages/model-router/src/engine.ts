import { profileKey, type ModelProfile } from "./profile";
import { requirementsFor, type OperationRequirements, type RoutedOperation } from "./requirements";
import type { RoutingPolicy } from "./policy";
import { privacyRefusal, ALLOW_CLOUD, type ContentClass, type PrivacyPolicy } from "./privacy";
import type { ModelCapabilities } from "./types";
import type { WorkPurpose } from "./requirements";

/**
 * The routing engine (Phase 36).
 *
 * One deterministic, side-effect-free function from (operation, configured
 * models, policy, overrides) to a decision with its reasons. Because it is
 * pure, the SAME function answers three questions: which model will actually
 * run (§21), what the route preview should show before anything starts (§20),
 * and what a routing test asserts without a single live API call (§28).
 *
 * Order of authority, deliberately fixed:
 *
 *  1. **Capability, context-size and privacy filters** (§6, §7, §17) — a model
 *     that cannot or may not do the work is out, whatever any preference says.
 *     Privacy restrictions are never routed around.
 *  2. **A pin** (§22) — the writer's word for one operation. An incompatible
 *     pin BLOCKS the operation with the incompatibility stated; it is never
 *     silently ignored.
 *  3. **The policy** (§4), anchored by the writer's purpose assignments (§5).
 *  4. **Availability** (§14–15) — last, so a fallback is always "the best
 *     eligible model that is actually up", and the decision records what it
 *     fell back from.
 */

export interface RouteContext {
  /** Estimated prompt tokens, from the Context Compiler where known (§7). */
  readonly contextTokens?: number;
  /** Required output budget in tokens, where known (§8). */
  readonly outputTokens?: number;
  /** What the operation sends. Defaults per operation, honestly broad. */
  readonly contentClass?: ContentClass;
}

export interface RouteInputs {
  readonly operation: RoutedOperation;
  readonly profiles: readonly ModelProfile[];
  readonly policy: RoutingPolicy;
  /**
   * The writer's manual purpose assignments, as profile keys (§5). These are
   * anchors: under Best quality, Balanced and Custom an explicit assignment
   * for the operation's purpose is simply used; Economy and Local first may
   * prefer elsewhere for the work those policies exist for, and say so.
   */
  readonly anchors?: Partial<Record<WorkPurpose, string>>;
  /** Profile key this operation is pinned to (§22), if any. */
  readonly pinned?: string;
  readonly privacy?: PrivacyPolicy;
  readonly context?: RouteContext;
}

export interface RouteExclusion {
  readonly profile: string;
  readonly displayName: string;
  readonly reason: string;
}

export interface RouteDecision {
  readonly operation: RoutedOperation;
  readonly policyId: string;
  /** Absent when blocked. */
  readonly selected?: ModelProfile;
  /** Writer-readable sentences: why this model, in this order. */
  readonly reasons: readonly string[];
  readonly excluded: readonly RouteExclusion[];
  /** The model that was preferred but unavailable, when a fallback happened (§14). */
  readonly fallbackFrom?: RouteExclusion;
  /** Set when no eligible model remains. States every reason. */
  readonly blocked?: string;
}

/** A whole workflow's routing, computed up front — the §20 preview / §28 simulation. */
export interface RoutePlan {
  readonly policyId: string;
  readonly decisions: readonly RouteDecision[];
}

/** What each operation sends, when the caller does not say. Honestly broad:
 * anything that reads or writes scene text is treated as carrying prose. */
export function defaultContentClass(operation: RoutedOperation): ContentClass {
  switch (operation) {
    case "research":
      return "research_query";
    case "story_architecture":
    case "chapter_planning":
    case "metadata_extraction":
    case "search_query":
      return "story_metadata";
    default:
      return "manuscript_prose";
  }
}

const capabilityState = (
  profile: ModelProfile,
  capability: keyof ModelCapabilities,
): "yes" | "no" | "unknown" => {
  if (profile.unknownCapabilities?.includes(capability) === true) return "unknown";
  return profile.capabilities[capability] ? "yes" : "no";
};

/** Why the profile cannot do the work, or `null`. Unknown is let through (§2). */
function capabilityExclusion(req: OperationRequirements, profile: ModelProfile): string | null {
  const missing: string[] = [];
  if (req.structuredOutput === "required" && capabilityState(profile, "structuredOutput") === "no")
    missing.push("structured output");
  if (req.tools === "required" && capabilityState(profile, "tools") === "no")
    missing.push("tool calling");
  if (req.streaming === "required" && capabilityState(profile, "streaming") === "no")
    missing.push("streaming");
  if (req.vision === "required" && profile.vision === false) missing.push("vision");
  if (missing.length === 0) return null;
  return `does not support ${missing.join(" or ")}, which ${req.label.toLowerCase()} needs`;
}

/** Why the work does not fit the model's limits, or `null`. Unknown limits pass (§7). */
function contextExclusion(context: RouteContext | undefined, profile: ModelProfile): string | null {
  if (context === undefined) return null;
  const needed = (context.contextTokens ?? 0) + (context.outputTokens ?? 0);
  if (profile.contextWindow !== undefined && needed > profile.contextWindow) {
    return `context window of ${String(profile.contextWindow)} tokens is smaller than the ~${String(needed)} this operation needs`;
  }
  if (
    profile.outputLimit !== undefined &&
    context.outputTokens !== undefined &&
    context.outputTokens > profile.outputLimit
  ) {
    return `output limit of ${String(profile.outputLimit)} tokens is below the ~${String(context.outputTokens)} this operation needs`;
  }
  return null;
}

const QUALITY_RANK = { frontier: 3, strong: 2, basic: 1 } as const;
const qualityRank = (profile: ModelProfile): number =>
  profile.qualityTier !== undefined ? QUALITY_RANK[profile.qualityTier] : 0;

/**
 * Combined price per 1M tokens for ranking. A local model is free, but
 * routing work local is Local First's explicit job (§16, §30) — under a cost
 * preference it ranks after known-priced cloud models rather than silently
 * winning on price zero, so switching policies means what it says. Unknown
 * pricing ranks last: "probably cheap" is not a fact.
 */
const costRank = (profile: ModelProfile): number => {
  if (profile.local) return Number.MAX_SAFE_INTEGER;
  const pricing = profile.pricing;
  if (pricing?.inputPer1M === undefined && pricing?.outputPer1M === undefined)
    return Number.POSITIVE_INFINITY;
  return (pricing.inputPer1M ?? 0) + (pricing.outputPer1M ?? 0);
};

interface Pick {
  readonly profile: ModelProfile;
  readonly why: string;
}

const byKey = (a: ModelProfile, b: ModelProfile): number =>
  profileKey(a).localeCompare(profileKey(b));

const find = (set: readonly ModelProfile[], key: string | undefined): ModelProfile | undefined =>
  key === undefined ? undefined : set.find((p) => profileKey(p) === key);

const qualityDemanded = (req: OperationRequirements): boolean =>
  req.reasoning === "high" || req.proseQuality === "high";

function bestByQuality(set: readonly ModelProfile[], anchor?: ModelProfile): Pick {
  const sorted = [...set].sort((a, b) => qualityRank(b) - qualityRank(a) || byKey(a, b));
  const top = sorted[0] as ModelProfile;
  if (anchor !== undefined && qualityRank(anchor) >= qualityRank(top)) {
    return { profile: anchor, why: "your configured model, and nothing stronger is configured" };
  }
  return {
    profile: top,
    why:
      top.qualityTier !== undefined
        ? `the strongest configured model (${top.qualityTier})`
        : "no configured model has a known quality tier; first by stable order",
  };
}

function bestByCost(set: readonly ModelProfile[]): Pick {
  const sorted = [...set].sort((a, b) => costRank(a) - costRank(b) || byKey(a, b));
  const top = sorted[0] as ModelProfile;
  if (top.local) return { profile: top, why: "a local model — no API cost" };
  if (costRank(top) === Number.POSITIVE_INFINITY) {
    return { profile: top, why: "no configured model has known pricing; first by stable order" };
  }
  return { profile: top, why: "the cheapest configured model with known pricing" };
}

/**
 * The policy's choice among eligible profiles. Anchors are the writer's
 * purpose assignments; `anchorExplicit` is one set for this very purpose,
 * `anchorDefault` the default-model fallback.
 */
function pickForPolicy(
  set: readonly ModelProfile[],
  req: OperationRequirements,
  policy: RoutingPolicy,
  anchorExplicit: ModelProfile | undefined,
  anchorDefault: ModelProfile | undefined,
): Pick {
  const anchor = anchorExplicit ?? anchorDefault;
  const anchorWhy =
    anchorExplicit !== undefined
      ? `your model for "${req.purpose}" work`
      : "your default model (no specific assignment)";

  switch (policy.id) {
    case "custom":
      if (anchor !== undefined) return { profile: anchor, why: anchorWhy };
      return bestByQuality(set);
    case "best_quality":
      if (anchorExplicit !== undefined) return { profile: anchorExplicit, why: anchorWhy };
      return bestByQuality(set, anchorDefault);
    case "balanced":
      if (anchorExplicit !== undefined) return { profile: anchorExplicit, why: anchorWhy };
      if (qualityDemanded(req)) return bestByQuality(set, anchorDefault);
      if (req.costSensitivity === "high") return bestByCost(set);
      if (anchor !== undefined) return { profile: anchor, why: anchorWhy };
      return bestByQuality(set);
    case "economy": {
      if (qualityDemanded(req)) {
        if (anchorExplicit !== undefined) return { profile: anchorExplicit, why: anchorWhy };
        return bestByQuality(set, anchorDefault);
      }
      const cheap = bestByCost(set);
      return { profile: cheap.profile, why: `economy policy — ${cheap.why}` };
    }
    case "local_first": {
      const locals = set.filter((p) => p.local);
      if (req.localEligible === true && locals.length > 0) {
        const localAnchor = anchor !== undefined && anchor.local ? anchor : undefined;
        const top = localAnchor ?? ([...locals].sort(byKey)[0] as ModelProfile);
        return {
          profile: top,
          why: "local-first policy — this work stays on your machine",
        };
      }
      if (anchorExplicit !== undefined) return { profile: anchorExplicit, why: anchorWhy };
      if (qualityDemanded(req)) return bestByQuality(set, anchorDefault);
      if (anchor !== undefined) return { profile: anchor, why: anchorWhy };
      return bestByQuality(set);
    }
  }
}

export function routeOperation(inputs: RouteInputs): RouteDecision {
  const req = requirementsFor(inputs.operation);
  const privacy = inputs.privacy ?? ALLOW_CLOUD;
  const contentClass = inputs.context?.contentClass ?? defaultContentClass(inputs.operation);
  const base = { operation: inputs.operation, policyId: inputs.policy.id };

  // 1. Filters. Every exclusion is recorded with its reason.
  const excluded: RouteExclusion[] = [];
  const eligible: ModelProfile[] = [];
  for (const profile of [...inputs.profiles].sort(byKey)) {
    const reason =
      capabilityExclusion(req, profile) ??
      contextExclusion(inputs.context, profile) ??
      privacyRefusal(privacy, profile, contentClass);
    if (reason !== null) {
      excluded.push({ profile: profileKey(profile), displayName: profile.displayName, reason });
    } else {
      eligible.push(profile);
    }
  }

  if (eligible.length === 0) {
    return {
      ...base,
      reasons: [],
      excluded,
      blocked:
        excluded.length === 0
          ? "No models are configured. Add a provider in Settings → AI Providers."
          : `No configured model can do ${req.label.toLowerCase()}: ${excluded
              .map((entry) => `${entry.displayName} ${entry.reason}`)
              .join("; ")}.`,
    };
  }

  // 2. A pin is the writer's word. Incompatible → surfaced, never ignored (§22).
  if (inputs.pinned !== undefined) {
    const pinnedEligible = find(eligible, inputs.pinned);
    if (pinnedEligible === undefined) {
      const pinnedExcluded = excluded.find((entry) => entry.profile === inputs.pinned);
      return {
        ...base,
        reasons: [],
        excluded,
        blocked:
          pinnedExcluded !== undefined
            ? `This operation is pinned to ${pinnedExcluded.displayName}, which ${pinnedExcluded.reason}. Unpin it or choose a compatible model.`
            : `This operation is pinned to a model that is no longer configured (${inputs.pinned}). Unpin it or restore the connection.`,
      };
    }
    return resolveAvailability(base, req, [pinnedEligible], eligible, excluded, {
      profile: pinnedEligible,
      why: "pinned to this model for this operation",
    });
  }

  // 3–4. Policy choice, then availability.
  const anchorExplicit = find(eligible, inputs.anchors?.[req.purpose]);
  const anchorDefault = find(eligible, inputs.anchors?.default);
  const preferred = pickForPolicy(eligible, req, inputs.policy, anchorExplicit, anchorDefault);
  return resolveAvailability(base, req, eligible, eligible, excluded, preferred);
}

function resolveAvailability(
  base: { operation: RoutedOperation; policyId: string },
  req: OperationRequirements,
  candidates: readonly ModelProfile[],
  eligible: readonly ModelProfile[],
  excluded: readonly RouteExclusion[],
  preferred: Pick,
): RouteDecision {
  const isUp = (profile: ModelProfile): boolean => profile.availability.state === "available";

  if (isUp(preferred.profile)) {
    return {
      ...base,
      selected: preferred.profile,
      reasons: [`${preferred.profile.displayName}: ${preferred.why}.`],
      excluded,
    };
  }

  // The preferred model is down or rate limited: fall back to the best
  // AVAILABLE eligible model, recording exactly what happened (§14–15).
  const down = preferred.profile;
  const downNote: RouteExclusion = {
    profile: profileKey(down),
    displayName: down.displayName,
    reason:
      down.availability.state === "rate_limited"
        ? `temporarily unavailable (rate limited${down.availability.retryAt !== undefined ? ` until ${down.availability.retryAt}` : ""})`
        : (down.availability.reason ?? "unavailable"),
  };
  const ready = (candidates.length === 1 ? eligible : candidates).filter(
    (profile) => isUp(profile) && profileKey(profile) !== profileKey(down),
  );
  if (ready.length === 0) {
    return {
      ...base,
      reasons: [],
      excluded,
      fallbackFrom: downNote,
      blocked: `${down.displayName} is ${downNote.reason}, and no other configured model can do ${req.label.toLowerCase()}.`,
    };
  }
  const fallback = bestByQuality(ready);
  return {
    ...base,
    selected: fallback.profile,
    reasons: [
      `${down.displayName} is ${downNote.reason}.`,
      `Fell back to ${fallback.profile.displayName}: ${fallback.why}.`,
    ],
    excluded,
    fallbackFrom: downNote,
  };
}

/**
 * Route a whole set of operations at once — the "View model plan" preview
 * (§20) and the deterministic routing simulation (§28). No live calls; the
 * answer is exactly what {@link routeOperation} will decide at run time given
 * the same configuration.
 */
export function planRoutes(
  operations: readonly RoutedOperation[],
  shared: Omit<RouteInputs, "operation" | "pinned"> & {
    readonly pins?: Partial<Record<RoutedOperation, string>>;
  },
): RoutePlan {
  return {
    policyId: shared.policy.id,
    decisions: operations.map((operation) => {
      const pinned = shared.pins?.[operation];
      return routeOperation({
        operation,
        profiles: shared.profiles,
        policy: shared.policy,
        ...(shared.anchors !== undefined ? { anchors: shared.anchors } : {}),
        ...(pinned !== undefined ? { pinned } : {}),
        ...(shared.privacy !== undefined ? { privacy: shared.privacy } : {}),
        ...(shared.context !== undefined ? { context: shared.context } : {}),
      });
    }),
  };
}
