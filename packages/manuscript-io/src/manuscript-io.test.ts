import { describe, expect, it } from "vitest";
import { readZip, writeZip } from "./zip";
import { nodeInflate } from "./node";
import { importMarkdown, importPlainText, isChapterHeading } from "./text";
import { importDocx } from "./docx-read";
import { exportDocx } from "./docx-write";
import { importEpub, exportEpub } from "./epub";
import { exportPdf } from "./pdf";
import { exportMarkdown, exportPlainText } from "./plain-export";
import { cleanChapterMarkdown, leaksInternalData, toExportManuscript } from "./clean";
import { buildProjectArchive, readProjectArchive, archiveEligible } from "./archive";
import { previewOf } from "./preview";
import { STANDARD_MANUSCRIPT, type ExportManuscript } from "./types";

const decoder = new TextDecoder();

const BOOK: ExportManuscript = {
  title: "The Vault at Blackthorn",
  author: "P. Larkin",
  chapters: [
    {
      title: "Chapter One",
      markdown:
        "The hall was colder than *Mara* remembered.\n\nShe had **never** trusted the west wing.\n\n* * *\n\nElias was already waiting.",
    },
    {
      title: "Chapter Two",
      markdown: "The photograph was gone.\n\nSomeone had taken it during the night.",
    },
  ],
};

describe("zip", () => {
  it("round-trips stored entries", async () => {
    const bytes = writeZip([
      { name: "a.txt", data: new TextEncoder().encode("hello") },
      { name: "dir/b.txt", data: new TextEncoder().encode("world") },
    ]);
    const entries = await readZip(bytes, nodeInflate);
    expect(entries.map((entry) => entry.name)).toEqual(["a.txt", "dir/b.txt"]);
    expect(decoder.decode(entries[1]?.data)).toBe("world");
  });

  it("reads deflate entries through the pluggable inflate", async () => {
    const zlib = await import("node:zlib");
    const content = new TextEncoder().encode("compressed manuscript text ".repeat(20));
    const compressed = new Uint8Array(zlib.deflateRawSync(content));
    // Hand-build a one-entry deflate zip.
    const stored = writeZip([{ name: "x", data: content }]);
    void stored;
    const name = new TextEncoder().encode("c.txt");
    const local: number[] = [];
    const push16 = (arr: number[], v: number) => arr.push(v & 0xff, (v >>> 8) & 0xff);
    const push32 = (arr: number[], v: number) =>
      arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    push32(local, 0x04034b50);
    push16(local, 20);
    push16(local, 0);
    push16(local, 8);
    push16(local, 0);
    push16(local, 0x21);
    push32(local, 0); // CRC unchecked by our reader.
    push32(local, compressed.length);
    push32(local, content.length);
    push16(local, name.length);
    push16(local, 0);
    for (const byte of name) local.push(byte);
    for (const byte of compressed) local.push(byte);
    const central: number[] = [];
    push32(central, 0x02014b50);
    push16(central, 20);
    push16(central, 20);
    push16(central, 0);
    push16(central, 8);
    push16(central, 0);
    push16(central, 0x21);
    push32(central, 0);
    push32(central, compressed.length);
    push32(central, content.length);
    push16(central, name.length);
    push16(central, 0);
    push16(central, 0);
    push16(central, 0);
    push16(central, 0);
    push32(central, 0);
    push32(central, 0);
    for (const byte of name) central.push(byte);
    const eocd: number[] = [];
    push32(eocd, 0x06054b50);
    push16(eocd, 0);
    push16(eocd, 0);
    push16(eocd, 1);
    push16(eocd, 1);
    push32(eocd, central.length);
    push32(eocd, local.length);
    push16(eocd, 0);
    const bytes = Uint8Array.from([...local, ...central, ...eocd]);
    const entries = await readZip(bytes, nodeInflate);
    expect(decoder.decode(entries[0]?.data)).toContain("compressed manuscript text");
  });
});

describe("chapter detection (§4)", () => {
  it("recognises the textual patterns of typescripts", () => {
    expect(isChapterHeading("Chapter One")).toBe(true);
    expect(isChapterHeading("CHAPTER 12")).toBe(true);
    expect(isChapterHeading("Prologue")).toBe(true);
    expect(isChapterHeading("THE VAULT")).toBe(true);
    expect(isChapterHeading("It was a dark and stormy night.")).toBe(false);
    expect(isChapterHeading("* * *")).toBe(false);
  });

  it("imports markdown with a title and ## chapters", () => {
    const imported = importMarkdown(
      "# The Vault\n\n## Chapter One\n\nProse here.\n\n## Chapter Two\n\nMore prose.",
    );
    expect(imported.title).toBe("The Vault");
    expect(imported.chapters.map((chapter) => chapter.title)).toEqual([
      "Chapter One",
      "Chapter Two",
    ]);
  });

  it("imports plain text by pattern and previews problems honestly", () => {
    const oneBlob = importPlainText("Just prose with no headings at all.\nMore prose.");
    const preview = previewOf(oneBlob);
    expect(preview.chapterCount).toBe(1);
    expect(preview.problems.some((problem) => problem.includes("one chapter"))).toBe(true);
  });
});

