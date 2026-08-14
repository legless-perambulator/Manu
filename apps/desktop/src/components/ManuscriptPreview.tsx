import { Fragment, type ReactNode } from "react";
import { parseBlocks, type BlockNode, type InlineNode } from "../lib/markdown-render";

interface Props {
  text: string;
}

/**
 * The chapter as a page, for reading.
 *
 * Manu writes plain text with its marks visible, because exact character
 * offsets are what make an AI edit address the right characters and a diff mean
 * anything. Reading is a different job, so the same file is also rendered as a
 * formatted page — headings sized, emphasis set, scene breaks drawn, the
 * measure the writer chose.
 *
 * Read-only by construction, and built from a closed node union rather than
 * markup: nothing here uses `dangerouslySetInnerHTML`, so a chapter containing
 * `<script>` renders as the characters `<script>` (lib/markdown-render.ts).
 */
export function ManuscriptPreview({ text }: Props) {
  const blocks = parseBlocks(text);

  if (blocks.length === 0) {
    return (
      <div className="preview">
        <p className="preview__empty">Nothing written here yet.</p>
      </div>
    );
  }

  return (
    <article className="preview">
      {blocks.map((block, index) => (
        <Fragment key={index}>{renderBlock(block)}</Fragment>
      ))}
    </article>
  );
}

function renderBlock(block: BlockNode): ReactNode {
  switch (block.kind) {
    case "heading": {
      const children = inline(block.children);
      const level = Math.min(6, Math.max(1, block.level));
      // A chapter's own headings are content, not document structure, so they
      // are levelled below the application's own headings.
      if (level === 1) return <h2 className="preview__h1">{children}</h2>;
      if (level === 2) return <h3 className="preview__h2">{children}</h3>;
      return <h4 className="preview__h3">{children}</h4>;
    }
    case "paragraph":
      return <p className="preview__p">{inline(block.children)}</p>;
    case "quote":
      return <blockquote className="preview__quote">{inline(block.children)}</blockquote>;
    case "list":
      return block.ordered ? (
        <ol className="preview__list">
          {block.items.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul className="preview__list">
          {block.items.map((item, index) => (
            <li key={index}>{inline(item)}</li>
          ))}
        </ul>
      );
    case "scene-break":
      return <hr className="preview__break" />;
  }
}

function inline(nodes: readonly InlineNode[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "strong":
        return <strong key={index}>{inline(node.children)}</strong>;
      case "emphasis":
        return <em key={index}>{inline(node.children)}</em>;
      case "strike":
        return <s key={index}>{inline(node.children)}</s>;
      case "code":
        return (
          <code key={index} className="preview__code">
            {node.text}
          </code>
        );
    }
  });
}
