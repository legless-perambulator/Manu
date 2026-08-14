/**
 * Manuscript formatting, as text operations.
 *
 * ## Why Markdown is the format and not an implementation detail
 *
 * A manuscript in Manu has to survive being diffed line by line, addressed by
 * character offset for an AI edit, versioned, branched, merged, read by a
 * person with `less`, and opened in another editor tomorrow. That set of
 * requirements picks the representation on its own: **the canonical manuscript
 * is Markdown, and formatting is semantic markup inside it.** A rich-text
 * document model — HTML, a JSON node tree, anything with a serializer — would
 * make every one of those operations approximate.
 *
 * So `bold` is not a style bit stored beside the text. It is `**this**`, in the
 * file, where a diff can see it and a scene range can address it.
 *
 * Everything here is a pure function from (text, selection) to (text,
 * selection). No DOM, no React, no repository. That is what makes it testable,
 * and it is why the editor's undo stack can treat a formatting command exactly
 * like a keystroke.
 */

export interface Edit {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export type InlineMark = "bold" | "italic" | "strikethrough";

/**
 * The marker each inline style uses.
 *
 * Underline has no Markdown spelling, and inventing one (`__x__` is already
 * bold or italic depending on the reader) would produce a file that renders
 * wrongly everywhere outside Manu. Emphasis is the semantic the writer wants
 * and italic is how English typesets it, so Manu offers italic and does not
 * offer a fake underline (docs/UX.md).
 */
const MARKER: Readonly<Record<InlineMark, string>> = {
  bold: "**",
  italic: "_",
  strikethrough: "~~",
};

/** Trim the selection back off surrounding whitespace before wrapping it. */
function tighten(text: string, start: number, end: number): { start: number; end: number } {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from] ?? "")) from += 1;
  while (to > from && /\s/.test(text[to - 1] ?? "")) to -= 1;
  return { start: from, end: to };
}

/**
 * Add or remove an inline mark around the selection.
 *
 * Toggling is symmetric in both directions: applying bold to already-bold text
 * removes it, whether the markers are inside the selection or immediately
 * outside it. Without the outside case, selecting the word inside `**word**`
 * and pressing ⌘B would produce `****word****`, which is how a formatting
 * command becomes something a writer stops trusting.
 */
export function toggleInline(text: string, start: number, end: number, mark: InlineMark): Edit {
  const marker = MARKER[mark];
  const width = marker.length;
  const range = tighten(text, start, end);

  // Nothing selected: drop an empty pair and put the caret between them.
  if (range.start === range.end) {
    const caret = range.start;
    return {
      text: `${text.slice(0, caret)}${marker}${marker}${text.slice(caret)}`,
      start: caret + width,
      end: caret + width,
    };
  }

  const inner = text.slice(range.start, range.end);

  // Markers inside the selection.
  if (inner.length >= width * 2 && inner.startsWith(marker) && inner.endsWith(marker)) {
    const stripped = inner.slice(width, inner.length - width);
    return {
      text: text.slice(0, range.start) + stripped + text.slice(range.end),
      start: range.start,
      end: range.start + stripped.length,
    };
  }

  // Markers immediately outside the selection.
  const before = text.slice(Math.max(0, range.start - width), range.start);
  const after = text.slice(range.end, range.end + width);
  if (before === marker && after === marker) {
    return {
      text: text.slice(0, range.start - width) + inner + text.slice(range.end + width),
      start: range.start - width,
      end: range.start - width + inner.length,
    };
  }

  const wrapped = `${marker}${inner}${marker}`;
  return {
    text: text.slice(0, range.start) + wrapped + text.slice(range.end),
    start: range.start + width,
    end: range.start + width + inner.length,
  };
}

export type BlockStyle =
  "body" | "heading1" | "heading2" | "heading3" | "quote" | "bullets" | "numbers";

const BLOCK_PREFIX: Readonly<Record<Exclude<BlockStyle, "body" | "numbers">, string>> = {
  heading1: "# ",
  heading2: "## ",
  heading3: "### ",
  quote: "> ",
  bullets: "- ",
};

