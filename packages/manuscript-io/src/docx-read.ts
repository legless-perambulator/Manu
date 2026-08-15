import { readZip, type Inflate } from "./zip";
import { scanXml } from "./xml";
import { assembleManuscript, chaptersFromLines, isChapterHeading, isSceneBreak } from "./text";
import type { ImportedChapter, ImportedManuscript } from "./types";

/**
 * DOCX import (§1, §4, §6).
 *
 * Reads `word/document.xml` out of the OOXML container and keeps the
 * formatting that means something in a manuscript — italics, bold, headings,
 * paragraphs, scene breaks — as Manu's own Markdown. Word's styling clutter
 * (fonts, colours, spacing) is deliberately not preserved: it is presentation,
 * and Manu owns presentation at export time.
 */

interface DocxRun {
  text: string;
  italic: boolean;
  bold: boolean;
}

interface DocxParagraph {
  runs: DocxRun[];
  style: string | null;
  pageBreakBefore: boolean;
}

function parseParagraphs(documentXml: string): DocxParagraph[] {
  const paragraphs: DocxParagraph[] = [];
  let paragraph: DocxParagraph | null = null;
  let inRunProps = false;
  let italic = false;
  let bold = false;

  const onFlag = (attributes: Readonly<Record<string, string>>): boolean => {
    const value = attributes["w:val"];
    return value !== "0" && value !== "false" && value !== "none";
  };

  for (const tag of scanXml(documentXml)) {
    switch (tag.name) {
      case "w:p":
        if (tag.kind === "open") {
          paragraph = { runs: [], style: null, pageBreakBefore: false };
        } else if (tag.kind === "close" && paragraph !== null) {
          paragraphs.push(paragraph);
          paragraph = null;
        }
        break;
      case "w:pStyle":
        if (paragraph !== null) paragraph.style = tag.attributes["w:val"] ?? null;
        break;
      case "w:r":
        if (tag.kind === "open") {
          italic = false;
          bold = false;
        }
        break;
      case "w:rPr":
        inRunProps = tag.kind === "open";
        break;
      case "w:i":
      case "w:iCs":
        if (inRunProps) italic = onFlag(tag.attributes);
        break;
      case "w:b":
      case "w:bCs":
        if (inRunProps) bold = onFlag(tag.attributes);
        break;
      case "w:t":
        if (paragraph !== null && tag.kind === "open" && tag.trailingText !== "") {
          paragraph.runs.push({ text: tag.trailingText, italic, bold });
        }
        break;
      case "w:br":
        if (paragraph !== null && tag.attributes["w:type"] === "page") {
          paragraph.pageBreakBefore = true;
        }
        break;
      case "w:tab":
        if (paragraph !== null) paragraph.runs.push({ text: " ", italic, bold });
        break;
      default:
        break;
    }
  }
  return paragraphs;
}

/** Merge adjacent same-format runs and render the paragraph as Markdown. */
function paragraphMarkdown(paragraph: DocxParagraph): string {
  const parts: string[] = [];
  let buffer = "";
  let currentItalic = false;
  let currentBold = false;

  const flush = () => {
    if (buffer === "") return;
    const trimmed = buffer;
    if (currentItalic && currentBold) parts.push(`***${trimmed}***`);
    else if (currentBold) parts.push(`**${trimmed}**`);
    else if (currentItalic) parts.push(`*${trimmed}*`);
    else parts.push(trimmed);
    buffer = "";
  };

  for (const run of paragraph.runs) {
    if (run.italic !== currentItalic || run.bold !== currentBold) {
      flush();
      currentItalic = run.italic;
      currentBold = run.bold;
    }
    buffer += run.text;
  }
  flush();
  return parts.join("");
}

const HEADING_STYLE = /^(?:Heading[123]?|Title|Chapter)$/i;

export async function importDocx(bytes: Uint8Array, inflate: Inflate): Promise<ImportedManuscript> {
  const entries = await readZip(bytes, inflate);
  const document = entries.find((entry) => entry.name === "word/document.xml");
  if (document === undefined) {
    throw new Error("Not a DOCX document (word/document.xml is missing).");
  }
  const documentXml = new TextDecoder().decode(document.data);
  const paragraphs = parseParagraphs(documentXml);

  // Title and author from docProps/core.xml, when present.
  let title: string | null = null;
  let author: string | null = null;
  const core = entries.find((entry) => entry.name === "docProps/core.xml");
  if (core !== undefined) {
    const coreXml = new TextDecoder().decode(core.data);
    for (const tag of scanXml(coreXml)) {
      if (tag.name === "dc:title" && tag.kind === "open" && tag.trailingText.trim() !== "") {
        title = tag.trailingText.trim();
      }
      if (tag.name === "dc:creator" && tag.kind === "open" && tag.trailingText.trim() !== "") {
        author = tag.trailingText.trim();
      }
    }
  }

  // Deterministic boundary choice (§4): named heading styles first; textual
  // patterns only when the document has no usable styles.
  const usesStyles = paragraphs.some(
    (paragraph) => paragraph.style !== null && HEADING_STYLE.test(paragraph.style),
  );

  const lines: string[] = [];
  const headingLines = new Set<string>();
  const body = paragraphs.filter(
    // Title-page paragraphs are front matter, not chapter prose.
    (paragraph) => paragraph.style === null || !/^TitlePage$/i.test(paragraph.style),
  );
  body.forEach((paragraph, index) => {
    const text = paragraphMarkdown(paragraph);
    const isHeading = usesStyles
      ? paragraph.style !== null && HEADING_STYLE.test(paragraph.style)
      : isChapterHeading(text) && (index === 0 || paragraph.pageBreakBefore || text.length <= 48);
    const line = isSceneBreak(text) ? "* * *" : text;
    const key = `¶${index}`;
    lines.push(isHeading ? `${key}HEADING${line}` : line);
    if (isHeading) headingLines.add(`${key}HEADING${line}`);
    lines.push("");
  });

  const chapters: ImportedChapter[] = chaptersFromLines(
    lines,
    (line) => headingLines.has(line),
    usesStyles ? "style" : "pattern",
  ).map((chapter) => ({
    ...chapter,
    title: chapter.title.replace(/^¶\d+HEADING/, ""),
  }));

  const formatting = ["paragraphs", "italic", "bold", "headings", "scene breaks"];
  return assembleManuscript("docx", title, author, chapters, formatting);
}
