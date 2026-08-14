import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "./provider";
import type { ConnectionTestResult, ModelProvider, ProviderDescriptor } from "./provider";
import { capabilityRefusal, capabilityState, describeModel } from "./registry";
import { MockLanguageModel } from "./mock-model";

/** A provider that exists only to be registered. */
function fakeProvider(id: string, overrides: Partial<ProviderDescriptor> = {}): ModelProvider {
  return {
    name: id,
    describe: (): ProviderDescriptor => ({
      id,
      displayName: id,
      summary: "",
      auth: "api_key",
      local: false,
      configurableBaseUrl: false,
      supportsDiscovery: false,
      connectionKind: "api",
      ...overrides,
    }),
    models: () => [],
    createModel: () => new MockLanguageModel(),
    testConnection: (): Promise<ConnectionTestResult> =>
      Promise.resolve({ ok: true, message: "fine" }),
  };
}

describe("ProviderRegistry", () => {
  it("holds every registered adapter and can describe them all", () => {
    const registry = new ProviderRegistry().register(
      fakeProvider("anthropic"),
      fakeProvider("ollama", { local: true, auth: "none" }),
    );

    expect(registry.has("anthropic")).toBe(true);
    expect(registry.has("nothing")).toBe(false);
    expect(registry.list()).toHaveLength(2);
    expect(registry.describeAll().map((d) => d.id)).toEqual(["anthropic", "ollama"]);
    // The settings interface reads this, so it must carry the local flag through.
    expect(registry.describeAll()[1]?.local).toBe(true);
  });

  it("is empty until something is registered — nothing is hard-coded", () => {
    // The audit found a hard-coded one-element provider array (MANU-005). An
    // empty registry proves the list is data rather than a literal.
    expect(new ProviderRegistry().list()).toEqual([]);
    expect(new ProviderRegistry().get("anthropic")).toBeUndefined();
  });

  it("replaces an adapter registered twice under the same id", () => {
    const registry = new ProviderRegistry()
      .register(fakeProvider("x", { displayName: "first" }))
      .register(fakeProvider("x", { displayName: "second" }));
    expect(registry.list()).toHaveLength(1);
    expect(registry.get("x")?.describe().displayName).toBe("second");
  });
});

describe("capability honesty", () => {
  const known = describeModel({
    provider: "p",
    modelId: "known",
    displayName: "Known",
    capabilities: { streaming: true, structuredOutput: true, tools: false },
  });

  const unknown = describeModel({
    provider: "p",
    modelId: "local",
    displayName: "A local model",
    capabilities: { streaming: true, structuredOutput: true, tools: true },
    unknownCapabilities: ["tools", "structuredOutput"],
  });

  it("distinguishes yes, no and nobody-has-said", () => {
    expect(capabilityState(known, "streaming")).toBe("yes");
    expect(capabilityState(known, "tools")).toBe("no");
    expect(capabilityState(unknown, "tools")).toBe("unknown");
  });

  it("refuses a model known not to do the work, and says where to fix it", () => {
    const refusal = capabilityRefusal(known, ["tools"]);
    expect(refusal).toContain("Known");
    expect(refusal).toContain("tool calling");
    expect(refusal).toContain("AI Providers");
  });

  it("lets an unknown capability through rather than refusing a model that works", () => {
    // Nobody publishes a capability table for arbitrary local weights. Refusing
    // on "unknown" would make the strictness worse than useless.
    expect(capabilityRefusal(unknown, ["tools", "structuredOutput"])).toBeNull();
  });

  it("names every missing capability at once, not one per attempt", () => {
    const both = describeModel({
      provider: "p",
      modelId: "plain",
      displayName: "Plain",
      capabilities: { streaming: false, structuredOutput: false, tools: false },
    });
    const refusal = capabilityRefusal(both, ["tools", "structuredOutput"]);
    expect(refusal).toContain("tool calling");
    expect(refusal).toContain("structured output");
  });
});
