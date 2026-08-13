import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { CharacterVoiceStore } from "./character-voice-store";
import {
  checkCharacterVoice,
  compareVoices,
  measureDialogue,
  representativeLines,
} from "./character-voice";

/** Clipped, formal, never contracts. */
const ELIAS = [
  "No.",
  "I do not know where he was.",
  "That is not what I said.",
  "Ask the solicitor.",
  "It does not matter now.",
  "I was in the study.",
];

/** Circling, hedging, contracts constantly, trails off. */
const MARA = [
  "Well — I mean, it's complicated, isn't it, when you think about what he wanted…",
  "You know I can't say that, not really, not without the papers in front of me.",
  "I'd have told you, wouldn't I, if I'd known? I'd like to think I would.",
  "It's just… look, there's a version of this where nobody gets hurt, and I'd rather we found it.",
  "Maybe. Maybe not. I don't know that I'm the one to ask, honestly.",
  "Oh, don't — don't do that, don't look at me like that…",
];

function store() {
  return new CharacterVoiceStore(new InMemoryProjectStore());
}

describe("measuring recorded dialogue", () => {
  it("measures the sample, and says how big the sample was", () => {
    const m = measureDialogue(ELIAS);
    expect(m.utterances).toBe(6);
    expect(m.words).toBeGreaterThan(0);
    expect(m.meanLength).toBeGreaterThan(0);
  });

  it("reports what it could not measure instead of returning zero", () => {
    const m = measureDialogue(ELIAS);
    // No profanity or filler terms were named for this project, so those are
    // not measured — not "none found".
    expect(m.profanityRate).toBeNull();
    expect(m.fillerRate).toBeNull();
    expect(m.notMeasured.join(" ")).toMatch(/profanity/);
    expect(m.notMeasured.join(" ")).toMatch(/filler/);
  });

  it("measures profanity and fillers only against terms the writer named", () => {
    const m = measureDialogue(["Well, I mean, blast it.", "Blast."], {
      fillerTerms: ["well", "I mean"],
      profanityTerms: ["blast"],
    });
    expect(m.fillerRate).toBeGreaterThan(0);
    expect(m.profanityRate).toBeGreaterThan(0);
    expect(m.notMeasured).toHaveLength(0);
  });

  it("counts contractions and hesitation breaks", () => {
    const elias = measureDialogue(ELIAS);
    const mara = measureDialogue(MARA);
    expect(mara.contractionRate).toBeGreaterThan(elias.contractionRate);
    expect(mara.breakRate).toBeGreaterThan(elias.breakRate);
    expect(elias.meanLength).toBeLessThan(mara.meanLength);
  });
});