/** Any prefix this module knows how to remove, so styles replace rather than stack. */
const ANY_PREFIX = /^(\s*)(?:(#{1,6}\s+)|(>\s?)|([-*+]\s+)|(\d+[.)]\s+))/;

/** The bounds of every line the selection touches, even partially. */
export function lineRange(text: string, start: number, end: number): { from: number; to: number } {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const nl = text.indexOf("\n", end);
  return { from, to: nl === -1 ? text.length : nl };
}

/**
 * Apply a paragraph style to every line the selection touches.
 *
 * Styles replace each other rather than accumulating: making a quote out of a
 * heading gives a quote, not `> # `. Applying the style a block already has
 * removes it, so every one of these is a toggle and ⌘⌥2 twice is a no-op.
 */
export function setBlockStyle(text: string, start: number, end: number, style: BlockStyle): Edit {
  const { from, to } = lineRange(text, start, end);
  const block = text.slice(from, to);
  const lines = block.split("\n");

  const stripped = lines.map((line) => line.replace(ANY_PREFIX, "$1"));
  const already =
    style !== "body" &&
    lines.every((line, i) => line !== (stripped[i] ?? line)) &&
    lines.every((line) => matchesStyle(line, style));

  let ordinal = 0;
  const next =
    style === "body" || already
      ? stripped
      : stripped.map((line) => {
          const indent = /^\s*/.exec(line)?.[0] ?? "";
          const body = line.slice(indent.length);
          // An empty line inside a multi-line selection stays empty: a bullet
          // with nothing after it is noise the writer then has to delete. It
          // does not consume a number either — a list that runs 1, 3, 4 is a
          // bug the writer has to go and fix by hand.
          if (body === "" && lines.length > 1) return line;
          ordinal += 1;
          const prefix = style === "numbers" ? `${ordinal}. ` : BLOCK_PREFIX[style];
          return `${indent}${prefix}${body}`;
        });

  const replaced = next.join("\n");
  return {
    text: text.slice(0, from) + replaced + text.slice(to),
    start: from,
    end: from + replaced.length,
  };
}

function matchesStyle(line: string, style: BlockStyle): boolean {
  const body = line.replace(/^\s*/, "");
  switch (style) {
    case "heading1":
      return /^#\s/.test(body);
    case "heading2":
      return /^##\s/.test(body);
    case "heading3":
      return /^###\s/.test(body);
    case "quote":
      return /^>\s?/.test(body);
    case "bullets":
      return /^[-*+]\s/.test(body);
    case "numbers":
      return /^\d+[.)]\s/.test(body);
    /* istanbul ignore next — "body" never reaches here; it is handled above. */
    default:
      return false;
  }
}

/** The scene break Manu writes, and the shapes it accepts from elsewhere. */
export const SCENE_BREAK = "* * *";
const SCENE_BREAK_LINE = /^\s*(?:\*\s*\*\s*\*|-{3,}|#{3,}|\*{3,})\s*$/;

/**
 * Put a scene break on its own line, with a blank line either side.
 *
 * Whitespace is normalised rather than assumed: pressing the shortcut twice in
 * the same place should not build a ladder of blank lines, and the break should
 * look the same whether it was inserted mid-paragraph or at the end of a file.
 */
export function insertSceneBreak(text: string, at: number): Edit {
  const before = text.slice(0, at).replace(/\s+$/, "");
  const after = text.slice(at).replace(/^\s+/, "");
  const head = before === "" ? "" : `${before}\n\n`;
  const body = `${SCENE_BREAK}\n\n`;
  const caret = head.length + body.length;
  return { text: `${head}${body}${after}`, start: caret, end: caret };
}

export interface OutlineItem {
  readonly kind: "heading" | "scene-break";
  /** 1–6 for a heading; 0 for a scene break, which has no depth. */
  readonly level: number;
  readonly label: string;
  /** Character offset of the start of the line, in the text given. */
  readonly offset: number;
  readonly line: number;
}

/**
 * The document's own structure, read from the prose.
 *
 * A chapter's headings and scene breaks _are_ its outline; asking the writer to
 * maintain a second one somewhere else is how the two end up disagreeing. Fenced
 * code blocks are skipped so a research note full of examples does not fill the
 * outline with `#` comments.
 */
export function outlineOf(text: string): readonly OutlineItem[] {
  const items: OutlineItem[] = [];
  let offset = 0;
  let fenced = false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading !== null) {
        items.push({
          kind: "heading",
          level: heading[1]?.length ?? 1,
          label: (heading[2] ?? "").trim(),
          offset,
          line: i,
        });
      } else if (SCENE_BREAK_LINE.test(line) && line.trim() !== "") {
        items.push({ kind: "scene-break", level: 0, label: "Scene break", offset, line: i });
      }
    }
    offset += line.length + 1;
  }
  return items;
}

