import { describe, expect, it } from "vitest";
import { checkBudget, needsApproval } from "./budget";
import { planRoutes, routeOperation, type RouteInputs } from "./engine";
import { instrumentModel } from "./instrument";
import { MockLanguageModel } from "./mock-model";
import { routingPolicy } from "./policy";
import { privacyRefusal, type PrivacyPolicy } from "./privacy";
import { AVAILABLE, profileKey, type ModelProfile } from "./profile";
import {
  costOfUsage,
  estimateOperationCost,
  formatApiCost,
  formatCostRange,
  formatCostSummary,
  monthlySpend,
  summariseUsage,
  usageRecordFor,
  type UsageRecord,
} from "./usage";
import type { TokenUsage } from "./types";

/**
 * The routing test matrix (Phase 36 §29), on fixture profiles — no live API
 * call anywhere, which is the §28 point: the same pure function the product
 * routes with is the one under test.
 */

const CAPS = { streaming: true, structuredOutput: true, tools: true };

/** §30's configuration: two premium clouds, one cheap cloud, one local. */
const FRONTIER: ModelProfile = {
  connectionId: "anthropic",
  providerId: "anthropic",
  modelId: "claude-large",
  displayName: "Claude Large",
  capabilities: CAPS,
  contextWindow: 200_000,
  qualityTier: "frontier",
  pricing: { inputPer1M: 3, outputPer1M: 15, currency: "USD" },
  local: false,
  privacyClass: "cloud",
  availability: AVAILABLE,
};

const STRONG: ModelProfile = {
  connectionId: "openai",
  providerId: "openai",
  modelId: "gpt-solid",
  displayName: "GPT Solid",
  capabilities: CAPS,
  contextWindow: 128_000,
  qualityTier: "strong",
  pricing: { inputPer1M: 2, outputPer1M: 8, currency: "USD" },
  local: false,
  privacyClass: "cloud",
  availability: AVAILABLE,
};

const CHEAP: ModelProfile = {
  connectionId: "openai",
  providerId: "openai",
  modelId: "gpt-mini",
  displayName: "GPT Mini",
  capabilities: CAPS,
  contextWindow: 128_000,
  qualityTier: "basic",
  speedTier: "fast",
  pricing: { inputPer1M: 0.1, outputPer1M: 0.4, currency: "USD" },
  local: false,
  privacyClass: "cloud",
  availability: AVAILABLE,
};

/** Discovered local model: honest unknowns everywhere (§2). */
const LOCAL: ModelProfile = {
  connectionId: "ollama-home",
  providerId: "ollama",
  modelId: "llama-local",
  displayName: "Llama (home server)",
  capabilities: CAPS,
  unknownCapabilities: ["tools", "structuredOutput"],
  local: true,
  privacyClass: "local",
  availability: AVAILABLE,
};

/** A model known NOT to do structured output. */
const NO_STRUCT: ModelProfile = {
  connectionId: "legacy",
  providerId: "openai-compatible",
  modelId: "old-completions",
  displayName: "Old Completions",
  capabilities: { streaming: true, structuredOutput: false, tools: false },
  local: false,
  privacyClass: "cloud",
  availability: AVAILABLE,
};

const ALL = [FRONTIER, STRONG, CHEAP, LOCAL, NO_STRUCT];

const route = (over: Partial<RouteInputs> & Pick<RouteInputs, "operation">) =>
  routeOperation({
    profiles: ALL,
    policy: routingPolicy("balanced"),
    ...over,
  });

describe("capability filtering (§6)", () => {
  it("excludes a model known not to do what the operation requires, with the reason", () => {
    const decision = route({ operation: "state_extraction", policy: routingPolicy("economy") });
    const excluded = decision.excluded.find((entry) => entry.profile === profileKey(NO_STRUCT));
    expect(excluded?.reason).toContain("structured output");
    expect(decision.selected?.modelId).not.toBe(NO_STRUCT.modelId);
  });

  it("lets unknown capabilities through rather than guessing them false (§2)", () => {
    const decision = route({
      operation: "state_extraction",
      policy: routingPolicy("local_first"),
    });
    // LOCAL's structuredOutput is unknown, not "no" — it stays eligible and
    // local-first picks it for local-eligible work.
    expect(decision.selected?.modelId).toBe(LOCAL.modelId);
  });

  it("blocks with every reason stated when nothing eligible remains", () => {
    const decision = routeOperation({
      operation: "scene_drafting",
      profiles: [NO_STRUCT],
      policy: routingPolicy("balanced"),
    });
    expect(decision.selected).toBeUndefined();
    expect(decision.blocked).toContain("Old Completions");
    expect(decision.blocked).toContain("structured output");
  });
});

