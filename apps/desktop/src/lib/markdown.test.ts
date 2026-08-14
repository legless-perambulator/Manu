import { describe, expect, it } from "vitest";
import {
  SCENE_BREAK,
  countCharacters,
  countWords,
  findMatches,
  insertSceneBreak,
  lineRange,
  nextMatch,
  outlineOf,
  previousMatch,
  replaceAll,
  replaceMatch,
  setBlockStyle,
  toggleInline,
} from "./markdown";

/** Apply an edit the way the editor does, so the assertions read as prose. */
const at = (text: string, needle: string) => text.indexOf(needle);

describe("inline formatting is a toggle in both directions", () => {
  it("wraps a selection and keeps it selected", () => {
    const text = "Mara remembered the cellar door.";
    const start = at(text, "cellar door");
    const result = toggleInline(text, start, start + "cellar door".length, "bold");
    expect(result.text).toBe("Mara remembered the **cellar door**.");
    expect(result.text.slice(result.start, result.end)).toBe("cellar door");
  });

  it("removes markers that sit inside the selection", () => {
    const text = "Mara remembered the **cellar door**.";
    const start = at(text, "**cellar");
    const result = toggleInline(text, start, start + "**cellar door**".length, "bold");
    expect(result.text).toBe("Mara remembered the cellar door.");
    expect(result.text.slice(result.start, result.end)).toBe("cellar door");
  });

  it("removes markers that sit just outside the selection", () => {
    // The case a writer actually produces: double-click the word, press ⌘B
    // again. Without this, Manu would write ****cellar door****.
    const text = "Mara remembered the **cellar door**.";
    const start = at(text, "cellar door");
    const result = toggleInline(text, start, start + "cellar door".length, "bold");
    expect(result.text).toBe("Mara remembered the cellar door.");
  });

  it("drops an empty pair and puts the caret between the markers", () => {
    const result = toggleInline("She said ", 9, 9, "italic");
    expect(result.text).toBe("She said __");
    expect(result.start).toBe(10);
    expect(result.end).toBe(10);
  });

  it("ignores whitespace at the edges of a selection", () => {
    const text = "one two three";
    // A drag-selection usually catches the trailing space.
    const result = toggleInline(text, 3, 8, "italic");
    expect(result.text).toBe("one _two_ three");
  });

  it("offers italic and strikethrough on the same terms", () => {
    expect(toggleInline("word", 0, 4, "italic").text).toBe("_word_");
    expect(toggleInline("word", 0, 4, "strikethrough").text).toBe("~~word~~");
    expect(toggleInline("~~word~~", 0, 8, "strikethrough").text).toBe("word");
  });
});

describe("paragraph styles replace each other and never stack", () => {
  const chapter = "The cellar door\nMara remembered it differently.";

  it("makes a heading of the line the caret is on", () => {
    const result = setBlockStyle(chapter, 2, 2, "heading2");
    expect(result.text).toBe("## The cellar door\nMara remembered it differently.");
  });

  it("replaces one style with another rather than combining them", () => {
    const heading = "## The cellar door";
    expect(setBlockStyle(heading, 0, 0, "quote").text).toBe("> The cellar door");
    expect(setBlockStyle(heading, 0, 0, "bullets").text).toBe("- The cellar door");
  });

  it("removes the style when the same one is applied twice", () => {
    const once = setBlockStyle(chapter, 2, 2, "heading2").text;
    const twice = setBlockStyle(once, 2, 2, "heading2").text;
    expect(twice).toBe(chapter);
  });

  it("clears any style with the body style", () => {
    expect(setBlockStyle("### Shouting", 0, 0, "body").text).toBe("Shouting");
    expect(setBlockStyle("1. First", 0, 0, "body").text).toBe("First");
  });

  it("numbers a multi-line selection in order and leaves blank lines alone", () => {
    const list = "First\n\nSecond\nThird";
    const result = setBlockStyle(list, 0, list.length, "numbers");
    // A blank line does not consume a number: 1, 3, 4 would be a list the
    // writer then has to repair by hand.
    expect(result.text).toBe("1. First\n\n2. Second\n3. Third");
  });

  it("covers every line the selection touches, even partially", () => {
    const text = "alpha\nbeta\ngamma";
    const range = lineRange(text, 3, 8);
    expect(text.slice(range.from, range.to)).toBe("alpha\nbeta");
  });

  it("preserves indentation", () => {
    expect(setBlockStyle("    deep", 0, 0, "quote").text).toBe("    > deep");
  });
});

