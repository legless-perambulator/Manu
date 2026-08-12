import { describe, expect, it } from "vitest";
import type { OutputSchema, StopReason } from "@jellytind/model-router";
import {
  toAnthropicRequest,
  fromAnthropicResponse,
  fromAnthropicToolResponse,
  mapStopReason,
  mapStreamData,
  errorFromStatus,
  errorFromThrown,
  DEFAULT_MAX_OUTPUT_TOKENS,
} from "./mapping";
import { parseSseStream, decodeByteStream } from "./sse";
import { AnthropicLanguageModel } from "./anthropic-model";
import type { FetchLike } from "./anthropic-model";
import { AnthropicProvider, ANTHROPIC_MODELS } from "./models";

/** Build a fake `fetch` that returns a JSON body and records the calls made. */
function jsonFetch(body: unknown): {
  fetch: FetchLike;
  calls: Array<{ url: string; body: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({ url, body: init.body, headers: init.headers });
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve(body),
    });
  };
  return { fetch, calls };
}

/** A fake `fetch` returning a non-ok status, for error-mapping tests. */
const failingFetch =
  (status: number, text = "boom"): FetchLike =>
  () =>
    Promise.resolve({
      ok: false,
      status,
      text: () => Promise.resolve(text),
      json: () => Promise.resolve({}),
    });

/** A fake `fetch` streaming canned SSE text as bytes. */
const sseFetch =
  (frames: readonly string[]): FetchLike =>
  () =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({}),
      body: (async function* () {
        const encoder = new TextEncoder();
        for (const frame of frames) yield encoder.encode(frame);
      })(),
    });

const userTurn = (content: string) => ({ messages: [{ role: "user" as const, content }] });

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
    const body = toAnthropicRequest("claude-x", { messages: [{ role: "user", content: "hi" }] });
    expect(body.max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(body.system).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.stop_sequences).toBeUndefined();
    expect(body.stream).toBeUndefined();
    expect(body.tools).toBeUndefined();
  });

  it("adds stream and tool fields when requested", () => {
    const body = toAnthropicRequest("claude-x", userTurn("hi"), {
      stream: true,
      tools: [
        {
          name: "read_scene",
          description: "Read a scene by id",
          inputSchema: { type: "object", properties: { id: { type: "string" } } },
        },
      ],
    });
    expect(body.stream).toBe(true);
    expect(body.tools).toEqual([
      {
        name: "read_scene",
        description: "Read a scene by id",
        input_schema: { type: "object", properties: { id: { type: "string" } } },
      },
    ]);
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

  it("extracts tool_use blocks as provider-independent tool calls", () => {
    const result = fromAnthropicToolResponse({
      content: [
        { type: "text", text: "looking that up" },
        { type: "tool_use", id: "toolu_1", name: "read_scene", input: { id: "SCENE_0001" } },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 8 },
    });
    expect(result.text).toBe("looking that up");
    expect(result.toolCalls).toEqual([
      { id: "toolu_1", name: "read_scene", input: { id: "SCENE_0001" } },
    ]);
    expect(result.stopReason).toBe("tool_use");
  });
});

describe("SSE parsing", () => {
  it("reassembles events split across chunk boundaries", async () => {
    const chunks = (async function* () {
      yield 'event: ping\ndata: {"a"';
      yield ':1}\n\nevent: done\ndata: {"b":2}\n\n';
    })();
    const events = [];
    for await (const event of parseSseStream(chunks)) events.push(event);
    expect(events).toEqual([
      { event: "ping", data: '{"a":1}' },
      { event: "done", data: '{"b":2}' },
    ]);
  });

  it("decodes a byte stream into text, ignoring comment lines", async () => {
    const encoder = new TextEncoder();
    const bytes = (async function* () {
      yield encoder.encode(": heartbeat\nevent: x\ndata: hi\n\n");
    })();
    const events = [];
    for await (const event of parseSseStream(decodeByteStream(bytes))) events.push(event);
    expect(events).toEqual([{ event: "x", data: "hi" }]);
  });
});