describe("policies (§4)", () => {
  it("best quality picks the strongest configured model", () => {
    const decision = route({ operation: "scene_drafting", policy: routingPolicy("best_quality") });
    expect(decision.selected?.modelId).toBe(FRONTIER.modelId);
  });

  it("balanced keeps premium models where quality matters and goes cheap for bulk analysis", () => {
    expect(route({ operation: "scene_drafting" }).selected?.modelId).toBe(FRONTIER.modelId);
    expect(route({ operation: "state_extraction" }).selected?.modelId).toBe(CHEAP.modelId);
  });

  it("economy picks the cheapest capable model wherever the work allows", () => {
    const decision = route({ operation: "summarisation", policy: routingPolicy("economy") });
    expect(decision.selected?.modelId).toBe(CHEAP.modelId);
    expect(decision.reasons.join(" ")).toContain("cheapest");
  });

  it("local first routes local-eligible work to the local model and prose to the cloud (§16)", () => {
    const policy = routingPolicy("local_first");
    expect(route({ operation: "summarisation", policy }).selected?.modelId).toBe(LOCAL.modelId);
    expect(route({ operation: "search_query", policy }).selected?.modelId).toBe(LOCAL.modelId);
    // Final prose is deliberately not local-eligible.
    expect(route({ operation: "scene_drafting", policy }).selected?.modelId).toBe(FRONTIER.modelId);
  });
});

describe("manual assignments are anchors (§5)", () => {
  it("an explicit purpose assignment wins under balanced, and the reason says so", () => {
    const decision = route({
      operation: "scene_drafting",
      anchors: { drafting: profileKey(STRONG) },
    });
    expect(decision.selected?.modelId).toBe(STRONG.modelId);
    expect(decision.reasons.join(" ")).toContain("drafting");
  });

  it("local first may move utility work off a cloud anchor — that is what it is for (§30)", () => {
    const decision = route({
      operation: "state_extraction",
      policy: routingPolicy("local_first"),
      anchors: { utility: profileKey(CHEAP) },
    });
    expect(decision.selected?.modelId).toBe(LOCAL.modelId);
  });

  it("custom uses exactly the configured assignment", () => {
    const decision = route({
      operation: "diagnosis",
      policy: routingPolicy("custom"),
      anchors: { reasoning: profileKey(STRONG), default: profileKey(CHEAP) },
    });
    expect(decision.selected?.modelId).toBe(STRONG.modelId);
  });
});

describe("pinning (§22)", () => {
  it("a compatible pin always wins", () => {
    const decision = route({ operation: "summarisation", pinned: profileKey(FRONTIER) });
    expect(decision.selected?.modelId).toBe(FRONTIER.modelId);
    expect(decision.reasons.join(" ")).toContain("inned");
  });

  it("an incompatible pin blocks with the incompatibility surfaced — never silently ignored", () => {
    const decision = route({ operation: "state_extraction", pinned: profileKey(NO_STRUCT) });
    expect(decision.selected).toBeUndefined();
    expect(decision.blocked).toContain("pinned");
    expect(decision.blocked).toContain("structured output");
  });

  it("a pinned model that is merely rate limited falls back, and the record says so (§14–15)", () => {
    const limited: ModelProfile = {
      ...FRONTIER,
      availability: { state: "rate_limited", retryAt: "2026-08-15T12:00:00Z" },
    };
    const decision = routeOperation({
      operation: "scene_drafting",
      profiles: [limited, STRONG, CHEAP],
      policy: routingPolicy("balanced"),
      pinned: profileKey(limited),
    });
    expect(decision.selected?.modelId).toBe(STRONG.modelId);
    expect(decision.fallbackFrom?.profile).toBe(profileKey(limited));
    expect(decision.fallbackFrom?.reason).toContain("rate limited");
  });
});

describe("context size awareness (§7–8)", () => {
  it("excludes a model whose known context window cannot hold the work", () => {
    const decision = route({
      operation: "scene_drafting",
      context: { contextTokens: 150_000, outputTokens: 4_000 },
    });
    // STRONG and CHEAP (128k) are out; FRONTIER (200k) holds it.
    expect(decision.selected?.modelId).toBe(FRONTIER.modelId);
    expect(
      decision.excluded.some(
        (entry) => entry.profile === profileKey(STRONG) && entry.reason.includes("context window"),
      ),
    ).toBe(true);
  });

  it("surfaces impossibility rather than silently truncating", () => {
    const decision = routeOperation({
      operation: "scene_drafting",
      profiles: [STRONG],
      policy: routingPolicy("balanced"),
      context: { contextTokens: 300_000 },
    });
    expect(decision.blocked).toContain("context window");
  });

  it("a model with an unknown window is not excluded on a guess", () => {
    const decision = routeOperation({
      operation: "summarisation",
      profiles: [LOCAL],
      policy: routingPolicy("balanced"),
      context: { contextTokens: 500_000 },
    });
    expect(decision.selected?.modelId).toBe(LOCAL.modelId);
  });
});

