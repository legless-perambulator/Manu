import { describe, expect, it } from "vitest";
import { LexicalIndex } from "./lexical-index";
import { tokenize, parseQuery } from "./tokenizer";
import type { SearchDocument } from "./types";

const doc = (id: string, text: string, kind = "prose"): SearchDocument => ({
  id,
  text,
  meta: { kind: kind as SearchDocument["meta"]["kind"], title: id, path: id },
});

describe("tokenizer", () => {
  it("lowercases and strips punctuation / special characters", () => {
    expect(tokenize("Brass-Key, O'Brien! (café)")).toEqual(["brass", "key", "o", "brien", "café"]);
  });

  it("parses terms and quoted phrases", () => {
    const p = parseQuery('mara "brass key"');
    expect(p.terms).toEqual(["mara"]);
    expect(p.phrases).toEqual(["brass key"]);
  });
});

describe("LexicalIndex", () => {
  it("finds documents containing a term", () => {
    const idx = new LexicalIndex();
    idx.upsert(doc("a", "Elias entered the library."));
    idx.upsert(doc("b", "Mara waited outside."));
    const hits = idx.search({ text: "mara" });
    expect(hits.map((h) => h.id)).toEqual(["b"]);
    expect(hits[0]?.excerpt).toContain("Mara");
  });

  it("requires all bare terms (AND)", () => {
    const idx = new LexicalIndex();
    idx.upsert(doc("a", "the brass key opened the door"));
    idx.upsert(doc("b", "a brass candlestick"));
    idx.upsert(doc("c", "the iron key"));
    expect(idx.search({ text: "brass key" }).map((h) => h.id)).toEqual(["a"]);
  });

  it("matches quoted phrases as adjacent tokens", () => {
    const idx = new LexicalIndex();
    idx.upsert(doc("a", "she found the brass key on the table"));
    idx.upsert(doc("b", "the key was brass, old and heavy")); // tokens present, not adjacent
    const hits = idx.search({ text: '"brass key"' });
    expect(hits.map((h) => h.id)).toEqual(["a"]);
  });

  it("ranks by term frequency", () => {
    const idx = new LexicalIndex();
    idx.upsert(doc("a", "vault vault vault"));
    idx.upsert(doc("b", "vault once"));
    expect(idx.search({ text: "vault" }).map((h) => h.id)).toEqual(["a", "b"]);
  });

  it("filters by result kind", () => {
    const idx = new LexicalIndex();
    idx.upsert(doc("a", "Mara the spy", "character"));
    idx.upsert(doc("b", "Mara walked in", "prose"));
    const hits = idx.search({ text: "mara", filters: { kinds: ["character"] } });
    expect(hits.map((h) => h.id)).toEqual(["a"]);
  });

  it("updates incrementally on upsert and remove", () => {
    const idx = new LexicalIndex();
    idx.upsert(doc("a", "the vault exists"));
    expect(idx.search({ text: "vault" })).toHaveLength(1);

    // Re-upsert with new text: old term no longer matches.
    idx.upsert(doc("a", "the cellar is empty"));
    expect(idx.search({ text: "vault" })).toHaveLength(0);
    expect(idx.search({ text: "cellar" })).toHaveLength(1);

    idx.remove("a");
    expect(idx.search({ text: "cellar" })).toHaveLength(0);
    expect(idx.size()).toBe(0);
  });

  it("returns nothing for an empty query", () => {
    const idx = new LexicalIndex();
    idx.upsert(doc("a", "text"));
    expect(idx.search({ text: "   " })).toEqual([]);
  });

  it("handles large amounts of prose quickly and accurately", () => {
    const idx = new LexicalIndex();
    const filler = "the manor stood silent under a grey sky ".repeat(500); // ~4k words/doc
    for (let i = 0; i < 200; i++) {
      const text = i === 137 ? `${filler} the brass key glinted once` : filler;
      idx.upsert(doc(`ch${i}`, text));
    }
    const start = Date.now();
    const hits = idx.search({ text: '"brass key"' });
    expect(hits.map((h) => h.id)).toEqual(["ch137"]);
    expect(Date.now() - start).toBeLessThan(500);
  });
});
