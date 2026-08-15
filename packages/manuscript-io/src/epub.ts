import { readZip, writeZip, type Inflate, type ZipEntry } from "./zip";
import { decodeEntities, encodeEntities, scanXml } from "./xml";
import { assembleManuscript, countWords, isSceneBreak } from "./text";
import { runsFromMarkdown } from "./markdown-runs";
import { paragraphsOf } from "./docx-write";
import type { ImportedChapter, ImportedManuscript, ExportManuscript } from "./types";

/**
 * EPUB import and export (§1, §35).
 *
 * Import walks the container the way a reader does — `container.xml` to the
 * OPF, the OPF's spine to the content documents — so chapter order is the
 * book's own reading order, not a directory listing. It operates on accessible
 * user-provided files; there is no DRM handling here, deliberately (§30).
 * Export produces a small, valid EPUB 3: metadata, navigation, chapters,
 * emphasis and scene breaks.
 */

/** XHTML → Manu Markdown: keep emphasis, breaks and structure, drop the rest. */
export function htmlToMarkdown(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(?:script|style|head)[\s\S]*?<\/(?:script|style|head)>/gi, "")
    .replace(/<(?:em|i)\b[^>]*>/gi, "*")
    .replace(/<\/(?:em|i)>/gi, "*")
    .replace(/<(?:strong|b)\b[^>]*>/gi, "**")
    .replace(/<\/(?:strong|b)>/gi, "**")
    .replace(/<hr\b[^>]*>/gi, "\n\n* * *\n\n")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<blockquote\b[^>]*>/gi, "\n\n> ")
    .replace(/<\/blockquote>/gi, "\n\n")
    .replace(/<h[1-6]\b[^>]*>/gi, "\n\n# ")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/(?:p|div|section)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function resolveHref(opfPath: string, href: string): string {
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const parts = (dir + decodeURIComponent(href)).split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== "." && part !== "") resolved.push(part);
  }
  return resolved.join("/");
}

export async function importEpub(bytes: Uint8Array, inflate: Inflate): Promise<ImportedManuscript> {
  const entries = await readZip(bytes, inflate);
  const byName = new Map(entries.map((entry) => [entry.name, entry] as const));
  const decoder = new TextDecoder();

  const container = byName.get("META-INF/container.xml");
  if (container === undefined) throw new Error("Not an EPUB (META-INF/container.xml is missing).");
  const rootfile = scanXml(decoder.decode(container.data)).find((tag) => tag.name === "rootfile")
    ?.attributes["full-path"];
  if (rootfile === undefined) throw new Error("EPUB container names no rootfile.");

  const opfEntry = byName.get(rootfile);
  if (opfEntry === undefined) throw new Error(`EPUB rootfile "${rootfile}" is missing.`);
  const opf = decoder.decode(opfEntry.data);

  let title: string | null = null;
  let author: string | null = null;
  const manifest = new Map<string, string>();
  const spine: string[] = [];
  for (const tag of scanXml(opf)) {
    if (tag.name === "dc:title" && tag.kind === "open" && title === null) {
      title = tag.trailingText.trim() || null;
    }
    if (tag.name === "dc:creator" && tag.kind === "open" && author === null) {
      author = tag.trailingText.trim() || null;
    }
    if (tag.name === "item" && tag.attributes["id"] !== undefined) {
      manifest.set(tag.attributes["id"], tag.attributes["href"] ?? "");
    }
    if (tag.name === "itemref" && tag.attributes["idref"] !== undefined) {
      spine.push(tag.attributes["idref"]);
    }
  }

  const problems: string[] = [];
  const chapters: ImportedChapter[] = [];
  for (const idref of spine) {
    const href = manifest.get(idref);
    if (href === undefined || href === "") continue;
    const doc = byName.get(resolveHref(rootfile, href));
    if (doc === undefined) {
      problems.push(`Spine item "${href}" is missing from the archive.`);
      continue;
    }
    const markdown = htmlToMarkdown(decoder.decode(doc.data));
    if (markdown === "") continue;
    const headingMatch = markdown.match(/^#\s+(.+)$/m);
    const body = markdown
      .replace(/^#\s+.+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (body === "" && headingMatch === null) continue;
    chapters.push({
      title: headingMatch?.[1]?.trim() ?? `Section ${chapters.length + 1}`,
      markdown: body,
      words: countWords(body),
      boundary: "section",
    });
  }

  // Front and back matter often import as tiny sections; flag, don't guess.
  const tiny = chapters.filter((chapter) => chapter.words > 0 && chapter.words < 20).length;
  if (tiny > 0) {
    problems.push(
      `${tiny} very short section(s) detected — possibly front or back matter to remove after import.`,
    );
  }

  return assembleManuscript(
    "epub",
    title,
    author,
    chapters,
    ["sections", "emphasis", "headings", "scene breaks"],
    problems,
  );
}

// ── Export ─────────────────────────────────────────────────────────────────

function xhtmlParagraph(markdownLine: string): string {
  if (isSceneBreak(markdownLine)) return "<hr/>";
  const runs = runsFromMarkdown(markdownLine)
    .map((run) => {
      let text = encodeEntities(run.text);
      if (run.bold) text = `<strong>${text}</strong>`;
      if (run.italic) text = `<em>${text}</em>`;
      return text;
    })
    .join("");
  return `<p>${runs}</p>`;
}

function chapterXhtml(title: string, markdown: string): string {
  const body = paragraphsOf(markdown).map(xhtmlParagraph).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${encodeEntities(title)}</title></head>
<body><section epub:type="chapter"><h1>${encodeEntities(title)}</h1>
${body}
</section></body></html>`;
}

export function exportEpub(manuscript: ExportManuscript): Uint8Array {
  const encoder = new TextEncoder();
  const identifier = `manu-${manuscript.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  const manifestItems = manuscript.chapters
    .map(
      (_, index) =>
        `<item id="ch${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join("\n");
  const spineItems = manuscript.chapters
    .map((_, index) => `<itemref idref="ch${index + 1}"/>`)
    .join("\n");
  const navItems = manuscript.chapters
    .map(
      (chapter, index) =>
        `<li><a href="chapter-${index + 1}.xhtml">${encodeEntities(chapter.title)}</a></li>`,
    )
    .join("\n");

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="pub-id">${encodeEntities(identifier)}</dc:identifier>
<dc:title>${encodeEntities(manuscript.title)}</dc:title>
<dc:creator>${encodeEntities(manuscript.author)}</dc:creator>
<dc:language>en</dc:language>
<meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifestItems}
</manifest>
<spine>
${spineItems}
</spine>
</package>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><h1>Contents</h1><ol>
${navItems}
</ol></nav></body></html>`;

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

  const entries: ZipEntry[] = [
    // The EPUB spec requires `mimetype` first and uncompressed; our stored
    // writer satisfies both by construction.
    { name: "mimetype", data: encoder.encode("application/epub+zip") },
    { name: "META-INF/container.xml", data: encoder.encode(container) },
    { name: "OEBPS/content.opf", data: encoder.encode(opf) },
    { name: "OEBPS/nav.xhtml", data: encoder.encode(nav) },
    ...manuscript.chapters.map((chapter, index) => ({
      name: `OEBPS/chapter-${index + 1}.xhtml`,
      data: encoder.encode(chapterXhtml(chapter.title, chapter.markdown)),
    })),
  ];
  return writeZip(entries);
}