/**
 * Words, counted the way a writer means it.
 *
 * Markdown markers, heading hashes and blockquote arrows are punctuation of the
 * format rather than words of the book, so they are removed before counting. A
 * writer with a daily target should not be able to hit it by adding bullets.
 */
export function countWords(text: string): number {
  const prose = text
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    .map((line) => (SCENE_BREAK_LINE.test(line) ? "" : line))
    .join("\n")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .trim();
  if (prose === "") return 0;
  return prose.split(/\s+/).length;
}

export function countCharacters(text: string): number {
  return text.length;
}

export interface Match {
  readonly start: number;
  readonly end: number;
}

export interface FindOptions {
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
}

/**
 * Every occurrence of a query, as ranges into the text.
 *
 * Plain string matching, deliberately: a writer typing `?` into Find means a
 * question mark. Regular expressions are a power-user feature that would turn
 * ordinary punctuation into syntax errors.
 */
export function findMatches(text: string, query: string, options: FindOptions = {}): Match[] {
  if (query === "") return [];
  const hay = options.caseSensitive === true ? text : text.toLowerCase();
  const needle = options.caseSensitive === true ? query : query.toLowerCase();
  const found: Match[] = [];
  let at = hay.indexOf(needle);
  while (at !== -1) {
    const end = at + needle.length;
    if (options.wholeWord !== true || isWordBounded(hay, at, end)) found.push({ start: at, end });
    // Overlapping matches are not useful in prose and make replace-all
    // ambiguous, so the scan continues past the match it just took.
    at = hay.indexOf(needle, end === at ? at + 1 : end);
  }
  return found;
}

function isWordBounded(text: string, start: number, end: number): boolean {
  const before = start === 0 ? "" : (text[start - 1] ?? "");
  const after = text[end] ?? "";
  return !/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after);
}

/** The match at or after a caret, wrapping to the start. Used by Find next. */
export function nextMatch(matches: readonly Match[], from: number): number {
  if (matches.length === 0) return -1;
  const at = matches.findIndex((match) => match.start >= from);
  return at === -1 ? 0 : at;
}

export function previousMatch(matches: readonly Match[], from: number): number {
  if (matches.length === 0) return -1;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i];
    if (match !== undefined && match.end <= from) return i;
  }
  return matches.length - 1;
}

/** Replace one match, returning the text and where the caret should land. */
export function replaceMatch(text: string, match: Match, replacement: string): Edit {
  return {
    text: text.slice(0, match.start) + replacement + text.slice(match.end),
    start: match.start + replacement.length,
    end: match.start + replacement.length,
  };
}

/**
 * Replace every match in one pass.
 *
 * Right to left, so each replacement cannot move the offsets of the matches not
 * yet applied — the ordinary source of an off-by-one that eats a character in
 * somebody's novel.
 */
export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  options: FindOptions = {},
): { text: string; count: number } {
  const matches = findMatches(text, query, options);
  let next = text;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const match = matches[i];
    /* istanbul ignore next — the index comes from the array's own length. */
    if (match === undefined) continue;
    next = next.slice(0, match.start) + replacement + next.slice(match.end);
  }
  return { text: next, count: matches.length };
}
