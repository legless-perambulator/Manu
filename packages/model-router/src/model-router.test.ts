import { describe, expect, it } from "vitest";
import { ModelRouter, ModelRoutingError } from "./router";
import { MockLanguageModel } from "./mock-model";
import { parseModelJson } from "./model";
import { ModelError } from "./errors";
import { ModelRegistry, describeModel } from "./registry";
import { InMemorySecretStore, secretKeyForProvider } from "./secrets";
import type { OutputSchema } from "./types";

const userTurn = (content: string) => ({ messages: [{ role: "user" as const, content }] });

describe("MockLanguageModel", () => {
  it("generates text and records calls", async () => {
    const model = new MockLanguageModel();
    const result = await model.generateText(userTurn("hello world"));
    expect(result.text).toBe("hello world");
    expect(result.stopReason).toBe("stop");
    expect(model.calls).toHaveLength(1);
  });

  it("streams deltas that reassemble to the full text", async () => {
    const model = new MockLanguageModel({ text: "the quick brown fox jumps" });
    let assembled = "";
    let done = false;
    for await (const event of model.streamText(userTurn("ignored"))) {
      if (event.type === "text-delta") assembled += event.delta;
      else done = true;
    }
    expect(assembled).toBe("the quick brown fox jumps");
    expect(done).toBe(true);
  });

  it("returns tool calls from runWithTools", async () => {
    const model = new MockLanguageModel({
      toolCalls: [{ id: "t1", name: "get_scene", input: { id: "SCENE_0001" } }],
    });
    const result = await model.runWithTools({ ...userTurn("x"), tools: [] });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.stopReason).toBe("tool_use");
  });

  it("fails with unsupported when a capability is off", async () => {
    const model = new MockLanguageModel({ capabilities: { tools: false } });
    await expect(model.runWithTools({ ...userTurn("x"), tools: [] })).rejects.toMatchObject({
      modelCode: "unsupported",
    });
  });

  it("injects typed failures for error handling", async () => {
    for (const code of ["network", "rate_limit", "auth", "timeout"] as const) {
      const model = new MockLanguageModel({ failWith: code });
      await expect(model.generateText(userTurn("x"))).rejects.toMatchObject({ modelCode: code });
    }
  });

  it("maps an aborted signal to a cancelled failure", async () => {
    const model = new MockLanguageModel();
    const controller = new AbortController();
    controller.abort();
    await expect(
      model.generateText(userTurn("x"), { signal: controller.signal }),
    ).rejects.toMatchObject({ modelCode: "cancelled" });
  });
});

describe("structured output", () => {
  interface Extract {
    learns: string[];
  }
  const schema: OutputSchema<Extract> = {
    name: "StateExtraction",
    parse(value) {
      if (
        typeof value === "object" &&
        value !== null &&
        Array.isArray((value as { learns?: unknown }).learns)
      ) {
        return value as Extract;
      }
      throw new Error("expected { learns: string[] }");
    },
  };

  it("validates well-formed structured output through the model", async () => {
    const model = new MockLanguageModel({ structured: { learns: ["FACT_0001"] } });
    const out = await model.generateStructured({ ...userTurn("extract"), schema });
    expect(out.learns).toEqual(["FACT_0001"]);
  });

  it("turns malformed model output into a typed invalid_output failure", async () => {
    const model = new MockLanguageModel({ text: "not json" });
    await expect(model.generateStructured({ ...userTurn("x"), schema })).rejects.toMatchObject({
      modelCode: "invalid_output",
    });
    expect(() => parseModelJson(schema, JSON.stringify({ wrong: true }))).toThrow(ModelError);
  });
});

describe("ModelRouter", () => {
  it("routes tasks and falls back to a default", () => {
    const drafting = new MockLanguageModel({ id: "drafting" });
    const fallback = new MockLanguageModel({ id: "fallback" });
    const router = new ModelRouter({ defaultModel: fallback, routes: { drafting } });
    expect(router.route("drafting").id).toBe("drafting");
    expect(router.route("continuity").id).toBe("fallback");
  });

  it("throws when no model can serve a task", () => {
    expect(() => new ModelRouter().route("metadata")).toThrow(ModelRoutingError);
  });
});

describe("ModelRegistry", () => {
  it("stores model metadata and derives supports flags", () => {
    const registry = new ModelRegistry().register(
      describeModel({
        provider: "mock",
        modelId: "m1",
        displayName: "Mock One",
        capabilities: { streaming: true, structuredOutput: true, tools: false },
        contextWindow: 100000,
        costMetadata: { inputPer1M: 3, outputPer1M: 15, currency: "USD" },
      }),
    );
    const d = registry.get("mock", "m1");
    expect(d?.supportsStreaming).toBe(true);
    expect(d?.supportsTools).toBe(false);
    expect(d?.contextWindow).toBe(100000);
    expect(registry.list("mock")).toHaveLength(1);
    expect(registry.providers()).toEqual(["mock"]);
  });
});

describe("SecretStore", () => {
  it("stores and clears secrets by provider key", async () => {
    const secrets = new InMemorySecretStore();
    const key = secretKeyForProvider("anthropic");
    expect(await secrets.get(key)).toBeNull();
    await secrets.set(key, "sk-123");
    expect(await secrets.get(key)).toBe("sk-123");
    await secrets.delete(key);
    expect(await secrets.get(key)).toBeNull();
  });
});
