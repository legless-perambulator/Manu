import {
  checkBudget,
  costOfUsage,
  estimateOperationCost,
  formatCostRange,
  formatCostSummary,
  monthlySpend,
  summariseUsage,
  type BudgetVerdict,
  type CostRange,
  type ModelProfile,
  type UsageSummary,
} from "@jellytind/model-router";
import type { StoryRepository, StoredUsageRecord } from "@jellytind/story-repository";
import { loadRoutingSettings, type RoutingSettings } from "./routing";

/**
 * Cost intelligence for the desktop app (Phase 36 §11–§13, §25–§26).
 *
 * Everything here reads the project's usage ledger — actual calls, actual
 * tokens, cost computed only where pricing was known. Nothing estimates after
 * the fact, and nothing folds unknown costs into a total: the summaries carry
 * "N calls with unknown cost" beside the money, so the number shown is one
 * that is actually true.
 */

export interface SpendOverview {
  readonly today: UsageSummary;
  readonly month: UsageSummary;
  readonly lifetime: UsageSummary;
  readonly build?: UsageSummary;
}

const dayStart = (now: Date): string => now.toISOString().slice(0, 10);
const monthStart = (now: Date): string => `${now.toISOString().slice(0, 7)}-01`;

/** The dashboard's four honest numbers (§11). */
export async function spendOverview(
  repo: StoryRepository,
  options: { readonly buildId?: string; readonly now?: Date } = {},
): Promise<SpendOverview> {
  const now = options.now ?? new Date();
  const all = await repo.usage.list();
  const overview: SpendOverview = {
    today: summariseUsage(all.filter((record) => record.at >= dayStart(now))),
    month: summariseUsage(all.filter((record) => record.at >= monthStart(now))),
    lifetime: summariseUsage(all),
    ...(options.buildId !== undefined
      ? {
          build: summariseUsage(all.filter((record) => record.buildId === options.buildId)),
        }
      : {}),
  };
  return overview;
}

export { formatCostSummary, formatCostRange };

/** Per-routing-class breakdown for a build's records (§25). */
export function usageByClass(records: readonly StoredUsageRecord[]): Record<string, UsageSummary> {
  const grouped = new Map<string, StoredUsageRecord[]>();
  for (const record of records) {
    const key = record.routingClass ?? record.operation ?? "other";
    const held = grouped.get(key);
    if (held !== undefined) held.push(record);
    else grouped.set(key, [record]);
  }
  return Object.fromEntries(
    [...grouped.entries()].map(([key, list]) => [key, summariseUsage(list)]),
  );
}

/**
 * One routing class's accumulated usage as a sentence (§25–§26): calls and
 * tokens always; money only when the assigned model's pricing is known.
 */
export function describeClassUsage(
  entry: { readonly calls: number; readonly inputTokens: number; readonly outputTokens: number },
  modelId: string | undefined,
  profiles: readonly ModelProfile[],
): string {
  const base = `${String(entry.calls)} calls · ${entry.inputTokens.toLocaleString()} / ${entry.outputTokens.toLocaleString()} tokens`;
  if (entry.inputTokens === 0 && entry.outputTokens === 0) return `${String(entry.calls)} calls`;
  const profile = modelId === undefined ? undefined : profiles.find((p) => p.modelId === modelId);
  if (profile === undefined) return base;
  const cost = costOfUsage(
    profile.pricing,
    { inputTokens: entry.inputTokens, outputTokens: entry.outputTokens },
    profile.local,
  );
  if (cost === null) return `${base} · cost unavailable`;
  if (cost.amount === 0 && profile.local) return `${base} · API cost 0 (local)`;
  return `${base} · ${cost.currency} ${cost.amount.toFixed(2)}`;
}

/**
 * A pre-build estimate (§12): tokens are rough by construction, so the range
 * is honest and the phrasing admits it. `null` when no pricing is known.
 */
export function estimateChapterBuildCost(input: {
  readonly drafting: ModelProfile;
  readonly analysis?: ModelProfile;
  readonly sceneCount: number;
}): CostRange | null {
  const scenes = Math.max(1, input.sceneCount);
  // Working figures per scene: a compiled context around 8k tokens in, prose
  // between 600 and 2000 tokens out; extraction/coverage smaller and cheaper.
  const drafting = estimateOperationCost({
    profile: input.drafting,
    inputTokens: scenes * 8_000,
    outputTokensLow: scenes * 600,
    outputTokensHigh: scenes * 2_000,
  });
  if (drafting === null) return null;
  if (input.analysis === undefined) return drafting;
  const analysis = estimateOperationCost({
    profile: input.analysis,
    inputTokens: scenes * 2 * 3_000,
    outputTokensLow: scenes * 2 * 200,
    outputTokensHigh: scenes * 2 * 600,
  });
  if (analysis === null || analysis.low.currency !== drafting.low.currency) return drafting;
  return {
    low: { amount: drafting.low.amount + analysis.low.amount, currency: drafting.low.currency },
    high: { amount: drafting.high.amount + analysis.high.amount, currency: drafting.high.currency },
  };
}

/**
 * May work with this estimated ceiling start? Checks the configured budgets
 * against actual ledger spend (§13). A hard limit blocks; a soft limit warns;
 * no configured budget allows silently.
 */
export async function budgetVerdict(
  repo: StoryRepository,
  estimateHigh: number | null,
  options: { readonly buildId?: string; readonly settings?: RoutingSettings } = {},
): Promise<BudgetVerdict> {
  const settings = options.settings ?? loadRoutingSettings();
  const limits = settings.budgets;
  if (limits === undefined) return { allowed: true };
  const all = await repo.usage.list();
  const nowIso = new Date().toISOString();
  const spend = {
    monthly: monthlySpend(all, nowIso, limits.currency),
    ...(options.buildId !== undefined
      ? {
          build: monthlySpend(
            all.filter((record) => record.buildId === options.buildId),
            nowIso,
            limits.currency,
          ),
        }
      : {}),
  };
  return checkBudget(limits, spend, estimateHigh);
}
