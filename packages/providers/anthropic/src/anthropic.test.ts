import { describe, expect, it } from "vitest";
import {
  toAnthropicRequest,
  fromAnthropicResponse,
  mapStopReason,
  DEFAULT_MAX_OUTPUT_TOKENS,
} from "./mapping";
import { AnthropicLanguageModel, AnthropicApiError } from "./anthropic-model";
import type { FetchLike } from "./anthropic-model";

describe("Anthropic request mapping", () => {
  it("maps a provider-independent request to the wire body", () => {
    const body = toAnthropicRequest("claude-x", {
      system: "be terse",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.4,
      stopSequences: ["END"],
      maxOutputTokens: 256,
    });
    expect(body).toEqual({
      model: "claude-x",
      max_tokens: 256,
      system: "be terse",
      temperature: 0.4,
      stop_sequences: ["END"],
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("applies a default max_tokens and omits absent optionals", () => {
    const body = toAnthropicRequest("claude-x", {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(body.max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(body.system).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.stop_sequences).toBeUndefined();
  });
});

describe("Anthropic response mapping", () => {
  it("normalises stop reasons", () => {
    expect(mapStopReason("end_turn")).toBe("stop");
    expect(mapStopReason("max_tokens")).toBe("max_tokens");
    expect(mapStopReason("stop_sequence")).toBe("stop_sequence");
    expect(mapStopReason("tool_use")).toBe("tool_use");
    expect(mapStopReason(null)).toBe("other");
    expect(mapStopReason("weird")).toBe("other");
  });

  it("concatenates text blocks and maps usage", () => {
    const result = fromAnthropicResponse({
      content: [
        { type: "text", text: "Hello " },
        { type: "thinking", text: "(ignored non-text block)" },
        { type: "text", text: "world" },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 12, output_tokens: 3 },
    });
    expect(result.text).toBe("Hello world");
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    expect(result.stopReason).toBe("stop");
  });
});

describe("AnthropicLanguageModel", () => {
  it("posts to the Messages API and returns a provider-independent result", async () => {
    const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
    const fakeFetch: FetchLike = (url, init) => {
      calls.push({ url, body: init.body, headers: init.headers });
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(""),
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "drafted" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 5, output_tokens: 2 },
          }),
      });
    };

    const model = new AnthropicLanguageModel({
      apiKey: "sk-test",
      model: "claude-x",
      fetch: fakeFetch,
    });
    expect(model.id).toBe("anthropic:claude-x");

    const result = await model.generate({ messages: [{ role: "user", content: "draft" }] });
    expect(result.text).toBe("drafted");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]?.headers["x-api-key"]).toBe("sk-test");
    expect(calls[0]?.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("raises AnthropicApiError on a non-ok response", async () => {
    const fakeFetch: FetchLike = () =>
      Promise.resolve({
        ok: false,
        status: 429,
        text: () => Promise.resolve("rate limited"),
        json: () => Promise.resolve({}),
      });
    const model = new AnthropicLanguageModel({ apiKey: "k", model: "claude-x", fetch: fakeFetch });
    await expect(
      model.generate({ messages: [{ role: "user", content: "x" }] }),
    ).rejects.toBeInstanceOf(AnthropicApiError);
  });
});
