import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import type { VoiceRuleId, VoiceSampleId } from "@jellytind/domain";
import { VoiceStore, checkVoiceRules } from "./voice-store";

function store() {
  return new VoiceStore(new InMemoryProjectStore());
}

describe("author voice profile", () => {
  it("starts empty rather than guessing", async () => {
    const profile = await store().load();
    expect(profile.rules).toHaveLength(0);
    expect(profile.tendencies).toHaveLength(0);
    expect(profile.samples).toHaveLength(0);
  });

  it("keeps the writer's own rules exactly as written", async () => {
    const voice = store();
    const rule = await voice.addRule({
      kind: "prefer",
      category: "interiority",
      statement: "Physical observation before internal reflection.",
    });
    expect(rule.statement).toBe("Physical observation before internal reflection.");
    expect(rule.enabled).toBe(true);
    expect((await voice.load()).rules).toHaveLength(1);
  });

  it("does not treat unassessed prose as evidence of desired style", async () => {
    const voice = store();
    // Imported manuscript: nobody has said whether this is what they want.
    await voice.addSample({ stance: "unassessed", text: "He couldn't help but sigh." });
    await voice.addSample({ stance: "representative", text: "The gate was cold." });
    await voice.addSample({ stance: "rejected_ai", text: "He felt a wave of sadness." });

    const evidence = await voice.evidenceSamples();
    expect(evidence.map((s) => s.stance).sort()).toEqual(["rejected_ai", "representative"]);
  });

  it("records a model's reading as proposed, never as a preference", async () => {
    const voice = store();
    const [tendency] = await voice.addTendencies([
      {
        category: "dialogue",
        statement: "Dialogue tends to use contractions heavily.",
        evidenceSampleIds: ["VSAMPLE_0001" as VoiceSampleId],
        evidence: "27 selected representative passages.",
        modelId: "mock",
      },
    ]);
    expect(tendency?.status).toBe("proposed");

    // A proposal must not reach an operation until the writer confirms it.
    const before = await voice.forOperation({ operation: "dialogue" });
    expect(before.tendencies).toHaveLength(0);

    await voice.reviewTendency(tendency!.id, "confirmed");
    const after = await voice.forOperation({ operation: "dialogue" });
    expect(after.tendencies).toHaveLength(1);
    expect(after.tendencies[0]?.statement).toBe("Dialogue tends to use contractions heavily.");
  });

  it("lets the writer edit a reading into their own words", async () => {
    const voice = store();
    const [tendency] = await voice.addTendencies([
      {
        category: "dialogue",
        statement: "Dialogue tends to use contractions heavily.",
        evidenceSampleIds: [],
        evidence: "12 passages.",
      },
    ]);
    await voice.reviewTendency(tendency!.id, "confirmed", "Contractions everywhere except Elias.");
    const confirmed = (await voice.load()).tendencies[0];
    expect(confirmed?.statement).toBe("Contractions everywhere except Elias.");
    expect(confirmed?.reviewedAt).toBeDefined();
  });

  it("a rejected reading stays out of every operation", async () => {
    const voice = store();
    const [tendency] = await voice.addTendencies([
      {
        category: "prose",
        statement: "Sentences run long.",
        evidenceSampleIds: [],
        evidence: "3.",
      },
    ]);
    await voice.reviewTendency(tendency!.id, "rejected");
    expect((await voice.forOperation()).tendencies).toHaveLength(0);
  });

  it("retrieves only the categories an operation needs", async () => {
    const voice = store();
    await voice.addRule({
      kind: "avoid",
      category: "dialogue",
      statement: "Avoid explaining dialogue subtext.",
    });
    await voice.addRule({
      kind: "avoid",
      category: "figurative_language",
      statement: "Avoid weather as mood.",
    });

    const forDialogue = await voice.forOperation({ operation: "dialogue" });
    expect(forDialogue.rules.map((r) => r.category)).toEqual(["dialogue"]);

    const forDescription = await voice.forOperation({ operation: "description" });
    expect(forDescription.rules.map((r) => r.category)).toEqual(["figurative_language"]);

    // No operation named: the writer is inspecting, so give them everything.
    expect((await voice.forOperation()).rules).toHaveLength(2);
  });

  it("narrower scopes come last, so they read as the final word", async () => {
    const voice = store();
    await voice.addRule({
      kind: "prefer",
      category: "dialogue",
      statement: "Contractions.",
      scope: "global",
    });
    await voice.addRule({
      kind: "avoid",
      category: "dialogue",
      statement: "No contractions for Elias.",
      scope: "character",
      appliesToId: "CHAR_0001",
    });

    const forElias = await voice.forOperation({ operation: "dialogue", characterId: "CHAR_0001" });
    expect(forElias.rules.map((r) => r.scope)).toEqual(["global", "character"]);

    // Another character does not inherit Elias's exception.
    const forOther = await voice.forOperation({ operation: "dialogue", characterId: "CHAR_0002" });
    expect(forOther.rules.map((r) => r.scope)).toEqual(["global"]);
  });

  it("a disabled rule stops applying without being deleted", async () => {
    const voice = store();
    const rule = await voice.addRule({
      kind: "avoid",
      category: "prose",
      statement: "Avoid semicolons.",
    });
    await voice.setRuleEnabled(rule.id, false);
    expect((await voice.forOperation()).rules).toHaveLength(0);
    expect((await voice.load()).rules).toHaveLength(1);
  });
});

