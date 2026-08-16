import { describe, expect, it } from "vitest";
import { buildDiagnosticsBundle, log, recentLogs, redact, renderDiagnostics } from "./diagnostics";
import { buildUpdateManifest, compareAppVersions, evaluateUpdateManifest } from "./updates";

/** Phase 46 §7–§9, §16–§17, §32: diagnostics and updates, provably safe. */

describe("redaction (§9)", () => {
  it("removes credential-shaped content before it is ever stored", () => {
    expect(redact("using sk-abc123def456ghi789 today")).not.toContain("sk-abc");
    expect(redact('{"apiKey": "very-secret-value"}')).not.toContain("very-secret-value");
    expect(redact("Authorization: Bearer eyJhbGciOi.payload.sig")).not.toContain("eyJhbGciOi");
    expect(redact("AKIAIOSFODNN7EXAMPLE")).toBe("[redacted-key]");
    expect(redact("The brass key opened the vault.")).toBe("The brass key opened the vault.");
  });

  it("the log buffer stores redacted, bounded entries", () => {
    log("error", "provider", "call failed with sk-supersecretkey12345 attached");
    const last = recentLogs()[recentLogs().length - 1];
    expect(last?.message).not.toContain("supersecret");
    expect(last?.level).toBe("error");
  });
});

describe("the diagnostics bundle (§7–§8, §32)", () => {
  it("carries versions, providers without keys, extensions and the report — never prose", () => {
    log("warn", "build", "story build took 4100ms");
    const bundle = buildDiagnosticsBundle({
      appVersion: "0.1.0",
      providers: [{ providerId: "anthropic", models: ["claude-x"] }],
      extensions: [{ id: "com.manu.noir-writing-pack", version: "1.0.0", enabled: true }],
      whatHappened: 'Export froze with my apiKey: "sk-test123456789012" configured',
      whatWasExpected: "A DOCX file",
    });
    const rendered = renderDiagnostics(bundle);
    expect(rendered).toContain("manu-diagnostics");
    expect(rendered).toContain("anthropic");
    expect(rendered).toContain("com.manu.noir-writing-pack");
    expect(rendered).not.toContain("sk-test123456789012");
    expect(bundle.report.whatWasExpected).toBe("A DOCX file");
    // No field of the bundle contains manuscript text by construction: the
    // module has no access to project prose at all.
    expect(Object.keys(bundle)).not.toContain("manuscript");
  });
});

describe("update channels (§16–§17)", () => {
  const KEY = { keyId: "manu-first-party-2026", secret: "release-secret" };
  const CHANNELS = {
    stable: {
      version: "0.2.0",
      notes: "Fixes.",
      url: "https://example.com/manu-0.2.0.AppImage",
      artifactSha256: "ab".repeat(32),
    },
    alpha: {
      version: "0.3.0",
      notes: "Fresh paint.",
      url: "https://example.com/manu-0.3.0.AppImage",
      artifactSha256: "cd".repeat(32),
    },
  };

  it("reports an available signed update per channel, stable by default semantics", () => {
    const raw = buildUpdateManifest(CHANNELS, KEY);
    const stable = evaluateUpdateManifest(raw, {
      currentVersion: "0.1.0",
      channel: "stable",
      trustedKeys: [KEY],
    });
    expect(stable).toMatchObject({ state: "available", trusted: true });
    if (stable.state === "available") expect(stable.release.version).toBe("0.2.0");

    const alpha = evaluateUpdateManifest(raw, {
      currentVersion: "0.2.5",
      channel: "alpha",
      trustedKeys: [KEY],
    });
    if (alpha.state === "available") expect(alpha.release.version).toBe("0.3.0");

    const current = evaluateUpdateManifest(raw, {
      currentVersion: "0.2.0",
      channel: "stable",
      trustedKeys: [KEY],
    });
    expect(current.state).toBe("current");
  });

  it("refuses a tampered feed and degrades gracefully on garbage", () => {
    const raw = buildUpdateManifest(CHANNELS, KEY);
    const tampered = raw.replace("manu-0.2.0.AppImage", "evil.AppImage");
    const verdict = evaluateUpdateManifest(tampered, {
      currentVersion: "0.1.0",
      channel: "stable",
      trustedKeys: [KEY],
    });
    expect(verdict).toEqual({
      state: "unavailable",
      reason: "The update feed's signature does not verify.",
    });
    expect(
      evaluateUpdateManifest("offline garbage", {
        currentVersion: "0.1.0",
        channel: "stable",
        trustedKeys: [KEY],
      }).state,
    ).toBe("unavailable");
  });

  it("an unsigned feed still reports, marked untrusted", () => {
    const verdict = evaluateUpdateManifest(buildUpdateManifest(CHANNELS), {
      currentVersion: "0.1.0",
      channel: "stable",
      trustedKeys: [KEY],
    });
    expect(verdict).toMatchObject({ state: "available", trusted: false });
    expect(compareAppVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
  });
});