describe("telling two voices apart", () => {
  const profile = (characterId: string) => ({
    characterId,
    attributes: {},
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  it("distinguishes Elias from Mara from recorded dialogue alone", () => {
    const result = compareVoices(
      { profile: profile("CHAR_ELIAS"), lines: ELIAS },
      { profile: profile("CHAR_MARA"), lines: MARA },
    );
    expect(result.band).toBe("low");
    expect(result.differences.length).toBeGreaterThan(0);
    expect(result.differences.join(" ")).toMatch(/utterance length|contraction/);
  });

  it("finds two similar voices similar", () => {
    const result = compareVoices(
      { profile: profile("CHAR_A"), lines: ELIAS },
      { profile: profile("CHAR_B"), lines: [...ELIAS] },
    );
    expect(result.band).toBe("high");
    expect(result.sharedTendencies.length).toBeGreaterThan(0);
  });

  it("never reports a percentage, and always carries the caveat", () => {
    const result = compareVoices(
      { profile: profile("CHAR_ELIAS"), lines: ELIAS },
      { profile: profile("CHAR_MARA"), lines: MARA },
    );
    expect(result.caveat).toMatch(/heuristic/i);
    expect(result.caveat).toMatch(/not a measurement of the characters/i);
    expect(JSON.stringify(result)).not.toMatch(/\d+%/);
    expect(result.basis).toMatch(/6 recorded line/);
  });

  it("warns when there is barely any dialogue to judge on", () => {
    const result = compareVoices(
      { profile: profile("CHAR_A"), lines: ["Yes."] },
      { profile: profile("CHAR_B"), lines: ["No."] },
    );
    expect(result.caveat).toMatch(/very few lines/i);
  });

  it("reports shared descriptions the writer wrote, not just the numbers", () => {
    const a = {
      ...profile("CHAR_A"),
      attributes: { directness: { value: "blunt" }, humour: { value: "dry" } },
    };
    const b = {
      ...profile("CHAR_B"),
      attributes: { directness: { value: "Blunt" }, humour: { value: "none" } },
    };
    const result = compareVoices({ profile: a, lines: ELIAS }, { profile: b, lines: ELIAS });
    expect(result.sharedTendencies.join(" ")).toMatch(/both described as "blunt"/i);
    expect(result.sharedTendencies.join(" ")).not.toMatch(/dry/);
  });
});

describe("voice check", () => {
  const elias = {
    characterId: "CHAR_ELIAS",
    attributes: { contractions: { value: "never" } },
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("flags a passage that departs from the recorded lines", () => {
    const check = checkCharacterVoice(
      elias,
      ELIAS,
      ["Well, I mean, I'd have told you, wouldn't I, if I'd had the faintest idea…"],
      elias.attributes,
    );
    expect(check.findings.length).toBeGreaterThan(0);
    expect(check.basis).toMatch(/6 recorded line/);
  });

  it("says nothing when the passage matches", () => {
    const check = checkCharacterVoice(
      elias,
      ELIAS,
      ["I do not know where he was.", "That is not what I said.", "Ask the solicitor."],
      elias.attributes,
    );
    expect(check.findings).toHaveLength(0);
  });

  it("refuses to judge a passage too short to support the statistics", () => {
    const check = checkCharacterVoice(elias, ELIAS, ["I do not know."], elias.attributes);
    expect(check.findings).toHaveLength(0);
    expect(check.notMeasured.join(" ")).toMatch(/too short to compare/);
  });

  it("admits when there is nothing to compare against", () => {
    const check = checkCharacterVoice(elias, [], ["Anything."], elias.attributes);
    expect(check.findings).toHaveLength(0);
    expect(check.basis).toMatch(/No dialogue recorded/i);
  });
});

describe("the stored profile", () => {
  it("does not force a writer to fill in every field", async () => {
    const voices = store();
    const profile = await voices.setProfile("CHAR_ELIAS", {
      attributes: { directness: { value: "blunt to the point of rudeness" } },
    });
    expect(Object.keys(profile.attributes)).toEqual(["directness"]);
    // An unfilled attribute is absent, not defaulted to something nobody chose.
    expect(profile.attributes.humour).toBeUndefined();
  });

  it("merges patches so a profile can be filled in over time", async () => {
    const voices = store();
    await voices.setProfile("CHAR_ELIAS", { attributes: { directness: { value: "blunt" } } });
    await voices.setProfile("CHAR_ELIAS", { attributes: { humour: { value: "none" } } });
    const profile = await voices.getProfile("CHAR_ELIAS");
    expect(profile?.attributes.directness?.value).toBe("blunt");
    expect(profile?.attributes.humour?.value).toBe("none");
  });

  it("keeps an example's source location", async () => {
    const voices = store();
    const example = await voices.addExample({
      characterId: "CHAR_ELIAS",
      text: "That is not what I said.",
      sceneId: "SCENE_0012",
      chapterId: "CHAPTER_0004",
      filePath: "manuscript/CHAPTER_0004.md",
    });
    expect(example.sceneId).toBe("SCENE_0012");
    expect(example.filePath).toBe("manuscript/CHAPTER_0004.md");
    expect(await voices.listExamples("CHAR_ELIAS")).toHaveLength(1);
    expect(await voices.listExamples("CHAR_MARA")).toHaveLength(0);
  });

  it("keeps counter-examples out of the representative set", async () => {
    const voices = store();
    await voices.addExample({ characterId: "CHAR_ELIAS", text: "Good." });
    await voices.addExample({
      characterId: "CHAR_ELIAS",
      text: "Well, I mean, I couldn't say…",
      representative: false,
      note: "Wrong — this is Mara's rhythm, not his.",
    });
    const lines = representativeLines(await voices.listExamples("CHAR_ELIAS"));
    expect(lines).toEqual(["Good."]);
  });
});

describe("voice that changes over the book", () => {
  const order = ["SCENE_0001", "SCENE_0002", "SCENE_0003", "SCENE_0004"];

  it("applies only the shifts that have happened by a given scene", async () => {
    const voices = store();
    await voices.setProfile("CHAR_ELIAS", {
      attributes: { emotional_openness: { value: "closed" }, directness: { value: "blunt" } },
    });
    await voices.addShift({
      characterId: "CHAR_ELIAS",
      fromSceneId: "SCENE_0003",
      description: "After the fire, he starts saying what he means.",
      attributes: { emotional_openness: { value: "raw, unguarded" } },
    });

    const early = await voices.voiceAtScene("CHAR_ELIAS", order, "SCENE_0002");
    expect(early.attributes.emotional_openness?.value).toBe("closed");
    expect(early.applied).toHaveLength(0);

    const late = await voices.voiceAtScene("CHAR_ELIAS", order, "SCENE_0004");
    expect(late.attributes.emotional_openness?.value).toBe("raw, unguarded");
    // Attributes the shift did not mention carry forward untouched.
    expect(late.attributes.directness?.value).toBe("blunt");
    expect(late.applied).toHaveLength(1);
  });

  it("a shift takes effect in the scene it is anchored to", async () => {
    const voices = store();
    await voices.setProfile("CHAR_ELIAS", { attributes: { formality: { value: "formal" } } });
    await voices.addShift({
      characterId: "CHAR_ELIAS",
      fromSceneId: "SCENE_0002",
      description: "Drops the formality with Mara.",
      attributes: { formality: { value: "informal" } },
    });
    expect(
      (await voices.voiceAtScene("CHAR_ELIAS", order, "SCENE_0002")).attributes.formality?.value,
    ).toBe("informal");
  });

  it("returns nothing rather than inventing a profile for an unrecorded character", async () => {
    const result = await store().voiceAtScene("CHAR_NOBODY", order);
    expect(result.profile).toBeNull();
    expect(result.attributes).toEqual({});
  });
});
