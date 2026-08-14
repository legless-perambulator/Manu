import { describe, expect, it } from "vitest";
import { splitFrontMatter, titleOf } from "./Editor";

/**
 * The two pure functions behind the manuscript view.
 *
 * A chapter file carries a YAML block so the record and the words stay in one
 * portable document — the thing that makes "plain files you own" true. The
 * writer should never see it, and it must survive being hidden byte for byte,
 * because the head is what the repository reads the chapter back from.
 */

const HEAD = "---\nid: CHAPTER_0001\ntitle: The Cellar Door\n---\n\n";
const BODY = "The cellar door had been painted shut.\n";

describe("splitFrontMatter", () => {
  it("separates the block from the prose, losing nothing", () => {
    const split = splitFrontMatter(HEAD + BODY);
    expect(split.head).toBe(HEAD);
    expect(split.body).toBe(BODY);
    // The round trip is the whole safety property.
    expect(split.head + split.body).toBe(HEAD + BODY);
  });

  it("treats a file with no front matter as all prose", () => {
    expect(splitFrontMatter(BODY)).toEqual({ head: "", body: BODY });
  });

  it("refuses to guess at a malformed block", () => {
    // An unterminated fence is not front matter, and hiding an arbitrary
    // prefix of somebody's chapter would be worse than showing three dashes.
    const broken = "---\nid: CHAPTER_0001\nthe door was painted shut";
    expect(splitFrontMatter(broken)).toEqual({ head: "", body: broken });
  });

  it("handles a block with no blank line after it", () => {
    const tight = "---\nid: X\n---\nStraight into the prose.\n";
    const split = splitFrontMatter(tight);
    expect(split.head).toBe("---\nid: X\n---\n");
    expect(split.body).toBe("Straight into the prose.\n");
  });

  it("leaves an empty file alone", () => {
    expect(splitFrontMatter("")).toEqual({ head: "", body: "" });
  });

  it("keeps offsets addressable: head length is the shift a selection needs", () => {
    // The editor hides the head but an AI edit addresses the *file*. If this
    // shift were wrong, a rewrite would replace the wrong characters.
    const full = HEAD + BODY;
    const { head, body } = splitFrontMatter(full);
    const start = body.indexOf("painted");
    expect(full.slice(start + head.length, start + head.length + 7)).toBe("painted");
  });
});

describe("titleOf", () => {
  it("reads the writer's title out of the block", () => {
    expect(titleOf(HEAD)).toBe("The Cellar Door");
  });

  it("strips quotes a YAML writer may have added", () => {
    expect(titleOf('---\ntitle: "The Cellar Door"\n---\n')).toBe("The Cellar Door");
  });

  it("returns nothing when there is no title to read", () => {
    expect(titleOf("---\nid: CHAPTER_0001\n---\n")).toBeNull();
    expect(titleOf("---\ntitle:   \n---\n")).toBeNull();
    expect(titleOf("")).toBeNull();
  });
});
