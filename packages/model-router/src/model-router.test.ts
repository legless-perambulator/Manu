import { describe, expect, it } from "vitest";
import { ValidationError, NotImplementedError } from "@jellytind/shared";
import { ModelRouter, ModelRoutingError } from "./router";
import { EchoModel } from "./echo-model";
import { parseModelJson } from "./model";
import type { OutputSchema } from "./types";

const userTurn = (content: string) => ({ messages: [{ role: "user" as const, content }] });

describe("EchoModel", () => {
  it("echoes the last user message and reports usage", async () => {
    const model = new EchoModel();
    const result = await model.generate(userTurn("hello world"));
    expect(result.text).toBe("hello world");
    expect(result.stopReason).toBe("stop");
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it("streams deltas that reassemble to the full text", async () => {
    const model = new EchoModel({ reply: "the quick brown fox jumps" });
    let assembled = "";
    let done = false;
    for await (const event of model.stream(userTurn("ignored"))) {
      if (event.type === "text-delta") assembled += event.delta;
      else done = true;
    }
    expect(assembled).toBe("the quick brown fox jumps");
    expect(done).toBe(true);
  });

  it("rejects tool calling as not implemented", async () => {
    const model = new EchoModel();
    await expect(model.generateWithTools({ ...userTurn("x"), tools: [] })).rejects.toBeInstanceOf(
      NotImplementedError,
    );
  });
});

describe("ModelRouter", () => {
  it("routes tasks to bound models and falls back to the default", () => {
    const drafting = new EchoModel({ id: "drafting" });
    const fallback = new EchoModel({ id: "fallback" });
    const router = new ModelRouter({ defaultModel: fallback, routes: { drafting } });

    expect(router.route("drafting").id).toBe("drafting");
    expect(router.route("continuity").id).toBe("fallback");
  });

  it("supports fluent registration", () => {
    const planning = new EchoModel({ id: "planner" });
    const router = new ModelRouter().register("planning", planning);
    expect(router.route("planning").id).toBe("planner");
  });

  it("throws when no model can serve a task", () => {
    const router = new ModelRouter();
    expect(() => router.route("metadata")).toThrow(ModelRoutingError);
    expect(router.has("metadata")).toBe(false);
  });
});

describe("parseModelJson / generateStructured", () => {
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

  it("parses and validates well-formed structured output", async () => {
    const model = new EchoModel({ reply: JSON.stringify({ learns: ["FACT_0001"] }) });
    const out = await model.generateStructured({ ...userTurn("extract"), schema });
    expect(out.learns).toEqual(["FACT_0001"]);
  });

  it("wraps invalid JSON in a ValidationError", () => {
    expect(() => parseModelJson(schema, "not json")).toThrow(ValidationError);
  });

  it("wraps schema violations in a ValidationError", () => {
    expect(() => parseModelJson(schema, JSON.stringify({ wrong: true }))).toThrow(ValidationError);
  });
});