describe("scene breaks", () => {
  it("stands alone with a blank line either side", () => {
    const result = insertSceneBreak("End of the scene.\n", 18);
    expect(result.text).toBe(`End of the scene.\n\n${SCENE_BREAK}\n\n`);
    expect(result.start).toBe(result.text.length);
  });

  it("does not build a ladder of blank lines when repeated", () => {
    const once = insertSceneBreak("Words.", 6);
    const twice = insertSceneBreak(once.text, once.start);
    expect(twice.text).toBe(`Words.\n\n${SCENE_BREAK}\n\n${SCENE_BREAK}\n\n`);
  });

  it("splits a paragraph cleanly when inserted mid-text", () => {
    const result = insertSceneBreak("Before. After.", 8);
    expect(result.text).toBe(`Before.\n\n${SCENE_BREAK}\n\nAfter.`);
  });
});

describe("the document's own outline", () => {
  const chapter = [
    "# The Cellar Door",
    "",
    "Mara remembered it differently.",
    "",
    "* * *",
    "",
    "## Later",
    "",
    "```",
    "# not a heading",
    "```",
  ].join("\n");

  it("reads headings and scene breaks out of the prose", () => {
    const outline = outlineOf(chapter);
    expect(outline.map((item) => item.label)).toEqual(["The Cellar Door", "Scene break", "Later"]);
    expect(outline[0]?.level).toBe(1);
    expect(outline[2]?.level).toBe(2);
  });

  it("points at the exact character the heading starts on", () => {
    const outline = outlineOf(chapter);
    const later = outline.find((item) => item.label === "Later");
    expect(chapter.slice(later?.offset ?? 0, (later?.offset ?? 0) + 8)).toBe("## Later");
  });

  it("ignores hashes inside a fenced block", () => {
    expect(outlineOf(chapter).some((item) => item.label === "not a heading")).toBe(false);
  });
});

describe("counting", () => {
  it("counts words of prose, not marks of format", () => {
    expect(countWords("**Mara** remembered the _cellar_ door.")).toBe(5);
    expect(countWords("## The Cellar Door")).toBe(3);
    expect(countWords("- one\n- two")).toBe(2);
    expect(countWords("* * *")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });

  it("counts characters exactly as stored", () => {
    expect(countCharacters("**bold**")).toBe(8);
  });
});

describe("find and replace", () => {
  const text = "The door. The doorway. THE DOOR.";

  it("finds every occurrence, case-insensitively by default", () => {
    expect(findMatches(text, "door")).toHaveLength(3);
    expect(findMatches(text, "door", { caseSensitive: true })).toHaveLength(2);
  });

  it("respects whole words when asked", () => {
    const whole = findMatches(text, "door", { wholeWord: true });
    expect(whole).toHaveLength(2);
    expect(text.slice(whole[0]?.start, whole[0]?.end)).toBe("door");
  });

  it("returns nothing for an empty query rather than everything", () => {
    expect(findMatches(text, "")).toEqual([]);
  });

  it("walks forwards and backwards, wrapping at the ends", () => {
    const matches = findMatches(text, "door");
    expect(nextMatch(matches, 0)).toBe(0);
    expect(nextMatch(matches, 5)).toBe(1);
    expect(nextMatch(matches, text.length)).toBe(0);
    expect(previousMatch(matches, text.length)).toBe(2);
    expect(previousMatch(matches, 0)).toBe(2);
    expect(nextMatch([], 0)).toBe(-1);
    expect(previousMatch([], 0)).toBe(-1);
  });

  it("replaces one match and leaves the caret after it", () => {
    const matches = findMatches(text, "door");
    const result = replaceMatch(text, matches[0] as { start: number; end: number }, "gate");
    expect(result.text).toBe("The gate. The doorway. THE DOOR.");
    expect(result.start).toBe(result.end);
  });

  it("replaces every match without disturbing the offsets of the rest", () => {
    // Right-to-left is the whole point: a left-to-right loop with a longer
    // replacement walks off the end and eats a character of somebody's novel.
    const result = replaceAll(text, "door", "cellar door");
    expect(result.count).toBe(3);
    expect(result.text).toBe("The cellar door. The cellar doorway. THE cellar door.");
  });

  it("replaces nothing when there is nothing to replace", () => {
    expect(replaceAll(text, "window", "hatch")).toEqual({ text, count: 0 });
  });
});
