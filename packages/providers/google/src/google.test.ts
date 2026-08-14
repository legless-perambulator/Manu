import { describe, expect, it } from "vitest";
import { ModelError } from "@jellytind/model-router";
import { GOOGLE_MODELS, GoogleLanguageModel, GoogleProvider, type FetchLike } from "./index";

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

const reply = (text: string) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 },
});

describe("Google Gemini adapter", () => {
  it("translates a request into Gemini's shape and reads the reply back", async () => {
    const { fetch, calls } = recordingFetch(reply("Ready."));
    const model = new GoogleLanguageModel({ apiKey: "k", model: "gemini-test", fetch });

    const result = await model.generateText({
      system: "Be brief.",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ],
      maxOutputTokens: 40,
    });

    expect(result.text).toBe("Ready.");
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 2 });

    const sent = JSON.parse(calls[0]?.body ?? "{}") as {
      contents: { role: string }[];
      systemInstruction?: unknown;
      generationConfig: { maxOutputTokens?: number };
    };
    expect(sent.systemInstruction).toBeDefined();
    // Gemini calls the assistant "model". Nothing outside this adapter knows that.
    expect(sent.contents.map((c) => c.role)).toEqual(["user", "model"]);
    expect(sent.generationConfig.maxOutputTokens).toBe(40);
  });

  it("sends the key as a header, never in the URL", async () => {
    // A query-string key ends up in proxy and server access logs.
    const { fetch, calls } = recordingFetch(reply("hi"));
    const model = new GoogleLanguageModel({ apiKey: "secret-key", model: "gemini-test", fetch });
    await model.generateText({ messages: [{ role: "user", content: "hi" }] });

    expect(calls[0]?.url).not.toContain("secret-key");
    expect(calls[0]?.headers["x-goog-api-key"]).toBe("secret-key");
  });

  it("reads function calls back as tool calls", async () => {
    const { fetch } = recordingFetch({
      candidates: [
        {
          content: { parts: [{ functionCall: { name: "read_scene", args: { id: "SCN_1" } } }] },
          finishReason: "STOP",
        },
      ],
    });
    const model = new GoogleLanguageModel({ apiKey: "k", model: "gemini-test", fetch });
    const result = await model.runWithTools({
      messages: [{ role: "user", content: "go" }],
      tools: [{ name: "read_scene", description: "", inputSchema: { type: "object" } }],
    });
    expect(result.toolCalls[0]).toMatchObject({ name: "read_scene", input: { id: "SCN_1" } });
    expect(result.stopReason).toBe("tool_use");
  });

  it("maps HTTP status onto typed error codes", async () => {
    for (const [status, code] of [
      [401, "auth"],
      [429, "rate_limit"],
      [404, "unsupported"],
      [500, "provider_error"],
    ] as const) {
      const { fetch } = recordingFetch({ error: {} }, status);
      const model = new GoogleLanguageModel({ apiKey: "k", model: "m", fetch });
      await expect(
        model.generateText({ messages: [{ role: "user", content: "x" }] }),
      ).rejects.toMatchObject({ modelCode: code });
    }
  });
});

describe("GoogleProvider", () => {
  it("describes itself for the settings interface", () => {
    expect(new GoogleProvider().describe()).toMatchObject({
      id: "google",
      auth: "api_key",
      local: false,
      configurableBaseUrl: false,
      supportsDiscovery: true,
      connectionKind: "api",
    });
  });

  it("refuses to build a model with no key rather than failing at the first call", () => {
    expect(() => new GoogleProvider().createModel("gemini-test", {})).toThrow(ModelError);
  });

  it("reads the discovery shape and drops models that cannot generate", async () => {
    const { fetch } = recordingFetch({
      models: [
        {
          name: "models/gemini-2.5-pro",
          displayName: "Gemini 2.5 Pro",
          inputTokenLimit: 1_048_576,
          supportedGenerationMethods: ["generateContent"],
        },
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      ],
    });
    const models = await new GoogleProvider({ fetch }).discoverModels({ apiKey: "k" });
    expect(models.map((m) => m.modelId)).toEqual(["gemini-2.5-pro"]);
    expect(models[0]?.displayName).toBe("Gemini 2.5 Pro");
    expect(models[0]?.contextWindow).toBe(1_048_576);
  });

  it("falls back to the shipped catalogue when the body is not what was expected", async () => {
    const { fetch } = recordingFetch({ unexpected: true });
    const models = await new GoogleProvider({ fetch }).discoverModels({ apiKey: "k" });
    expect(models).toEqual([...GOOGLE_MODELS]);
  });

  it("blames the key on a 403 and the network on an unreachable host", async () => {
    const denied = recordingFetch({}, 403);
    expect(
      await new GoogleProvider({ fetch: denied.fetch }).testConnection({ apiKey: "k" }),
    ).toMatchObject({ ok: false });
    expect(
      (await new GoogleProvider({ fetch: denied.fetch }).testConnection({ apiKey: "k" })).message,
    ).toContain("Authentication failed");

    const down: FetchLike = () => Promise.reject(new Error("getaddrinfo ENOTFOUND"));
    const result = await new GoogleProvider({ fetch: down }).testConnection({ apiKey: "k" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Cannot reach");
    expect(result.message).not.toContain("ENOTFOUND");
  });

  it("asks for a key before making a request at all", async () => {
    const { fetch, calls } = recordingFetch({ models: [] });
    const result = await new GoogleProvider({ fetch }).testConnection({});
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
