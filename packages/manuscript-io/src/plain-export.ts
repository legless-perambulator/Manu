import { plainText } from "./markdown-runs";
import { isSceneBreak } from "./text";
import { paragraphsOf } from "./docx-write";
import type { ExportManuscript } from "./types";

/** Markdown export (§31): the manuscript as portable, clean Markdown. */
export function exportMarkdown(manuscript: ExportManuscript): string {
  const parts: string[] = [`# ${manuscript.title}`, "", `by ${manuscript.author}`, ""];
  for (const chapter of manuscript.chapters) {
    parts.push(`## ${chapter.title}`, "", chapter.markdown, "");
  }
  return (
    parts
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}

/** Plain text export (§31): emphasis dropped, structure kept readable. */
export function exportPlainText(manuscript: ExportManuscript): string {
  const parts: string[] = [manuscript.title.toUpperCase(), `by ${manuscript.author}`, "", ""];
  for (const chapter of manuscript.chapters) {
    parts.push(chapter.title.toUpperCase(), "");
    for (const paragraph of paragraphsOf(chapter.markdown)) {
      parts.push(isSceneBreak(paragraph) ? "* * *" : plainText(paragraph), "");
    }
    parts.push("");
  }
  return (
    parts
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}