describe("privacy (§17)", () => {
  const noProseToOpenai: PrivacyPolicy = {
    mode: "allow_cloud",
    rules: [{ providerId: "openai", forbid: ["manuscript_prose"] }],
  };

  it("never sends restricted material to a restricted provider, whatever the scores", () => {
    const decision = route({
      operation: "scene_drafting",
      privacy: noProseToOpenai,
      anchors: { drafting: profileKey(STRONG) },
    });
    expect(decision.selected?.providerId).not.toBe("openai");
    expect(
      decision.excluded.some(
        (entry) =>
          entry.profile === profileKey(STRONG) && entry.reason.includes("privacy settings"),
      ),
    ).toBe(true);
  });

  it("the same provider stays available for material the rule does not cover", () => {
    const decision = route({
      operation: "search_query",
      policy: routingPolicy("economy"),
      privacy: noProseToOpenai,
    });
    expect(decision.selected?.modelId).toBe(CHEAP.modelId);
  });

  it("local-only leaves only local models, and local models are exempt from provider rules", () => {
    const policy: PrivacyPolicy = { mode: "local_only", rules: [] };
    const decision = route({ operation: "summarisation", privacy: policy });
    expect(decision.selected?.modelId).toBe(LOCAL.modelId);
    expect(privacyRefusal(policy, LOCAL, "manuscript_prose")).toBeNull();
    expect(privacyRefusal(policy, FRONTIER, "manuscript_prose")).toContain("local-only");
  });
});

describe("availability and fallback (§14–15)", () => {
  it("falls back to a compatible model and records what it fell back from", () => {
    const down: ModelProfile = { ...FRONTIER, availability: { state: "unavailable" } };
    const decision = routeOperation({
      operation: "scene_drafting",
      profiles: [down, STRONG, CHEAP],
      policy: routingPolicy("best_quality"),
    });
    expect(decision.selected?.modelId).toBe(STRONG.modelId);
    expect(decision.fallbackFrom?.profile).toBe(profileKey(down));
    expect(decision.reasons.join(" ")).toContain("Fell back");
  });

  it("blocks honestly when nothing eligible is up", () => {
    const down: ModelProfile = { ...FRONTIER, availability: { state: "rate_limited" } };
    const decision = routeOperation({
      operation: "scene_drafting",
      profiles: [down],
      policy: routingPolicy("balanced"),
    });
    expect(decision.blocked).toContain("rate limited");
  });
});

describe("determinism and the plan (§1, §20, §28)", () => {
  it("the same inputs always produce the same decision", () => {
    const inputs: RouteInputs = {
      operation: "scene_drafting",
      profiles: ALL,
      policy: routingPolicy("balanced"),
      anchors: { drafting: profileKey(FRONTIER) },
    };
    expect(routeOperation(inputs)).toEqual(routeOperation(inputs));
  });

  it("planRoutes answers a whole workflow at once, honouring per-operation pins", () => {
    const plan = planRoutes(["scene_drafting", "state_extraction", "summarisation"], {
      profiles: ALL,
      policy: routingPolicy("balanced"),
      pins: { summarisation: profileKey(FRONTIER) },
    });
    expect(plan.decisions).toHaveLength(3);
    const byOp = new Map(plan.decisions.map((decision) => [decision.operation, decision]));
    expect(byOp.get("scene_drafting")?.selected?.modelId).toBe(FRONTIER.modelId);
    expect(byOp.get("state_extraction")?.selected?.modelId).toBe(CHEAP.modelId);
    expect(byOp.get("summarisation")?.selected?.modelId).toBe(FRONTIER.modelId);
  });

  it("every decision carries writer-readable reasons and exclusions (§19)", () => {
    const decision = route({ operation: "scene_drafting" });
    expect(decision.reasons.length).toBeGreaterThan(0);
    expect(decision.excluded.every((entry) => entry.reason.length > 0)).toBe(true);
  });
});

