import { describe, expect, it } from "vitest";
import type { PermissionGrant } from "@jellytind/agent-runtime";
import { InMemoryProjectStore } from "@jellytind/persistence";
import {
  AVAILABLE,
  checkBudget,
  instrumentModel,
  monthlySpend,
  planRoutes,
  profileKey,
  routeOperation,
  routingPolicy,
  usageRecordFor,
  type GenerateRequest,
  type LanguageModel,
  type ModelProfile,
  type RequestOptions,
  type StructuredRequest,
  type TokenUsage,
  type UsageRecord,
} from "@jellytind/model-router";
import { StoryRepository } from "@jellytind/story-repository";
import { ChapterBuilder } from "./chapter-builder";

/**
 * Phase 36 §30 — the acceptance scenario, end to end and offline.
 *
 * Four configured models (two premium clouds, one cheap cloud, one local
 * Ollama), Balanced policy. A chapter build routes each kind of work to an
 * appropriate model, records why on the build, and counts actual tokens.
 * Switching to Local First moves utility work local while prose stays cloud;
 * a hard budget blocks; a privacy restriction is never routed around.
 */

const GRANT: PermissionGrant = {
  permissions: ["read_manuscript", "read_canon", "edit_manuscript", "edit_story_state"],
};

const CAPS = { streaming: true, structuredOutput: true, tools: true };

const CLAUDE: ModelProfile = {
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

const GPT: ModelProfile = {
  connectionId: "openai",
  providerId: "openai",
  modelId: "gpt-solid",
  displayName: "GPT Solid",
  capabilities: CAPS,
  qualityTier: "strong",
  pricing: { inputPer1M: 2, outputPer1M: 8, currency: "USD" },
  local: false,
  privacyClass: "cloud",
  availability: AVAILABLE,
};

const MINI: ModelProfile = {
  connectionId: "openai",
  providerId: "openai",
  modelId: "gpt-mini",
  displayName: "GPT Mini",
  capabilities: CAPS,
  qualityTier: "basic",
  pricing: { inputPer1M: 0.1, outputPer1M: 0.4, currency: "USD" },
  local: false,
  privacyClass: "cloud",
  availability: AVAILABLE,
};

const OLLAMA: ModelProfile = {
  connectionId: "ollama-home",
  providerId: "ollama",
  modelId: "llama-local",
  displayName: "Llama (home server)",
  capabilities: CAPS,
  unknownCapabilities: ["tools"],
  local: true,
  privacyClass: "local",
  availability: AVAILABLE,
};

const PROFILES = [CLAUDE, GPT, MINI, OLLAMA];
const ANCHORS = { default: profileKey(CLAUDE), drafting: profileKey(CLAUDE) };

/**
 * A scripted model that also reports token usage through `onUsage`, the way
 * every real adapter does (§10) — so the builder's accounting is exercised
 * with the same mechanics as production.
 */
class CountingModel implements LanguageModel {
  readonly capabilities = CAPS;
  readonly requests: string[] = [];

  constructor(
    readonly id: string,
    private readonly respond: (prompt: string) => unknown,
  ) {}

  generateText(request: GenerateRequest, options?: RequestOptions) {
    options?.onUsage?.({ inputTokens: 10, outputTokens: 5 });
    void request;
    return Promise.resolve({
      text: "…",
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: "stop" as const,
    });
  }
  // eslint-disable-next-line require-yield
  async *streamText(): AsyncIterable<never> {
    throw new Error("not used");
  }
  runWithTools(): never {
    throw new Error("not used");
  }
  generateStructured<T>(request: StructuredRequest<T>, options?: RequestOptions): Promise<T> {
    const prompt = request.messages.map((m) => String(m.content)).join("\n");
    this.requests.push(prompt);
    options?.onUsage?.({ inputTokens: 1_000, outputTokens: 250 });
    return Promise.resolve(request.schema.parse(this.respond(prompt)));
  }
}

const draft = (prompt: string): unknown => {
  const scene = /SCENE_\d+/.exec(prompt)?.[0] ?? "SCENE_????";
  return {
    text: `Prose for ${scene}. The corridor smelled of cold iron and old rain as Mara counted the doors.`,
    rationale: "drafted",
    warnings: [],
  };
};

const analyse = (prompt: string): unknown =>
  prompt.includes('"beats"')
    ? {
        beats: [...prompt.matchAll(/^- (.+)$/gm)].map((m) => ({
          beat: m[1] ?? "",
          met: true,
          note: "shown",
        })),
      }
    : { transitions: [] };

async function twoScenes() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "Routing" });
  const mara = await repo.addCharacter({ name: "Mara", role: "protagonist" });
  const chapter = await repo.addChapter({ title: "The Corridor", status: "outline" });
  for (const title of ["Doors", "Numbers"]) {
    await repo.addScene({
      title,
      chapterId: chapter.id,
      pov: mara.id,
      characterIds: [mara.id],
      purpose: [`${title} happens`],
      status: "planned",
    });
  }
  return { repo, chapter };
}

