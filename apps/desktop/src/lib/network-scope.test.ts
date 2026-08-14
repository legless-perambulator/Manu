import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "@jellytind/provider-anthropic";
import { GoogleProvider } from "@jellytind/provider-google";
import {
  ollamaProvider,
  openAiCompatibleProvider,
  openAiProvider,
  openRouterProvider,
} from "@jellytind/provider-openai-compatible";
import type { ProviderDescriptor } from "@jellytind/model-router";
import { REMOTE_MODEL_PORTS, outOfScopeReason } from "./network-scope";

describe("outOfScopeReason", () => {
  it("allows the hosted providers this build ships adapters for", () => {
    for (const url of [
      "https://api.anthropic.com",
      "https://api.openai.com/v1",
      "https://generativelanguage.googleapis.com/v1beta",
      "https://openrouter.ai/api/v1",
    ]) {
      expect(outOfScopeReason(url)).toBeNull();
    }
  });

  it("allows a local server on any port", () => {
    expect(outOfScopeReason("http://localhost:11434")).toBeNull();
    expect(outOfScopeReason("http://127.0.0.1:8080/v1")).toBeNull();
    expect(outOfScopeReason("http://localhost:1234/v1")).toBeNull();
  });

  it("allows a model server elsewhere on the network", () => {
    // "Do not assume Ollama must be running on the same machine": a GPU box is
    // the normal case for anybody serious about local models.
    expect(outOfScopeReason("http://192.168.1.50:11434")).toBeNull();
    expect(outOfScopeReason("http://gpu.local:1234/v1")).toBeNull();
  });

  it("explains, before the request, what the packaged build cannot reach", () => {
    const reason = outOfScopeReason("http://10.0.0.4:8080/v1");
    expect(reason).not.toBeNull();
    expect(reason).toContain("10.0.0.4");
    expect(reason).toContain("8080");
    // It must read as a deliberate choice, not as a bug.
    expect(reason).toContain("deliberate");
  });

  it("refuses a scheme that is not http", () => {
    expect(outOfScopeReason("file:///etc/passwd")).toContain("http");
  });

  it("says nothing about an address it cannot parse", () => {
    // Malformed input is the adapter's to report; two opinions would disagree.
    expect(outOfScopeReason("not a url")).toBeNull();
    expect(outOfScopeReason("")).toBeNull();
  });
});

// ── The mirror must not drift from the host ─────────────────────────────────

interface Capability {
  permissions: (string | { identifier: string; allow?: { url: string }[] })[];
}

function allowedUrls(): string[] {
  const path = fileURLToPath(new URL("../../src-tauri/capabilities/default.json", import.meta.url));
  const capability = JSON.parse(readFileSync(path, "utf8")) as Capability;
  const http = capability.permissions.find(
    (entry) => typeof entry === "object" && entry.identifier === "http:default",
  );
  if (typeof http !== "object") throw new Error("no http capability in default.json");
  return (http.allow ?? []).map((entry) => entry.url);
}

/**
 * A deliberately small stand-in for the host's URL-pattern matcher, covering
 * exactly the pattern shapes the capability file uses: `scheme://host:port/*`
 * with `*` permitted for host or port.
 */
function matches(pattern: string, target: string): boolean {
  const [, scheme = "", host = "", port = ""] =
    /^(https?):\/\/([^/:]+)(?::([^/]+))?\/\*$/.exec(pattern) ?? [];
  if (scheme === "") return false;
  const url = new URL(target);
  if (`${scheme}:` !== url.protocol) return false;
  if (host !== "*" && host !== url.hostname) return false;
  const actualPort = url.port === "" ? (url.protocol === "https:" ? "443" : "80") : url.port;
  return port === "*" || port === "" || port === actualPort;
}

const descriptors: ProviderDescriptor[] = [
  new AnthropicProvider().describe(),
  openAiProvider().describe(),
  new GoogleProvider().describe(),
  openRouterProvider().describe(),
  ollamaProvider().describe(),
  openAiCompatibleProvider().describe(),
];

describe("packaged network capability", () => {
  it("permits every shipped provider's default address", () => {
    // The audit's second half of MANU-005: an adapter that is correct in source
    // still fails after packaging if the host's allowlist does not name it.
    const allowed = allowedUrls();
    for (const descriptor of descriptors) {
      const base = descriptor.defaultBaseUrl;
      expect(base, `${descriptor.id} has no default base URL`).toBeDefined();
      expect(
        allowed.some((pattern) => matches(pattern, base as string)),
        `${descriptor.id} (${String(base)}) is not permitted by capabilities/default.json`,
      ).toBe(true);
    }
  });

  it("keeps the in-app explanation agreeing with the host", () => {
    for (const descriptor of descriptors) {
      expect(outOfScopeReason(descriptor.defaultBaseUrl as string)).toBeNull();
    }
  });

  it("grants no blanket outbound access", () => {
    // "Do not unnecessarily grant dangerous unrelated capabilities." A host
    // wildcard is only acceptable when it is pinned to a model-server port.
    for (const pattern of allowedUrls()) {
      const [, host = "", port = ""] = /^https?:\/\/([^/:]+)(?::([^/]+))?\/\*$/.exec(pattern) ?? [];
      if (host !== "*") continue;
      expect(
        REMOTE_MODEL_PORTS.map(String),
        `${pattern} opens every host on port ${port}`,
      ).toContain(port);
    }
  });
});
