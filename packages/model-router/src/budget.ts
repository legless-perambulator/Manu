/**
 * Budget limits (Phase 36 §13).
 *
 * Money limits are the writer's, and a hard limit is a wall: Manu never
 * silently exceeds one. Where costs are unknown the check says so honestly
 * instead of pretending zero — an unknown-cost call under a hard limit is a
 * warning, not an invisible pass.
 */

export interface BudgetLimit {
  /** In {@link BudgetLimits.currency}. */
  readonly amount: number;
  /** Hard: block when reached. Soft: warn and continue. */
  readonly hard: boolean;
}

export interface BudgetLimits {
  /** ISO 4217 currency the limits are expressed in. */
  readonly currency: string;
  readonly projectMonthly?: BudgetLimit;
  readonly perBuild?: BudgetLimit;
  /** Ask before starting any single operation estimated above this. */
  readonly perOperationApproval?: number;
}

/** What has actually been spent, in the same currency. */
export interface BudgetSpend {
  readonly monthly: number;
  readonly build?: number;
}

export type BudgetVerdict =
  | { readonly allowed: true; readonly warning?: string }
  | { readonly allowed: false; readonly reason: string };

const money = (amount: number, currency: string): string => `${currency} ${amount.toFixed(2)}`;

/**
 * May work costing `estimate` proceed? `estimate` is the high end of the
 * honest range, or `null` when no pricing is known.
 */
export function checkBudget(
  limits: BudgetLimits,
  spend: BudgetSpend,
  estimate: number | null,
): BudgetVerdict {
  const checks: { readonly limit: BudgetLimit; readonly spent: number; readonly name: string }[] =
    [];
  if (limits.projectMonthly !== undefined) {
    checks.push({ limit: limits.projectMonthly, spent: spend.monthly, name: "monthly budget" });
  }
  if (limits.perBuild !== undefined && spend.build !== undefined) {
    checks.push({ limit: limits.perBuild, spent: spend.build, name: "build budget" });
  }

  for (const { limit, spent, name } of checks) {
    const projected = spent + (estimate ?? 0);
    if (spent >= limit.amount || projected > limit.amount) {
      const detail =
        spent >= limit.amount
          ? `${money(spent, limits.currency)} of the ${money(limit.amount, limits.currency)} ${name} is already spent.`
          : `This would take the ${name} past ${money(limit.amount, limits.currency)} (${money(spent, limits.currency)} spent, about ${money(estimate ?? 0, limits.currency)} more).`;
      if (limit.hard) return { allowed: false, reason: detail };
      return { allowed: true, warning: detail };
    }
    if (estimate === null && limit.hard) {
      return {
        allowed: true,
        warning: `The cost of this work is unknown (no pricing configured), so the hard ${name} of ${money(limit.amount, limits.currency)} cannot be checked against it.`,
      };
    }
  }
  return { allowed: true };
}

/** Whether a single operation's estimate needs an explicit go-ahead first. */
export function needsApproval(limits: BudgetLimits, estimateHigh: number | null): boolean {
  if (limits.perOperationApproval === undefined || estimateHigh === null) return false;
  return estimateHigh > limits.perOperationApproval;
}
