import { writeZip } from "./zip";
import { encodeEntities } from "./xml";
import { isSceneBreak } from "./text";
import { runsFromMarkdown } from "./markdown-runs";
import type { ExportManuscript, ManuscriptFormatOptions } from "./types";

/**
 * DOCX export (§34): a minimal, valid, *editable* OOXML package — chapter
 * headings, paragraphs, emphasis, scene breaks, an optional title page and a
 * running header. Nothing internal to Manu appears anywhere in the file (§33);
 * the callers hand this module already-cleaned prose and it adds only
 * presentation.
 */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>`;

function fontName(options: ManuscriptFormatOptions): string {
  return options.font === "courier" ? "Courier New" : "Times New Roman";
}

function stylesXml(options: ManuscriptFormatOptions): string {
  const size = options.fontSize * 2; // OOXML sizes are half-points.
  const spacing = options.doubleSpaced ? 480 : 240;
  const font = fontName(options);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/><w:sz w:val="${size}"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:line="${spacing}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/><w:pPr><w:ind w:firstLine="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
<w:pPr>${options.chapterOnNewPage ? "<w:pageBreakBefore/>" : ""}<w:jc w:val="center"/><w:spacing w:before="2880" w:after="480"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr>
<w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="SceneBreak"><w:name w:val="Scene Break"/><w:basedOn w:val="Normal"/>
<w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="TitlePage"><w:name w:val="Title Page"/><w:basedOn w:val="Normal"/>
<w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/></w:pPr></w:style>
</w:styles>`;
}

function headerXml(manuscript: ExportManuscript, options: ManuscriptFormatOptions): string {
  const label = encodeEntities(options.headerText ?? `${manuscript.author} / ${manuscript.title}`);
  const page = options.pageNumbers
    ? `<w:r><w:t xml:space="preserve"> / </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:p><w:pPr><w:jc w:val="right"/><w:ind w:firstLine="0"/></w:pPr><w:r><w:t xml:space="preserve">${label}</w:t></w:r>${page}</w:p>
</w:hdr>`;
}

function runXml(text: string, italic: boolean, bold: boolean): string {
  const props =
    italic || bold ? `<w:rPr>${bold ? "<w:b/>" : ""}${italic ? "<w:i/>" : ""}</w:rPr>` : "";
  return `<w:r>${props}<w:t xml:space="preserve">${encodeEntities(text)}</w:t></w:r>`;
}

function paragraphXml(markdownLine: string, style: string | null): string {
  const props = style === null ? "" : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`;
  const runs = runsFromMarkdown(markdownLine)
    .map((run) => runXml(run.text, run.italic, run.bold))
    .join("");
  return `<w:p>${props}${runs}</w:p>`;
}

function coreXml(manuscript: ExportManuscript): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>${encodeEntities(manuscript.title)}</dc:title>
<dc:creator>${encodeEntities(manuscript.author)}</dc:creator>
</cp:coreProperties>`;
}

/** Paragraph-split a chapter's Markdown: blank lines separate paragraphs. */
export function paragraphsOf(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n/g, " ").trim())
    .filter((block) => block !== "");
}

export function exportDocx(
  manuscript: ExportManuscript,
  options: ManuscriptFormatOptions,
): Uint8Array {
  const body: string[] = [];

  if (options.includeTitlePage) {
    body.push(paragraphXml(manuscript.title, "TitlePage"));
    body.push(paragraphXml(`by ${manuscript.author}`, "TitlePage"));
  }

  for (const chapter of manuscript.chapters) {
    body.push(paragraphXml(chapter.title, "Heading1"));
    for (const paragraph of paragraphsOf(chapter.markdown)) {
      if (isSceneBreak(paragraph)) body.push(paragraphXml("* * *", "SceneBreak"));
      else if (paragraph.startsWith("> ")) {
        body.push(paragraphXml(paragraph.replace(/^>\s*/, ""), "SceneBreak"));
      } else body.push(paragraphXml(paragraph, null));
    }
  }

  const sectPr = `<w:sectPr><w:headerReference w:type="default" r:id="rId6" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720"/></w:sectPr>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body.join("")}${sectPr}</w:body>
</w:document>`;

  const encoder = new TextEncoder();
  return writeZip([
    { name: "[Content_Types].xml", data: encoder.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: encoder.encode(ROOT_RELS) },
    { name: "word/_rels/document.xml.rels", data: encoder.encode(DOCUMENT_RELS) },
    { name: "word/styles.xml", data: encoder.encode(stylesXml(options)) },
    { name: "word/header1.xml", data: encoder.encode(headerXml(manuscript, options)) },
    { name: "word/document.xml", data: encoder.encode(documentXml) },
    { name: "docProps/core.xml", data: encoder.encode(coreXml(manuscript)) },
  ]);
}
