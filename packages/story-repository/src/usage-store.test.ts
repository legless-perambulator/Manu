import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "./story-repository";
import type { StoredUsageRecord } from "./usage-store";

/** The usage ledger (Phase 36 §10–§11, §18): durable, filterable, honest. */

const record = (over: Partial<StoredUsageRecord>): StoredUsageRecord => ({
  at: "2026-08-15T10:00:00Z",
  providerId: "anthropic",
  modelId: "claude-large",
  local: false,
  inputTokens: 1_000,
  outputTokens: 200,
  ...over,
});

async function repo() {
  return StoryRepository.createProject({ store: new InMemoryProjectStore(), title: "Ledger" });
}

describe("the usage ledger", () => {
  it("appends and lists records exactly as they happened", async () => {
    const held = await repo();
    await held.usage.append(record({ operation: "scene_drafting", buildId: "CB_0001" }));
    await held.usage.append(
      record({
        at: "2026-08-15T11:00:00Z",
        operation: "state_extraction",
        cost: { amount: 0.01, currency: "USD" },
      }),
    );
    const all = await held.usage.list();
    expect(all).toHaveLength(2);
    expect(all[0]?.operation).toBe("scene_drafting");
    // Cost is present only where it was known at the time — never back-filled.
    expect(all[0]?.cost).toBeUndefined();
    expect(all[1]?.cost?.amount).toBe(0.01);
  });

  it("filters by time and by build", async () => {
    const held = await repo();
    await held.usage.append(record({ at: "2026-08-14T10:00:00Z" }));
    await held.usage.append(record({ at: "2026-08-15T10:00:00Z", buildId: "CB_0002" }));
    expect(await held.usage.list({ since: "2026-08-15" })).toHaveLength(1);
    expect(await held.usage.list({ buildId: "CB_0002" })).toHaveLength(1);
    expect(await held.usage.list({ buildId: "CB_0009" })).toHaveLength(0);
  });

  it("keeps the writer's verdicts as records beside the model that did the work (§18)", async () => {
    const held = await repo();
    await held.usage.appendFeedback({
      at: "2026-08-15T12:00:00Z",
      verdict: "good",
      modelId: "claude-large",
      buildId: "CB_0001",
    });
    const feedback = await held.usage.listFeedback();
    expect(feedback).toHaveLength(1);
    expect(feedback[0]?.verdict).toBe("good");
  });
});
