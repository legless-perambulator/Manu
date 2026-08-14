import { describe, expect, it } from "vitest";
import {
  areaName,
  chapterNumberLabel,
  humaniseSummary,
  documentName,
  documentTitle,
  fileStem,
  isMachinePath,
  isProsePath,
  isWriterFacing,
  looksLikeEntityId,
  numberWord,
} from "./naming";

describe("the writer's names, not the machine's", () => {
  it("spells small chapter numbers and leaves large ones as numerals", () => {
    expect(chapterNumberLabel(0)).toBe("Chapter One");
    expect(chapterNumberLabel(6)).toBe("Chapter Seven");
    expect(chapterNumberLabel(19)).toBe("Chapter Twenty");
    // Past twenty a numeral reads better and fits a sidebar.
    expect(chapterNumberLabel(20)).toBe("Chapter 21");
    expect(numberWord(0)).toBe("0");
    expect(numberWord(1.5)).toBe("1.5");
  });

  it("takes the stem of a path without its directory or extension", () => {
    expect(fileStem("manuscript/CHAPTER_0007.md")).toBe("CHAPTER_0007");
    expect(fileStem("notes/ideas")).toBe("ideas");
    // A dotfile is all name, not an empty stem with an extension.
    expect(fileStem(".gitignore")).toBe(".gitignore");
  });

  it("turns a filename into something a person would write", () => {
    expect(documentName("notes/cellar_door-ideas.md")).toBe("Cellar door ideas");
    expect(documentName("research/1920s trains.md")).toBe("1920s trains");
  });

  it("prefers the writer's own title over anything derived", () => {
    expect(documentTitle("manuscript/CHAPTER_0007.md", "The Cellar Door")).toBe("The Cellar Door");
    expect(documentTitle("manuscript/CHAPTER_0007.md", "   ")).toBe("CHAPTER 0007");
    expect(documentTitle("notes/beats.md", null)).toBe("Beats");
  });

  it("names the area a document lives in the way a writer thinks of it", () => {
    expect(areaName("manuscript/CHAPTER_0001.md")).toBe("Manuscript");
    expect(areaName("world/locations/LOC_0002.md")).toBe("Locations");
    // An unmapped subdirectory falls back to its top level rather than a path.
    expect(areaName("world/weather/LOC.md")).toBe("World");
    expect(areaName("stray.md")).toBe("Project");
  });

  it("knows Manu's own bookkeeping from the writer's work", () => {
    expect(isMachinePath(".writer/index/lexical.json")).toBe(true);
    expect(isMachinePath("project.json")).toBe(true);
    expect(isMachinePath("manuscript/CHAPTER_0001.md")).toBe(false);
    // Not fooled by a name that merely starts the same way.
    expect(isMachinePath(".writerly/notes.md")).toBe(false);
  });

  it("knows which documents are prose", () => {
    expect(isProsePath("manuscript/CHAPTER_0001.md")).toBe(true);
    expect(isProsePath("notes/beats.md")).toBe(true);
    expect(isProsePath("characters/CHAR_0001.md")).toBe(false);
  });
});

/**
 * The rule this phase exists to enforce, expressed as an assertion rather than
 * as a paragraph of intent: a primary label may not be an ID, a path or a
 * filename with an extension.
 */
describe("no backend concept survives as a label", () => {
  it("recognises entity IDs", () => {
    expect(looksLikeEntityId("CHAPTER_0007")).toBe(true);
    expect(looksLikeEntityId("CHAR_0001")).toBe(true);
    expect(looksLikeEntityId("The Cellar Door")).toBe(false);
    expect(looksLikeEntityId("MARA")).toBe(false);
  });

  it("rejects labels that leak storage", () => {
    expect(isWriterFacing("Chapter One")).toBe(true);
    expect(isWriterFacing("The Cellar Door")).toBe(true);
    expect(isWriterFacing("CHAPTER_0007")).toBe(false);
    expect(isWriterFacing("relationships.json")).toBe(false);
    expect(isWriterFacing("world_rules.md")).toBe(false);
    expect(isWriterFacing("manuscript/CHAPTER_0001")).toBe(false);
  });

  it("says what a change did without naming a file", () => {
    // History records `Edit manuscript/CHAPTER_0002.md` and is right to. The
    // writer reads "Edit Aftermath".
    const titles = new Map([["manuscript/CHAPTER_0002.md", "Aftermath"]]);
    expect(humaniseSummary("Edit manuscript/CHAPTER_0002.md", titles)).toBe("Edit Aftermath");
    // A document with no title still loses its extension.
    expect(humaniseSummary("Edit notes/cellar_door-ideas.md", titles)).toBe(
      "Edit Cellar door ideas",
    );
    // Summaries with no path in them are left exactly as recorded.
    expect(humaniseSummary('Create character "Mara Blackthorn"', titles)).toBe(
      'Create character "Mara Blackthorn"',
    );
  });

  it("passes everything the naming layer itself produces", () => {
    const produced = [
      chapterNumberLabel(0),
      chapterNumberLabel(40),
      documentName("notes/cellar_door-ideas.md"),
      documentTitle("manuscript/CHAPTER_0007.md", "The Cellar Door"),
      areaName("world/locations/LOC_0002.md"),
    ];
    for (const label of produced) expect(isWriterFacing(label)).toBe(true);
  });
});