describe("budgets (§13)", () => {
  const limits = {
    currency: "USD",
    projectMonthly: { amount: 50, hard: true },
    perOperationApproval: 5,
  };

  it("a hard limit blocks work that would pass it — never silently exceeded", () => {
    const verdict = checkBudget(limits, { monthly: 48 }, 6);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toContain("monthly budget");
  });

  it("a soft limit warns and continues", () => {
    const verdict = checkBudget(
      { currency: "USD", projectMonthly: { amount: 50, hard: false } },
      { monthly: 49 },
      6,
    );
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) expect(verdict.warning).toBeDefined();
  });

  it("an unknown estimate against a hard limit warns honestly instead of pretending zero", () => {
    const verdict = checkBudget(limits, { monthly: 10 }, null);
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) expect(verdict.warning).toContain("unknown");
  });

  it("the per-operation approval threshold trips on the estimate's high end", () => {
    expect(needsApproval(limits, 7)).toBe(true);
    expect(needsApproval(limits, 3)).toBe(false);
    expect(needsApproval(limits, null)).toBe(false);
  });
});

describe("cost accounting (§9–§12, §26)", () => {
  const usage: TokenUsage = { inputTokens: 1_000_000, outputTokens: 100_000 };

  it("computes cost only where pricing is known; unknown stays unknown", () => {
    expect(costOfUsage(FRONTIER.pricing, usage, false)).toEqual({
      amount: 3 + 1.5,
      currency: "USD",
    });
    expect(costOfUsage(undefined, usage, false)).toBeNull();
  });

  it("a local model's API cost genuinely is zero", () => {
    expect(costOfUsage(undefined, usage, true)?.amount).toBe(0);
    expect(formatApiCost({ local: true })).toContain("0");
  });

  it("says 'cost unavailable' rather than inventing a number", () => {
    expect(formatApiCost({ local: false })).toContain("Cost unavailable");
  });

  it("summaries keep unknown-cost calls beside the money, never folded in", () => {
    const records: UsageRecord[] = [
      usageRecordFor({ at: "2026-08-15T10:00:00Z", profile: FRONTIER, usage }),
      usageRecordFor({
        at: "2026-08-15T11:00:00Z",
        profile: { ...LOCAL, local: false, privacyClass: "cloud" },
        usage,
      }),
      usageRecordFor({ at: "2026-08-15T12:00:00Z", profile: LOCAL, usage }),
    ];
    const summary = summariseUsage(records);
    expect(summary.calls).toBe(3);
    expect(summary.unknownCostCalls).toBe(1);
    expect(summary.localCalls).toBe(1);
    expect(summary.costByCurrency.USD).toBeCloseTo(4.5);
    expect(formatCostSummary(summary)).toContain("unknown cost");
  });

  it("monthly spend counts the calendar month in the budget's currency", () => {
    const records: UsageRecord[] = [
      usageRecordFor({ at: "2026-08-01T00:00:00Z", profile: FRONTIER, usage }),
      usageRecordFor({ at: "2026-07-31T23:59:00Z", profile: FRONTIER, usage }),
    ];
    expect(monthlySpend(records, "2026-08-15T00:00:00Z", "USD")).toBeCloseTo(4.5);
  });

  it("estimates are ranges that admit being estimates, and never fabricated (§12)", () => {
    const range = estimateOperationCost({
      profile: FRONTIER,
      inputTokens: 100_000,
      outputTokensLow: 5_000,
      outputTokensHigh: 20_000,
    });
    expect(range).not.toBeNull();
    expect(formatCostRange(range)).toContain("estimate, not a promise");
    expect(
      estimateOperationCost({
        profile: { ...LOCAL, local: false, privacyClass: "cloud" },
        inputTokens: 1,
        outputTokensLow: 1,
        outputTokensHigh: 1,
      }),
    ).toBeNull();
  });
});

describe("token reporting (§10)", () => {
  it("generateStructured reports usage through onUsage even though it returns only the value", async () => {
    const mock = new MockLanguageModel({ structured: { ok: true } });
    let reported: TokenUsage | undefined;
    await mock.generateStructured(
      {
        messages: [{ role: "user", content: "count me" }],
        schema: { name: "Ok", parse: (v) => v as { ok: boolean } },
      },
      {
        onUsage: (usage) => {
          reported = usage;
        },
      },
    );
    expect(reported).toBeDefined();
    expect(reported?.inputTokens).toBeGreaterThan(0);
  });

  it("instrumentModel observes usage without displacing the caller's own onUsage", async () => {
    const mock = new MockLanguageModel({ structured: { ok: true } });
    const sink: TokenUsage[] = [];
    const caller: TokenUsage[] = [];
    const wrapped = instrumentModel(mock, (usage) => sink.push(usage));
    await wrapped.generateStructured(
      {
        messages: [{ role: "user", content: "count me" }],
        schema: { name: "Ok", parse: (v) => v as { ok: boolean } },
      },
      { onUsage: (usage) => caller.push(usage) },
    );
    expect(sink).toHaveLength(1);
    expect(caller).toHaveLength(1);
  });
});