describe("stream event mapping", () => {
  it("maps Anthropic stream frames onto normalised events", () => {
    const state = { inputTokens: 0, outputTokens: 0, stopReason: "stop" as StopReason };
    expect(
      mapStreamData({ type: "message_start", message: { usage: { input_tokens: 9 } } }, state),
    ).toBeNull();
    expect(state.inputTokens).toBe(9);
    expect(mapStreamData({ type: "content_block_start" }, state)).toBeNull();
    expect(mapStreamData({ type: "content_block_delta", delta: { text: "Ha" } }, state)).toEqual({
      type: "text-delta",
      delta: "Ha",
    });
    expect(
      mapStreamData(
        {
          type: "message_delta",
          delta: { stop_reason: "max_tokens" },
          usage: { output_tokens: 4 },
        },
        state,
      ),
    ).toBeNull();
    expect(mapStreamData({ type: "message_stop" }, state)).toEqual({
      type: "done",
      usage: { inputTokens: 9, outputTokens: 4 },
      stopReason: "max_tokens",
    });
  });
});

describe("failure mapping", () => {
  it("maps HTTP statuses onto typed model failures", () => {
    expect(errorFromStatus(401, "").modelCode).toBe("auth");
    expect(errorFromStatus(403, "").modelCode).toBe("auth");
    expect(errorFromStatus(429, "").modelCode).toBe("rate_limit");
    expect(errorFromStatus(500, "").modelCode).toBe("provider_error");
    expect(errorFromStatus(400, "").modelCode).toBe("provider_error");
    expect(errorFromStatus(429, "").retryable).toBe(true);
    expect(errorFromStatus(401, "").retryable).toBe(false);
  });

  it("maps thrown transport errors onto typed model failures", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(errorFromThrown(abort).modelCode).toBe("cancelled");
    const timeout = new Error("slow");
    timeout.name = "TimeoutError";
    expect(errorFromThrown(timeout).modelCode).toBe("timeout");
    expect(errorFromThrown(new Error("ECONNREFUSED")).modelCode).toBe("network");
    expect(errorFromThrown(errorFromStatus(429, "")).modelCode).toBe("rate_limit");
  });
});

