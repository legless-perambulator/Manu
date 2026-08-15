/**
 * Just enough XML to read and write OOXML and EPUB parts.
 *
 * Not a general XML parser — a tag scanner adequate for the well-formed,
 * machine-produced documents inside DOCX and EPUB containers, with entity
 * handling in both directions.
 */

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function encodeEntities(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface XmlTag {
  /** Tag name, e.g. `w:p`. */
  readonly name: string;
  readonly kind: "open" | "close" | "selfclose";
  readonly attributes: Readonly<Record<string, string>>;
  /** Text between this tag and the next one. */
  readonly trailingText: string;
}

const TAG = /<(\/?)([^\s/>]+)([^>]*?)(\/?)>/g;
const ATTR = /([^\s=]+)="([^"]*)"/g;

/** Scan a document into a flat tag stream with the text between tags. */
export function scanXml(xml: string): XmlTag[] {
  const tags: XmlTag[] = [];
  TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  let last: { end: number } | null = null;
  const pending: Array<{ tag: Omit<XmlTag, "trailingText">; end: number }> = [];
  while ((match = TAG.exec(xml)) !== null) {
    const attributes: Record<string, string> = {};
    ATTR.lastIndex = 0;
    let attr: RegExpExecArray | null;
    while ((attr = ATTR.exec(match[3] as string)) !== null) {
      attributes[attr[1] as string] = decodeEntities(attr[2] as string);
    }
    pending.push({
      tag: {
        name: match[2] as string,
        kind: match[1] === "/" ? "close" : match[4] === "/" ? "selfclose" : "open",
        attributes,
      },
      end: match.index + (match[0] as string).length,
    });
    last = { end: match.index + (match[0] as string).length };
  }
  void last;
  for (let index = 0; index < pending.length; index += 1) {
    const current = pending[index] as { tag: Omit<XmlTag, "trailingText">; end: number };
    const nextStart = index + 1 < pending.length ? xml.indexOf("<", current.end) : xml.length;
    const text = xml.slice(current.end, nextStart === -1 ? xml.length : nextStart);
    tags.push({ ...current.tag, trailingText: decodeEntities(text) });
  }
  return tags;
}
