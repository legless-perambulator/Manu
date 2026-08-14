import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline, plainTextOf, type BlockNode } from "./markdown-render";

const kinds = (blocks: readonly BlockNode[]) => blocks.map((block) => block.kind);

describe("reading a chapter as a formatted page", () => {
  it("separates the blocks a novel is made of", () => {
    const chapter = [
      "# The Cellar Door",
      "",
      "Mara remembered it differently.",
      "It had been painted, once.",
      "",
      "* * *",
      "",
      "> She would not go down there again.",
      "",
      "- a key",
      "- a candle",
    ].join("\n");

    expect(kinds(parseBlocks(chapter))).toEqual([
      "heading",
      "paragraph",
      "scene-break",
      "quote",
      "list",
    ]);
  });

  it("joins the lines of one paragraph and keeps paragraphs apart", () => {
    const blocks = parseBlocks("One line.\nSame paragraph.\n\nA new one.");
    expect(blocks).toHaveLength(2);
    const first = blocks[0];
    expect(first?.kind === "paragraph" ? plainTextOf(first.children) : "").toBe(
      "One line. Same paragraph.",
    );
  });

  it("numbers an ordered list and marks an unordered one", () => {
    const ordered = parseBlocks("1. first\n2. second")[0];
    expect(ordered?.kind === "list" ? ordered.ordered : null).toBe(true);
    const bullets = parseBlocks("- first\n- second")[0];
    expect(bullets?.kind === "list" ? bullets.items.length : 0).toBe(2);
  });

  it("accepts the several shapes a scene break arrives in", () => {
    for (const line of ["* * *", "***", "---", "###"]) {
      expect(kinds(parseBlocks(line))).toEqual(["scene-break"]);
    }
  });

  it("closes a heading at the end of its line", () => {
    const blocks = parseBlocks("## Later\nProse follows.");
    expect(kinds(blocks)).toEqual(["heading", "paragraph"]);
  });
});

describe("inline marks", () => {
  it("reads bold, italic, strikethrough and code", () => {
    const nodes = parseInline("**bold** and _italic_ and ~~gone~~ and `code`");
    expect(nodes.map((node) => node.kind)).toEqual([
      "strong",
      "text",
      "emphasis",
      "text",
      "strike",
      "text",
      "code",
    ]);
  });

  it("nests marks", () => {
    const nodes = parseInline("**bold with _italic_ inside**");
    const strong = nodes[0];
    expect(strong?.kind).toBe("strong");
    expect(strong?.kind === "strong" ? plainTextOf(strong.children) : "").toBe(
      "bold with italic inside",
    );
  });

  it("leaves an unmatched marker as text", () => {
    // A writer types ** and is interrupted. The rest of the chapter must not
    // turn bold.
    expect(plainTextOf(parseInline("half **open"))).toBe("half **open");
    expect(parseInline("half **open").every((node) => node.kind === "text")).toBe(true);
  });

  it("does not pair a closing marker that follows a space", () => {
    expect(plainTextOf(parseInline("a _b _c"))).toBe("a _b _c");
  });

  it("never reads ** as two italic markers", () => {
    const nodes = parseInline("**word**");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.kind).toBe("strong");
  });
});

/**
 * The renderer produces data, never markup.
 *
 * A manuscript is untrusted text: it is whatever the writer or a model put
 * there. This is the assertion that keeps it from becoming a rendering hole.
 */
describe("a manuscript cannot inject anything", () => {
  it("carries angle brackets through as characters", () => {
    const blocks = parseBlocks("<script>alert(1)</script>");
    const paragraph = blocks[0];
    expect(paragraph?.kind).toBe("paragraph");
    expect(paragraph?.kind === "paragraph" ? plainTextOf(paragraph.children) : "").toBe(
      "<script>alert(1)</script>",
    );
  });

  it("has no node kind that carries markup", () => {
    const every = parseBlocks("# h\n\ntext\n\n> q\n\n- l\n\n* * *");
    for (const block of every) {
      expect(["heading", "paragraph", "quote", "list", "scene-break"]).toContain(block.kind);
    }
  });
});