describe("AnthropicLanguageModel", () => {
  it("posts to the Messages API and returns a provider-independent result", async () => {
    const { fetch, calls } = jsonFetch({
      content: [{ type: "text", text: "drafted" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    const model = new AnthropicLanguageModel({ apiKey: "sk-test", model: "claude-x", fetch });
    expect(model.id).toBe("anthropic:claude-x");
    expect(model.capabilities).toEqual({ streaming: true, structuredOutput: true, tools: true });

    const result = await model.generateText(userTurn("draft"));
    expect(result.text).toBe("drafted");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]?.headers["x-api-key"]).toBe("sk-test");
    expect(calls[0]?.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("streams text deltas and a terminal done event", async () => {
    const model = new AnthropicLanguageModel({
      apiKey: "k",
      model: "claude-x",
      fetch: sseFetch([
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":7}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"Rain "}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"text":"fell."}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    });

    let assembled = "";
    let done: { inputTokens: number; outputTokens: number } | undefined;
    for await (const event of model.streamText(userTurn("write"))) {
      if (event.type === "text-delta") assembled += event.delta;
      else done = event.usage;
    }
    expect(assembled).toBe("Rain fell.");
    expect(done).toEqual({ inputTokens: 7, outputTokens: 3 });
  });

  it("returns tool calls from runWithTools and sends the tool definitions", async () => {
    const { fetch, calls } = jsonFetch({
      content: [{ type: "tool_use", id: "toolu_1", name: "read_scene", input: { id: "S1" } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 4, output_tokens: 1 },
    });
    const model = new AnthropicLanguageModel({ apiKey: "k", model: "claude-x", fetch });
    const result = await model.runWithTools({
      ...userTurn("look it up"),
      tools: [{ name: "read_scene", description: "Read a scene", inputSchema: { type: "object" } }],
    });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.stopReason).toBe("tool_use");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
      tools: [{ name: "read_scene" }],
    });
  });

  it("validates structured output and rejects malformed output", async () => {
    interface Extract {
      learns: string[];
    }
    const schema: OutputSchema<Extract> = {
      name: "StateExtraction",
      parse(value) {
        if (Array.isArray((value as { learns?: unknown }).learns)) return value as Extract;
        throw new Error("expected { learns: string[] }");
      },
    };

    const ok = new AnthropicLanguageModel({
      apiKey: "k",
      model: "claude-x",
      fetch: jsonFetch({
        content: [{ type: "text", text: '{"learns":["FACT_0001"]}' }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }).fetch,
    });
    await expect(ok.generateStructured({ ...userTurn("x"), schema })).resolves.toEqual({
      learns: ["FACT_0001"],
    });

    const bad = new AnthropicLanguageModel({
      apiKey: "k",
      model: "claude-x",
      fetch: jsonFetch({
        content: [{ type: "text", text: "Sure! Here you go:" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      }).fetch,
    });
    await expect(bad.generateStructured({ ...userTurn("x"), schema })).rejects.toMatchObject({
      modelCode: "invalid_output",
    });
  });

  it("returns typed failures for auth, rate limit and network problems", async () => {
    for (const [status, code] of [
      [401, "auth"],
      [429, "rate_limit"],
      [500, "provider_error"],
    ] as const) {
      const model = new AnthropicLanguageModel({
        apiKey: "k",
        model: "claude-x",
        fetch: failingFetch(status),
      });
      await expect(model.generateText(userTurn("x"))).rejects.toMatchObject({ modelCode: code });
    }

    const offline = new AnthropicLanguageModel({
      apiKey: "k",
      model: "claude-x",
      fetch: () => Promise.reject(new Error("ECONNREFUSED")),
    });
    await expect(offline.generateText(userTurn("x"))).rejects.toMatchObject({
      modelCode: "network",
    });
  });

  it("maps an aborted request to a cancelled failure", async () => {
    const controller = new AbortController();
    const model = new AnthropicLanguageModel({
      apiKey: "k",
      model: "claude-x",
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    });
    const pending = model.generateText(userTurn("x"), {
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ modelCode: "cancelled" });
  });

  it("maps an elapsed timeout to a timeout failure", async () => {
    const model = new AnthropicLanguageModel({
      apiKey: "k",
      model: "claude-x",
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("timed out");
            error.name = "TimeoutError";
            reject(error);
          });
        }),
    });
    await expect(model.generateText(userTurn("x"), { timeoutMs: 1 })).rejects.toMatchObject({
      modelCode: "timeout",
    });
  });
});

describe("AnthropicProvider", () => {
  it("publishes a model catalog with capability metadata", () => {
    const provider = new AnthropicProvider();
    expect(provider.name).toBe("anthropic");
    const models = provider.models();
    expect(models).toHaveLength(ANTHROPIC_MODELS.length);
    for (const descriptor of models) {
      expect(descriptor.provider).toBe("anthropic");
      expect(descriptor.supportsStreaming).toBe(true);
      expect(descriptor.contextWindow).toBeGreaterThan(0);
    }
  });

  it("creates a model from credentials and rejects a missing API key", () => {
    const provider = new AnthropicProvider({ fetch: jsonFetch({}).fetch });
    const model = provider.createModel("claude-x", { apiKey: "sk-test" });
    expect(model.id).toBe("anthropic:claude-x");
    expect(() => provider.createModel("claude-x", {})).toThrowError(/API key/);
    expect(() => provider.createModel("claude-x", { apiKey: "  " })).toThrowError(/API key/);
  });
});
