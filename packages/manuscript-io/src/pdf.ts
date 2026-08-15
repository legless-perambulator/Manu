import { isSceneBreak } from "./text";
import { plainText } from "./markdown-runs";
import { paragraphsOf } from "./docx-write";
import type { ExportManuscript, ManuscriptFormatOptions } from "./types";

/**
 * PDF export (§36): a clean reading and proofing document, not a typesetting
 * system.
 *
 * Set in Courier — a core PDF font that is fixed-pitch, which makes line
 * wrapping exact rather than approximate — with the Standard Manuscript
 * preset's spacing, page numbers and chapter openings. The PDF is never the
 * canonical manuscript: it is generated from the same clean chapters every
 * other export uses.
 */

const PAGE_WIDTH = 612; // US Letter, points.
const PAGE_HEIGHT = 792;
const MARGIN = 72;

/** Latin-1-safe text: normalise typographic characters, degrade the rest. */
function latin1(text: string): string {
  const replaced = text
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/—/g, "--")
    .replace(/–/g, "-")
    .replace(/…/g, "...")
    .replace(/\u00a0/g, " ");
  let out = "";
  for (const ch of replaced) {
    out += (ch.codePointAt(0) ?? 0) <= 0xff ? ch : "?";
  }
  return out;
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(text: string, columns: number, indent: number): string[] {
  const words = text.split(/\s+/).filter((word) => word !== "");
  const lines: string[] = [];
  let line = " ".repeat(indent);
  let lineHasWords = false;
  for (const word of words) {
    const candidate = lineHasWords ? `${line} ${word}` : line + word;
    if (candidate.length > columns && lineHasWords) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
    lineHasWords = true;
  }
  if (lineHasWords) lines.push(line);
  return lines.length === 0 ? [""] : lines;
}

interface PdfPage {
  readonly lines: readonly string[];
  readonly header: string | null;
}

export function exportPdf(
  manuscript: ExportManuscript,
  options: ManuscriptFormatOptions,
): Uint8Array {
  const fontSize = options.fontSize;
  const charWidth = fontSize * 0.6; // Courier's fixed advance: 600/1000 em.
  const columns = Math.floor((PAGE_WIDTH - 2 * MARGIN) / charWidth);
  const lineHeight = options.doubleSpaced ? fontSize * 2 : fontSize * 1.2;
  const linesPerPage = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / lineHeight);

  const headerBase = options.headerText ?? `${manuscript.author} / ${manuscript.title}`;

  // Lay the book out into pages of wrapped Courier lines.
  const pages: PdfPage[] = [];
  let current: string[] = [];

  const pushPage = () => {
    if (current.length > 0) {
      pages.push({ lines: current, header: headerBase });
      current = [];
    }
  };

  if (options.includeTitlePage) {
    const centre = (text: string) =>
      " ".repeat(Math.max(0, Math.floor((columns - text.length) / 2))) + text;
    const blank = Math.floor(linesPerPage / 2) - 2;
    const titleLines = [
      ...Array.from({ length: blank }, () => ""),
      centre(latin1(manuscript.title)),
      "",
      centre(latin1(`by ${manuscript.author}`)),
    ];
    pages.push({ lines: titleLines, header: null });
  }

  for (const chapter of manuscript.chapters) {
    if (options.chapterOnNewPage) pushPage();
    const opening = Math.min(6, Math.floor(linesPerPage / 4));
    for (let i = 0; i < opening; i += 1) current.push("");
    const title = latin1(plainText(chapter.title));
    current.push(" ".repeat(Math.max(0, Math.floor((columns - title.length) / 2))) + title);
    current.push("");
    for (const paragraph of paragraphsOf(chapter.markdown)) {
      const text = latin1(plainText(paragraph.replace(/^>\s*/, "")));
      const lines = isSceneBreak(paragraph)
        ? [" ".repeat(Math.max(0, Math.floor((columns - 5) / 2))) + "* * *"]
        : wrap(text, columns, 5);
      for (const line of lines) {
        if (current.length >= linesPerPage) pushPage();
        current.push(line);
      }
    }
    if (current.length >= linesPerPage) pushPage();
    else current.push("");
  }
  pushPage();

  // Assemble the PDF: header, objects, xref with exact byte offsets.
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let position = 0;

  const emit = (text: string) => {
    const bytes = encoder.encode(text);
    chunks.push(bytes);
    position += bytes.length;
  };
  const beginObject = (id: number) => {
    offsets[id] = position;
    emit(`${id} 0 obj\n`);
  };

  emit("%PDF-1.4\n");

  const pageCount = pages.length;
  const firstPageObject = 4;
  const pagesKids = Array.from(
    { length: pageCount },
    (_, index) => `${firstPageObject + index * 2} 0 R`,
  ).join(" ");

  beginObject(1);
  emit("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  beginObject(2);
  emit(
    `<< /Type /Pages /Kids [${pagesKids}] /Count ${pageCount} /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] >>\nendobj\n`,
  );
  beginObject(3);
  emit("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\nendobj\n");

  pages.forEach((page, index) => {
    const pageObject = firstPageObject + index * 2;
    const contentObject = pageObject + 1;

    const body: string[] = [`BT /F1 ${fontSize} Tf`];
    if (page.header !== null) {
      const headerText = latin1(
        options.pageNumbers ? `${page.header} / ${index + 1}` : page.header,
      );
      const x = PAGE_WIDTH - MARGIN - headerText.length * charWidth;
      body.push(`1 0 0 1 ${Math.max(MARGIN, x).toFixed(1)} ${PAGE_HEIGHT - MARGIN + 24} Tm`);
      body.push(`(${escapePdf(headerText)}) Tj`);
    }
    body.push(`1 0 0 1 ${MARGIN} ${PAGE_HEIGHT - MARGIN} Tm`);
    body.push(`${lineHeight.toFixed(1)} TL`);
    for (const line of page.lines) {
      body.push("T*");
      if (line !== "") body.push(`(${escapePdf(line)}) Tj`);
    }
    body.push("ET");
    const stream = body.join("\n");

    beginObject(pageObject);
    emit(
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>\nendobj\n`,
    );
    beginObject(contentObject);
    emit(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  });

  const objectCount = firstPageObject + pageCount * 2 - 1;
  const xrefStart = position;
  emit(`xref\n0 ${objectCount + 1}\n`);
  emit("0000000000 65535 f \n");
  for (let id = 1; id <= objectCount; id += 1) {
    emit(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  }
  emit(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}