describe("checking prose against the rules", () => {
  const avoidPhrase = {
    id: "VRULE_0001" as VoiceRuleId,
    kind: "avoid" as const,
    category: "prose" as const,
    scope: "project" as const,
    statement: 'Avoid "couldn\'t help but".',
    pattern: "couldn't help but",
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  it("finds a banned phrase and shows where", () => {
    const text = "She couldn't help but smile at the letter on the table.";
    const result = checkVoiceRules(text, [avoidPhrase]);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.occurrences[0]?.excerpt).toContain("couldn't help but");
    expect(result.checked).toContain('Avoid "couldn\'t help but".');
  });

  it("says nothing when the prose is clean", () => {
    const result = checkVoiceRules("She smiled at the letter.", [avoidPhrase]);
    expect(result.hits).toHaveLength(0);
    expect(result.checked).toHaveLength(1);
  });

  it("reports rules it cannot check rather than passing them silently", () => {
    const unmechanical = {
      ...avoidPhrase,
      id: "VRULE_0002" as VoiceRuleId,
      statement: "Prefer physical observation before internal reflection.",
      pattern: undefined,
    };
    const result = checkVoiceRules("Anything at all.", [unmechanical]);
    expect(result.hits).toHaveLength(0);
    expect(result.checked).toHaveLength(0);
    // Skipped is not passed.
    expect(result.notChecked).toContain("Prefer physical observation before internal reflection.");
  });

  it("treats a pattern that will not compile as unchecked, not as clean", () => {
    const broken = { ...avoidPhrase, id: "VRULE_0003" as VoiceRuleId, pattern: "([unclosed" };
    const result = checkVoiceRules("Some prose.", [broken]);
    expect(result.checked).toHaveLength(0);
    expect(result.notChecked).toHaveLength(1);
    expect(result.hits).toHaveLength(0);
  });

  it("a prefer rule with a pattern is violated by absence, not presence", () => {
    const prefer = {
      ...avoidPhrase,
      id: "VRULE_0004" as VoiceRuleId,
      kind: "prefer" as const,
      statement: "Prefer em dashes for interruption.",
      pattern: "—",
    };
    expect(checkVoiceRules("She said — and stopped.", [prefer]).hits).toHaveLength(0);
    expect(checkVoiceRules("She said, and stopped.", [prefer]).hits).toHaveLength(1);
  });
});
