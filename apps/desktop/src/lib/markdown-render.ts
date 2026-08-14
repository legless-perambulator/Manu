/**
 * Markdown → a small, closed document tree, for reading.
 *
 * The manuscript is written as plain text with visible marks, which is what
 * keeps character offsets exact for AI edits and diffs. Reading is a different
 * job from writing, so Manu also renders the same file as a formatted page —
 * headings sized, emphasis set, scene breaks drawn — and that rendering is
 * read-only by construction.
 *
 * This produces **data, not HTML**. Nothing here builds markup and nothing
 * downstream may use `dangerouslySetInnerHTML`: a manuscript is untrusted text
 * as far as the renderer is concerned, and a chapter containing `<script>`
 * must render as the characters `<script>`. The node kinds are a closed union
 * for the same reason the compiler's rules are a closed registry — the set of
 * things that can reach the screen is finite and reviewable.
 */

export type InlineNode =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly children: readonly InlineNode[] }
  | { readonly kind: "emphasis"; readonly children: readonly InlineNode[] }
  | { readonly kind: "strike"; readonly children: readonly InlineNode[] }
  | { readonly kind: "code"; readonly text: string };

export type BlockNode =
  | { readonly kind: "heading"; readonly level: number; readonly children: readonly InlineNode[] }
  | { readonly kind: "paragraph"; readonly children: readonly InlineNode[] }
  | { readonly kind: "quote"; readonly children: readonly InlineNode[] }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly InlineNode[])[];
    }
  | { readonly kind: "scene-break" };

const SCENE_BREAK_LINE = /^\s*(?:\*\s*\*\s*\*|-{3,}|#{3,}|\*{3,})\s*$/;

/**
 * Parse a manuscript into blocks.
 *
 * Deliberately a small subset: headings, paragraphs, blockquotes, lists and
 * scene breaks — the things a novel is made of. There is no table, no image, no
 * raw HTML and no link syntax, because none of them belong in prose and each
 * would be a surface to get wrong.
 */
export function parseBlocks(text: string): readonly BlockNode[] {
  const blocks: BlockNode[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    if (SCENE_BREAK_LINE.test(line)) {
      blocks.push({ kind: "scene-break" });
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      blocks.push({
        kind: "heading",
        level: heading[1]?.length ?? 1,
        children: parseInline((heading[2] ?? "").trim()),
      });
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? "")) {
        quoted.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", children: parseInline(quoted.join(" ").trim()) });
      continue;
    }

    const bullet = /^\s*[-*+]\s+/;
    const numbered = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const marker = ordered ? numbered : bullet;
      const items: (readonly InlineNode[])[] = [];
      while (i < lines.length && marker.test(lines[i] ?? "")) {
        items.push(parseInline((lines[i] ?? "").replace(marker, "")));
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    // A paragraph runs until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (
        next.trim() === "" ||
        SCENE_BREAK_LINE.test(next) ||
        /^(#{1,6})\s+/.test(next) ||
        /^\s*>\s?/.test(next) ||
        bullet.test(next) ||
        numbered.test(next)
      ) {
        break;
      }
      paragraph.push(next.trim());
      i += 1;
    }
    blocks.push({ kind: "paragraph", children: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}

interface Delimiter {
  readonly token: string;
  readonly kind: "strong" | "emphasis" | "strike";
}

/**
 * Longest token first, so `**` is never read as two `*`.
 *
 * `_` is offered for italic and `*` is not: a single asterisk in the middle of
 * prose is far more likely to be a writer's own mark than an emphasis
 * delimiter, and pairing it would silently italicise half a paragraph.
 */
const DELIMITERS: readonly Delimiter[] = [
  { token: "**", kind: "strong" },
  { token: "~~", kind: "strike" },
  { token: "_", kind: "emphasis" },
];

/**
 * Parse the inline marks of one block.
 *
 * An unmatched delimiter is text. That is the important case: a writer typing
 * `**` and being interrupted should see two asterisks, not have the rest of the
 * chapter turn bold.
 */
export function parseInline(text: string): readonly InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer !== "") {
      nodes.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  let i = 0;
  while (i < text.length) {
    if (text[i] === "`") {
      const close = text.indexOf("`", i + 1);
      if (close !== -1) {
        flush();
        nodes.push({ kind: "code", text: text.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    const delimiter = DELIMITERS.find((entry) => text.startsWith(entry.token, i));
    if (delimiter !== undefined) {
      const close = findClosing(text, i + delimiter.token.length, delimiter.token);
      if (close !== -1) {
        flush();
        const inner = text.slice(i + delimiter.token.length, close);
        nodes.push({ kind: delimiter.kind, children: parseInline(inner) });
        i = close + delimiter.token.length;
        continue;
      }
    }

    buffer += text[i];
    i += 1;
  }

  flush();
  return nodes;
}

/** A closing delimiter must not be preceded by a space: `_ x_` is not italic. */
function findClosing(text: string, from: number, token: string): number {
  let at = text.indexOf(token, from);
  while (at !== -1) {
    const before = text[at - 1] ?? "";
    if (at > from && !/\s/.test(before)) return at;
    at = text.indexOf(token, at + 1);
  }
  return -1;
}

/** The plain words of an inline tree — used by tests and by accessible labels. */
export function plainTextOf(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) =>
      node.kind === "text" || node.kind === "code" ? node.text : plainTextOf(node.children),
    )
    .join("");
}
