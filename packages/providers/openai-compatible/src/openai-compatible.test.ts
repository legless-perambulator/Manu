import { describe, expect, it } from "vitest";
import { ModelError, capabilityRefusal, capabilityState } from "@jellytind/model-router";
import type { FetchLike } from "./model";
import { OpenAiCompatibleModel } from "./model";
import {
  OpenAiCompatibleProvider,
  ollamaProvider,
  openAiCompatibleProvider,
  openAiProvider,
  openRouterProvider,
  parseOllamaModels,
  parseOpenAiModels,
} from "./providers";

/**
 * No test here touches a network or needs a real credential. Every provider is
 * exercised through an injected `fetch`, which is the whole point of the port:
 * the transport is replaceable, so the wire format can be asserted exactly
 * (AGENTS.md — "Tests must not require paid credentials").
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function recordingFetch(body: unknown, status = 200): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    });
  };
  return { fetch, calls };
}

const unreachableFetch: FetchLike = () => Promise.reject(new Error("connect ECONNREFUSED"));

const completion = (content: string, extra: Record<string, unknown> = {}) => ({
  choices: [{ message: { role: "assistant", content, ...extra }, finish_reason: "stop" }],
  usage: { prompt_tokens: 11, completion_tokens: 3 },
});

function sseFetch(frames: readonly string[]): FetchLike {
  return () =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({}),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const frame of frames) controller.enqueue(encoder.encode(frame));
          controller.close();
        },
      }),
    });
}

describe("OpenAiCompatibleModel", () => {
  it("posts chat completions and reads the reply and usage back", async () => {
    const { fetch, calls } = recordingFetch(completion("Ready."));
    const model = new OpenAiCompatibleModel({
      baseUrl: "https://api.example.com/v1",
      model: "gpt-test",
      apiKey: "sk-test",
      fetch,
    });

    const result = await model.generateText({
      system: "Be brief.",
      messages: [{ role: "user", content: "Hello" }],
      maxOutputTokens: 32,
    });

    expect(result.text).toBe("Ready.");
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 3 });
    expect(result.stopReason).toBe("stop");

    const call = calls[0];
    expect(call).toBeDefined();
    expect(call?.url).toBe("https://api.example.com/v1/chat/completions");
    expect(call?.headers.authorization).toBe("Bearer sk-test");
    const sent = JSON.parse(call?.body ?? "{}") as {
      model: string;
      messages: { role: string }[];
      max_tokens: number;
    };
    expect(sent.model).toBe("gpt-test");
    expect(sent.messages[0]?.role).toBe("system");
    expect(sent.max_tokens).toBe(32);
  });

  it("sends no Authorization header when there is no key", async () => {
    // A local server needs no credential, and some refuse a request carrying an
    // empty bearer token outright.
    const { fetch, calls } = recordingFetch(completion("hi"));
    const model = new OpenAiCompatibleModel({
      baseUrl: "http://localhost:11434/v1",
      model: "llama3",
      fetch,
    });
    await model.generateText({ messages: [{ role: "user", content: "hi" }] });
    expect(calls[0]?.headers.authorization).toBeUndefined();
  });

  it("asks for a JSON object and refuses output that is not valid JSON", async () => {
    const schema = {
      name: "verdict",
      schema: { type: "object" },
      parse: (value: unknown) => value as { ok: boolean },
    };

    const good = new OpenAiCompatibleModel({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      apiKey: "k",
      ...recordingFetch(completion('{"ok":true}')),
    });
    await expect(
      good.generateStructured({ messages: [{ role: "user", content: "?" }], schema }),
    ).resolves.toEqual({ ok: true });

    const bad = new OpenAiCompatibleModel({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      apiKey: "k",
      ...recordingFetch(completion("Sorry, I cannot.")),
    });
    await expect(
      bad.generateStructured({ messages: [{ role: "user", content: "?" }], schema }),
    ).rejects.toBeInstanceOf(ModelError);
  });

  it("reads tool calls back, and survives unparsable arguments", async () => {
    const { fetch } = recordingFetch(
      completion("", {
        tool_calls: [
          { id: "c1", function: { name: "read_scene", arguments: '{"id":"SCN_1"}' } },
          { id: "c2", function: { name: "broken", arguments: "not json" } },
        ],
      }),
    );
    const model = new OpenAiCompatibleModel({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      apiKey: "k",
      fetch,
    });

    const result = await model.runWithTools({
      messages: [{ role: "user", content: "go" }],
      tools: [{ name: "read_scene", description: "", inputSchema: { type: "object" } }],
    });

    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0]?.input).toEqual({ id: "SCN_1" });
    expect(result.toolCalls[1]?.input).toEqual({});
  });

  it("streams deltas and finishes with usage", async () => {
    const model = new OpenAiCompatibleModel({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      apiKey: "k",
      fetch: sseFetch([
        'data: {"choices":[{"delta":{"content":"Once "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"upon"},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":2}}\n\n',
        "data: [DONE]\n\n",
      ]),
    });

    const deltas: string[] = [];
    let done: { inputTokens: number; outputTokens: number } | null = null;
    for await (const event of model.streamText({ messages: [{ role: "user", content: "go" }] })) {
      if (event.type === "text-delta") deltas.push(event.delta);
      if (event.type === "done") done = event.usage;
    }
    expect(deltas.join("")).toBe("Once upon");
    expect(done).toEqual({ inputTokens: 4, outputTokens: 2 });
  });

  it("falls back to one shot when the server sends no streaming body", async () => {
    // A writer does not care whether the text arrived in pieces.
    const { fetch } = recordingFetch(completion("All at once."));
    const model = new OpenAiCompatibleModel({
      baseUrl: "https://api.example.com/v1",
      model: "m",
      apiKey: "k",
      fetch,
    });
    const deltas: string[] = [];
    for await (const event of model.streamText({ messages: [{ role: "user", content: "x" }] })) {
      if (event.type === "text-delta") deltas.push(event.delta);
    }
    expect(deltas.join("")).toBe("All at once.");
  });

  it("maps HTTP status onto typed error codes", async () => {
    const cases: readonly [number, string][] = [
      [401, "auth"],
      [403, "auth"],
      [429, "rate_limit"],
      [404, "unsupported"],
      [500, "provider_error"],
    ];
    for (const [status, code] of cases) {
      const model = new OpenAiCompatibleModel({
        baseUrl: "https://api.example.com/v1",
        model: "m",
        apiKey: "k",
        ...recordingFetch({ error: "no" }, status),
      });
      await expect(
        model.generateText({ messages: [{ role: "user", content: "x" }] }),
      ).rejects.toMatchObject({ modelCode: code });
    }
  });

  it("reports an unreachable server as a network failure, not a raw TypeError", async () => {
    const model = new OpenAiCompatibleModel({
      baseUrl: "http://192.168.1.50:11434/v1",
      model: "llama3",
      fetch: unreachableFetch,
    });
    await expect(
      model.generateText({ messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({ modelCode: "network" });
  });
});

describe("discovery parsing", () => {
  it("reads the OpenAI shape", () => {
    const models = parseOpenAiModels(
      { data: [{ id: "gpt-4o" }, { id: "gpt-4o-mini", context_length: 128_000 }, { nope: 1 }] },
      "openai",
    );
    expect(models.map((m) => m.modelId)).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(models[1]?.contextWindow).toBe(128_000);
  });

  it("reads the Ollama shape and admits what it does not know", () => {
    const models = parseOllamaModels(
      { models: [{ name: "llama3:8b" }, { name: "qwen" }] },
      "ollama",
    );
    expect(models.map((m) => m.modelId)).toEqual(["llama3:8b", "qwen"]);
    const first = models[0];
    expect(first).toBeDefined();
    // Streaming is a property of the server; tool calling is a property of the
    // weights, which Ollama does not report. Claiming to know would be a lie.
    expect(capabilityState(first as NonNullable<typeof first>, "streaming")).toBe("yes");
    expect(capabilityState(first as NonNullable<typeof first>, "tools")).toBe("unknown");
    // Unknown never blocks an operation — only a known "no" does.
    expect(capabilityRefusal(first as NonNullable<typeof first>, ["tools"])).toBeNull();
  });

  it("returns nothing rather than throwing on a body it does not recognise", () => {
    expect(parseOpenAiModels({ unexpected: true }, "openai")).toEqual([]);
    expect(parseOllamaModels("not an object", "ollama")).toEqual([]);
  });
});

describe("provider identities", () => {
  it("describes itself for the settings interface without any UI code knowing names", () => {
    expect(openAiProvider().describe()).toMatchObject({
      id: "openai",
      auth: "api_key",
      local: false,
      supportsDiscovery: true,
      connectionKind: "api",
    });
    expect(ollamaProvider().describe()).toMatchObject({
      id: "ollama",
      auth: "none",
      local: true,
      configurableBaseUrl: true,
    });
    expect(openRouterProvider().describe().credentialsUrl).toContain("openrouter.ai");
  });

  it("refuses to build a hosted model with no key, but a local one needs none", () => {
    expect(() => openAiProvider().createModel("gpt-4o", {})).toThrow(ModelError);
    expect(() => ollamaProvider().createModel("llama3", {})).not.toThrow();
  });

  it("keeps the writer's Ollama address as the root and adds /v1 only for chat", async () => {
    const tags = recordingFetch({ models: [{ name: "llama3" }] });
    const provider = ollamaProvider({ fetch: tags.fetch });
    await provider.discoverModels({ baseUrl: "http://192.168.1.50:11434" });
    expect(tags.calls[0]?.url).toBe("http://192.168.1.50:11434/api/tags");

    const chat = recordingFetch(completion("hi"));
    const model = ollamaProvider({ fetch: chat.fetch }).createModel("llama3", {
      baseUrl: "http://192.168.1.50:11434",
    });
    await model.generateText({ messages: [{ role: "user", content: "hi" }] });
    expect(chat.calls[0]?.url).toBe("http://192.168.1.50:11434/v1/chat/completions");
  });

  it("ignores a base URL for a provider whose address is not the writer's to set", async () => {
    const { fetch, calls } = recordingFetch({ data: [] });
    await openAiProvider({ fetch }).discoverModels({ apiKey: "k", baseUrl: "http://evil.example" });
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/models");
  });

  it("names the machine it could not reach", async () => {
    const provider = ollamaProvider({ fetch: unreachableFetch });
    const result = await provider.testConnection({ baseUrl: "http://192.168.1.50:11434" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("192.168.1.50:11434");
    // The raw cause is kept, but out of the sentence a writer reads first.
    expect(result.message).not.toContain("ECONNREFUSED");
    expect(result.detail).toBeDefined();
  });

  it("blames the key, not the network, on a 401", async () => {
    const { fetch } = recordingFetch({ error: "bad key" }, 401);
    const result = await openAiProvider({ fetch }).testConnection({ apiKey: "wrong" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Authentication failed");
  });

  it("counts the models a successful test found", async () => {
    const { fetch } = recordingFetch({ data: [{ id: "a" }, { id: "b" }] });
    const result = await openAiProvider({ fetch }).testConnection({ apiKey: "k" });
    expect(result).toMatchObject({ ok: true, models: 2 });
  });

  it("says so plainly when a server answers but has nothing loaded", async () => {
    const { fetch } = recordingFetch({ models: [] });
    const result = await ollamaProvider({ fetch }).testConnection({
      baseUrl: "http://localhost:11434",
    });
    expect(result).toMatchObject({ ok: true, models: 0 });
    expect(result.message).toContain("no models");
  });

  it("sends OpenRouter its attribution headers", async () => {
    const { fetch, calls } = recordingFetch({ data: [{ id: "x" }] });
    await openRouterProvider({ fetch }).discoverModels({ apiKey: "k" });
    expect(calls[0]?.headers["X-Title"]).toBe("Manu");
  });

  it("lets any other OpenAI-compatible server be configured by address", async () => {
    const { fetch, calls } = recordingFetch({ data: [{ id: "local-model" }] });
    const provider = openAiCompatibleProvider({ fetch });
    const models = await provider.discoverModels({ baseUrl: "http://10.0.0.4:8080/v1" });
    expect(calls[0]?.url).toBe("http://10.0.0.4:8080/v1/models");
    expect(models[0]?.unknownCapabilities).toContain("tools");
  });

  it("reports no discovery when a configuration offers none", async () => {
    const provider = new OpenAiCompatibleProvider({
      id: "frozen",
      displayName: "Frozen",
      summary: "No listing endpoint.",
      auth: "none",
      local: true,
      configurableBaseUrl: false,
      defaultBaseUrl: "http://localhost:9999/v1",
      fallbackModels: [],
    });
    expect(provider.describe().supportsDiscovery).toBe(false);
    await expect(provider.discoverModels({})).resolves.toEqual([]);
  });
});
