import type { ModelPricing, ModelProfile } from "./profile";
import type { TokenUsage } from "./types";

/**
 * Usage and cost accounting (Phase 36 §9–§12, §26).
 *
 * Two rules hold everywhere:
 *
 * - **Actual usage is counted, never invented.** A record holds the tokens the
 *   provider reported. When only an estimate exists, `estimated: true` says so.
 * - **Unknown cost is "unknown", not zero.** Money appears only where pricing
 *   is configured; everything else is counted separately and shown as calls
 *   with unknown cost. A local model's API cost genuinely is zero, and is
 *   allowed to say so.
 */

export interface CostAmount {
  readonly amount: number;
  /** ISO 4217, e.g. "USD". */
  readonly currency: string;
}

/** One model call, as it actually happened. */
export interface UsageRecord {
  readonly at: string;
  /** The routed operation, when the call went through the router. */
  readonly operation?: string;
  readonly routingClass?: string;
  /** The build (chapter/act/book) this call belonged to, when one did. */
  readonly buildId?: string;
  readonly connectionId?: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly local: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  /** Money, computed from pricing known AT THE TIME. Absent = unknown. */
  readonly cost?: CostAmount;
  /** True when the token counts are estimated rather than provider-reported. */
  readonly estimated?: boolean;
}

/** The cost of a call, or `null` when pricing is not known. Local is free. */
export function costOfUsage(
  pricing: ModelPricing | undefined,
  usage: TokenUsage,
  local: boolean,
): CostAmount | null {
  if (local) return { amount: 0, currency: pricing?.currency ?? "USD" };
  if (pricing?.inputPer1M === undefined || pricing.outputPer1M === undefined) return null;
  const amount =
    (usage.inputTokens / 1_000_000) * pricing.inputPer1M +
    (usage.outputTokens / 1_000_000) * pricing.outputPer1M;
  return { amount, currency: pricing.currency ?? "USD" };
}

/** Build a usage record for a call a profile's model just made. */
export function usageRecordFor(input: {
  readonly at: string;
  readonly profile: ModelProfile;
  readonly usage: TokenUsage;
  readonly operation?: string;
  readonly routingClass?: string;
  readonly buildId?: string;
  readonly estimated?: boolean;
}): UsageRecord {
  const cost = costOfUsage(input.profile.pricing, input.usage, input.profile.local);
  return {
    at: input.at,
    ...(input.operation !== undefined ? { operation: input.operation } : {}),
    ...(input.routingClass !== undefined ? { routingClass: input.routingClass } : {}),
    ...(input.buildId !== undefined ? { buildId: input.buildId } : {}),
    connectionId: input.profile.connectionId,
    providerId: input.profile.providerId,
    modelId: input.profile.modelId,
    local: input.profile.local,
    inputTokens: input.usage.inputTokens,
    outputTokens: input.usage.outputTokens,
    ...(input.usage.cachedInputTokens !== undefined
      ? { cachedInputTokens: input.usage.cachedInputTokens }
      : {}),
    ...(cost !== null ? { cost } : {}),
    ...(input.estimated === true ? { estimated: true } : {}),
  };
}

export interface UsageSummary {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  /** Known money, per currency. Empty when nothing had known pricing. */
  readonly costByCurrency: Readonly<Record<string, number>>;
  /** Non-local calls whose cost is unknown. Never folded into a total. */
  readonly unknownCostCalls: number;
  readonly localCalls: number;
}

export function summariseUsage(records: readonly UsageRecord[]): UsageSummary {
  const costByCurrency: Record<string, number> = {};
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let unknownCostCalls = 0;
  let localCalls = 0;
  for (const record of records) {
    calls += 1;
    inputTokens += record.inputTokens;
    outputTokens += record.outputTokens;
    cachedInputTokens += record.cachedInputTokens ?? 0;
    if (record.local) localCalls += 1;
    if (record.cost !== undefined) {
      costByCurrency[record.cost.currency] =
        (costByCurrency[record.cost.currency] ?? 0) + record.cost.amount;
    } else if (!record.local) {
      unknownCostCalls += 1;
    }
  }
  return {
    calls,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    costByCurrency,
    unknownCostCalls,
    localCalls,
  };
}

/** Records on or after `sinceIso` (inclusive). */
export const usageSince = (records: readonly UsageRecord[], sinceIso: string): UsageRecord[] =>
  records.filter((record) => record.at >= sinceIso);

/** Known spend in one currency for the calendar month containing `nowIso` (§13). */
export function monthlySpend(
  records: readonly UsageRecord[],
  nowIso: string,
  currency: string,
): number {
  const month = nowIso.slice(0, 7);
  let total = 0;
  for (const record of records) {
    if (record.at.slice(0, 7) !== month) continue;
    if (record.cost?.currency === currency) total += record.cost.amount;
  }
  return total;
}

const formatAmount = (cost: CostAmount): string =>
  `${cost.currency} ${cost.amount >= 1 ? cost.amount.toFixed(2) : cost.amount.toFixed(4)}`;

/**
 * One call's cost, said honestly (§26): money when known, "API cost: 0" for a
 * local model, and "Cost unavailable" — never a made-up number — otherwise.
 */
export function formatApiCost(record: Pick<UsageRecord, "cost" | "local">): string {
  if (record.local) return "API cost: 0 (local model)";
  if (record.cost !== undefined) return formatAmount(record.cost);
  return "Cost unavailable (no pricing configured for this model)";
}

/** A summary's money line: totals per currency plus what is honestly unknown. */
export function formatCostSummary(summary: UsageSummary): string {
  const parts = Object.entries(summary.costByCurrency)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => formatAmount({ amount, currency }));
  if (summary.unknownCostCalls > 0) {
    parts.push(
      `${String(summary.unknownCostCalls)} call${summary.unknownCostCalls === 1 ? "" : "s"} with unknown cost`,
    );
  }
  if (parts.length === 0) {
    return summary.calls > 0 ? "API cost: 0 (local models)" : "No usage yet";
  }
  return parts.join(" + ");
}

export interface CostRange {
  readonly low: CostAmount;
  readonly high: CostAmount;
}

/**
 * A pre-operation estimate (§12). `null` when the model's pricing is unknown —
 * an estimate is never fabricated. A local model's honest range is zero.
 */
export function estimateOperationCost(input: {
  readonly profile: ModelProfile;
  readonly inputTokens: number;
  readonly outputTokensLow: number;
  readonly outputTokensHigh: number;
}): CostRange | null {
  const { profile } = input;
  const low = costOfUsage(
    profile.pricing,
    { inputTokens: input.inputTokens, outputTokens: input.outputTokensLow },
    profile.local,
  );
  const high = costOfUsage(
    profile.pricing,
    { inputTokens: input.inputTokens, outputTokens: input.outputTokensHigh },
    profile.local,
  );
  if (low === null || high === null) return null;
  return { low, high };
}

/** The §12 phrasing: a range and the admission that it is one. */
export function formatCostRange(range: CostRange | null): string {
  if (range === null) return "Cost unavailable (no pricing configured)";
  if (range.high.amount === 0) return "API cost: 0 (local model)";
  return `Likely range: ${formatAmount(range.low)} – ${formatAmount(range.high)}. Costs depend on actual model behaviour — this is an estimate, not a promise.`;
}
