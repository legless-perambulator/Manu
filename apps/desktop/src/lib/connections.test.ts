import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MODEL_PURPOSES,
  choiceFor,
  loadAiSettings,
  newConnectionId,
  saveAiSettings,
  secretKeyForConnection,
  type AiSettings,
  type ProviderConnection,
} from "./connections";

/** A `localStorage` good enough to test against, with no browser involved. */
class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: storage };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const connection = (id: string, providerId = id): ProviderConnection => ({
  id,
  providerId,
  label: id,
});

describe("AI settings persistence", () => {
  it("starts empty, and round-trips what was saved", () => {
    expect(loadAiSettings()).toEqual({ connections: [], purposes: {} });

    const settings: AiSettings = {
      connections: [{ ...connection("ollama"), baseUrl: "http://192.168.1.50:11434" }],
      purposes: { default: { connectionId: "ollama", modelId: "llama3" } },
    };
    saveAiSettings(settings);
    expect(loadAiSettings()).toEqual(settings);
  });

  it("survives a corrupt or half-written settings blob", () => {
    // Losing a model preference is a nuisance. Failing to start is not
    // acceptable, and nothing in a project depends on this file.
    storage.setItem("manu.ai-settings", "{not json");
    expect(loadAiSettings()).toEqual({ connections: [], purposes: {} });

    storage.setItem("manu.ai-settings", JSON.stringify({ connections: "nope" }));
    expect(loadAiSettings().connections).toEqual([]);
  });

  it("never writes an API key into the settings record", () => {
    // The connection record is the *shape* of a connection; the secret lives in
    // the OS credential store (AGENTS.md — "Secrets").
    saveAiSettings({ connections: [connection("anthropic")], purposes: {} });
    const raw = storage.getItem("manu.ai-settings") ?? "";
    expect(raw).not.toContain("apiKey");
    expect(raw).not.toContain("sk-");
  });
});

describe("legacy settings migration (MANU-016)", () => {
  it("keeps an existing Anthropic setup working without re-entering the key", () => {
    storage.setItem(
      "jellytind.model-settings",
      JSON.stringify({ provider: "anthropic", modelId: "claude-opus-5" }),
    );

    const migrated = loadAiSettings();
    const first = migrated.connections[0];
    expect(first).toBeDefined();
    expect(first?.providerId).toBe("anthropic");
    // The connection id must equal the old provider name, because the stored
    // secret's key is derived from it. Change this and the key is orphaned.
    expect(secretKeyForConnection(first?.id ?? "")).toBe("provider:anthropic:apiKey");
    expect(migrated.purposes.default).toEqual({
      connectionId: "anthropic",
      modelId: "claude-opus-5",
    });
  });

  it("writes the migration through, so it happens exactly once", () => {
    storage.setItem("jellytind.model-settings", JSON.stringify({ provider: "anthropic" }));
    loadAiSettings();
    expect(storage.getItem("manu.ai-settings")).not.toBeNull();

    // The new record now wins even if the old one is still lying around.
    storage.setItem("jellytind.model-settings", JSON.stringify({ provider: "openai" }));
    expect(loadAiSettings().connections[0]?.providerId).toBe("anthropic");
  });

  it("ignores a legacy record with nothing usable in it", () => {
    storage.setItem("jellytind.model-settings", JSON.stringify({ provider: "" }));
    expect(loadAiSettings().connections).toEqual([]);
  });
});

describe("purpose resolution", () => {
  const settings: AiSettings = {
    connections: [connection("a"), connection("b")],
    purposes: {
      default: { connectionId: "a", modelId: "big" },
      utility: { connectionId: "b", modelId: "small" },
    },
  };

  it("uses the model set for a purpose", () => {
    expect(choiceFor(settings, "utility")).toEqual({ connectionId: "b", modelId: "small" });
  });

  it("falls back to the default for anything unset", () => {
    // Configuring one model is configuring all of it.
    for (const purpose of MODEL_PURPOSES) {
      if (purpose === "utility") continue;
      expect(choiceFor(settings, purpose)).toEqual({ connectionId: "a", modelId: "big" });
    }
  });

  it("returns nothing when nothing at all is configured", () => {
    expect(choiceFor({ connections: [], purposes: {} }, "default")).toBeNull();
  });
});

describe("connection ids", () => {
  it("uses the provider name for the first connection to it", () => {
    expect(newConnectionId("ollama", [])).toBe("ollama");
  });

  it("does not collide when somebody runs two of the same thing", () => {
    // A laptop and a GPU box are both Ollama; the audit found a single global
    // provider choice that could not express that.
    const existing = [connection("ollama"), connection("ollama-2")];
    expect(newConnectionId("ollama", existing)).toBe("ollama-3");
  });

  it("never produces an id containing the purpose separator", () => {
    expect(newConnectionId("ollama", [])).not.toContain("|");
  });
});