describe("DOCX (§1, §6, §34)", () => {
  it("round-trips chapters, emphasis and scene breaks through our own writer", async () => {
    const bytes = exportDocx(BOOK, { ...STANDARD_MANUSCRIPT, includeTitlePage: false });
    const imported = await importDocx(bytes, nodeInflate);
    expect(imported.title).toBe("The Vault at Blackthorn");
    expect(imported.author).toBe("P. Larkin");
    expect(imported.chapters.map((chapter) => chapter.title)).toEqual([
      "Chapter One",
      "Chapter Two",
    ]);
    const first = imported.chapters[0]?.markdown ?? "";
    expect(first).toContain("*Mara*");
    expect(first).toContain("**never**");
    expect(first).toContain("* * *");
  });

  it("keeps the title page out of chapter prose when enabled", async () => {
    const bytes = exportDocx(BOOK, STANDARD_MANUSCRIPT);
    const imported = await importDocx(bytes, nodeInflate);
    expect(imported.chapters.map((chapter) => chapter.title)).toEqual([
      "Chapter One",
      "Chapter Two",
    ]);
  });
});

describe("EPUB (§1, §35)", () => {
  it("exports a valid container and round-trips it", async () => {
    const bytes = exportEpub(BOOK);
    const entries = await readZip(bytes, nodeInflate);
    expect(entries[0]?.name).toBe("mimetype");
    expect(decoder.decode(entries[0]?.data)).toBe("application/epub+zip");
    expect(entries.some((entry) => entry.name === "META-INF/container.xml")).toBe(true);
    expect(entries.some((entry) => entry.name === "OEBPS/nav.xhtml")).toBe(true);

    const imported = await importEpub(bytes, nodeInflate);
    expect(imported.title).toBe("The Vault at Blackthorn");
    expect(imported.chapters.map((chapter) => chapter.title)).toEqual([
      "Chapter One",
      "Chapter Two",
    ]);
    expect(imported.chapters[0]?.markdown).toContain("*Mara*");
    expect(imported.chapters[0]?.markdown).toContain("* * *");
  });
});

describe("PDF (§36)", () => {
  it("produces a structurally sound page sequence", () => {
    const bytes = exportPdf(BOOK, STANDARD_MANUSCRIPT);
    const text = decoder.decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/BaseFont /Courier");
    expect(text.endsWith("%%EOF\n")).toBe(true);
    // Title page + one page per chapter at minimum.
    const pageCount = (text.match(/\/Type \/Page /g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(3);
    expect(text).toMatch(/The Vault at Blackthorn\) Tj/);
  });
});

describe("clean export (§33)", () => {
  const raw = `---\ntitle: Chapter One\n---\n<!-- scene: SCENE_0001 -->\nThe hall was cold.\n\n<!-- scene: SCENE_0002 -->\nElias waited.\n`;

  it("strips front matter, markers and comments", () => {
    const cleaned = cleanChapterMarkdown(raw);
    expect(cleaned).toBe("The hall was cold.\n\nElias waited.");
    expect(leaksInternalData(cleaned)).toBe(false);
    expect(leaksInternalData(raw)).toBe(true);
  });

  it("no exporter leaks internal data", () => {
    const manuscript = toExportManuscript("T", "A", [
      { title: "One", raw },
      { title: "Two", raw: "<!-- note from agent -->\nProse **only**." },
    ]);
    for (const text of [
      exportMarkdown(manuscript),
      exportPlainText(manuscript),
      decoder.decode(exportDocx(manuscript, STANDARD_MANUSCRIPT)),
      decoder.decode(exportPdf(manuscript, STANDARD_MANUSCRIPT)),
    ]) {
      expect(leaksInternalData(text)).toBe(false);
    }
  });
});

describe("project archive (§37, §40)", () => {
  it("round-trips a project and refuses secret-shaped files", async () => {
    expect(archiveEligible("manuscript/CHAPTER_0001.md")).toBe(true);
    expect(archiveEligible(".env")).toBe(false);
    expect(archiveEligible(".writer/secrets.json")).toBe(false);

    const archive = buildProjectArchive([
      { path: ".writer/project.json", content: '{"title":"T"}' },
      { path: "manuscript/CHAPTER_0001.md", content: "Prose." },
      { path: ".writer/api-key.txt", content: "sk-should-not-travel" },
    ]);
    const back = await readProjectArchive(archive, nodeInflate);
    expect(back.problems).toEqual([]);
    expect(back.files.map((file) => file.path)).toEqual([
      ".writer/project.json",
      "manuscript/CHAPTER_0001.md",
    ]);
  });

  it("flags an archive that is not a Manu project", async () => {
    const archive = buildProjectArchive([{ path: "readme.txt", content: "hello" }]);
    const back = await readProjectArchive(archive, nodeInflate);
    expect(back.problems).toHaveLength(1);
  });
});