describe("§30 — routed chapter build under Balanced", () => {
  it("routes each kind of work to an appropriate model, records why, and counts real tokens", async () => {
    const { repo, chapter } = await twoScenes();

    // 1. The plan, decided before anything runs — no live call involved.
    const plan = planRoutes(["chapter_planning", "scene_drafting", "state_extraction"], {
      profiles: PROFILES,
      policy: routingPolicy("balanced"),
      anchors: ANCHORS,
    });
    const byOp = new Map(plan.decisions.map((decision) => [decision.operation, decision]));
    const planning = byOp.get("chapter_planning");
    const drafting = byOp.get("scene_drafting");
    const extraction = byOp.get("state_extraction");
    // Planning and drafting land on premium models; extraction on the cheap one.
    expect(planning?.selected?.qualityTier).toBe("frontier");
    expect(drafting?.selected?.modelId).toBe(CLAUDE.modelId);
    expect(extraction?.selected?.modelId).toBe(MINI.modelId);

    // 2. Wire the decided models (scripted stand-ins carrying the decided ids)
    //    with the same usage-ledger instrumentation the desktop applies.
    const ledger: UsageRecord[] = [];
    const record =
      (profile: ModelProfile, operation: string) =>
      (usage: TokenUsage): void => {
        ledger.push(usageRecordFor({ at: "2026-08-15T10:00:00Z", profile, usage, operation }));
      };
    const draftModel = instrumentModel(
      new CountingModel(drafting?.selected?.modelId ?? "", draft),
      record(CLAUDE, "scene_drafting"),
    );
    const analysisModel = instrumentModel(
      new CountingModel(extraction?.selected?.modelId ?? "", analyse),
      record(MINI, "state_extraction"),
    );

    const builder = new ChapterBuilder({
      repo,
      models: { drafting: draftModel, analysis: analysisModel },
      grant: GRANT,
    });
    const routing = plan.decisions.map((decision) => ({
      operation: decision.operation,
      modelId: decision.selected?.modelId ?? "",
      reason: decision.reasons.join(" "),
    }));
    const done = await builder.start({ chapterId: chapter.id as string, routing });

    // 3. The build finished, on the decided models, with the decisions on it (§19).
    expect(done.status).toBe("completed");
    expect(done.modelAssignments.premium_prose).toBe(CLAUDE.modelId);
    expect(done.modelAssignments.cheap_analysis).toBe(MINI.modelId);
    expect(done.routing?.map((note) => note.operation)).toContain("scene_drafting");
    expect(done.routing?.every((note) => note.reason.length > 0)).toBe(true);

    // 4. Actual tokens were counted per class, not estimated (§10).
    const prose = done.usage.byClass.premium_prose;
    const cheap = done.usage.byClass.cheap_analysis;
    expect(prose?.inputTokens).toBe((prose?.calls ?? 0) * 1_000);
    expect(prose?.outputTokens).toBe((prose?.calls ?? 0) * 250);
    expect(cheap?.calls ?? 0).toBeGreaterThan(0);
    expect(done.usage.inputTokens).toBe(done.usage.calls * 1_000);

    // 5. Every call landed in the ledger with its cost-at-the-time (§9–§11).
    expect(ledger.length).toBe(done.usage.calls);
    expect(ledger.every((entry) => entry.cost !== undefined)).toBe(true);
    const spent = monthlySpend(ledger, "2026-08-15T00:00:00Z", "USD");
    expect(spent).toBeGreaterThan(0);

    // 6. A hard budget that spend has passed blocks further work (§13).
    const verdict = checkBudget(
      { currency: "USD", projectMonthly: { amount: spent / 2, hard: true } },
      { monthly: spent },
      1,
    );
    expect(verdict.allowed).toBe(false);
  });

  it("Local First moves utility work local; cloud-only work still routes (§16, §30)", () => {
    const plan = planRoutes(["scene_drafting", "state_extraction", "summarisation"], {
      profiles: PROFILES,
      policy: routingPolicy("local_first"),
      anchors: ANCHORS,
    });
    const byOp = new Map(plan.decisions.map((decision) => [decision.operation, decision]));
    expect(byOp.get("state_extraction")?.selected?.modelId).toBe(OLLAMA.modelId);
    expect(byOp.get("summarisation")?.selected?.modelId).toBe(OLLAMA.modelId);
    // Final prose is not local-eligible: it stays on the configured cloud model.
    expect(byOp.get("scene_drafting")?.selected?.modelId).toBe(CLAUDE.modelId);
  });

  it("a privacy restriction is enforced, not routed around (§17, §30)", () => {
    const decision = routeOperation({
      operation: "scene_drafting",
      profiles: PROFILES,
      policy: routingPolicy("balanced"),
      // The writer's word says GPT drafts — but their privacy rule says no
      // manuscript prose to openai. The rule wins, visibly.
      anchors: { drafting: profileKey(GPT) },
      privacy: {
        mode: "allow_cloud",
        rules: [{ providerId: "openai", forbid: ["manuscript_prose"] }],
      },
    });
    expect(decision.selected?.providerId).not.toBe("openai");
    expect(
      decision.excluded.some(
        (entry) => entry.profile === profileKey(GPT) && entry.reason.includes("privacy"),
      ),
    ).toBe(true);
  });
});
