/** Inline Markdown emphasis, parsed once for every exporter that needs runs. */

export interface EmphasisRun {
  readonly text: string;
  readonly italic: boolean;
  readonly bold: boolean;
}

/** `plain *it* **bold** ***both***` → runs. Unclosed markers stay literal. */
export function runsFromMarkdown(line: string): EmphasisRun[] {
  const runs: EmphasisRun[] = [];
  const pattern = /(\*{1,3})([^*]+)\1/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) {
      runs.push({ text: line.slice(last, match.index), italic: false, bold: false });
    }
    const stars = (match[1] as string).length;
    runs.push({
      text: match[2] as string,
      italic: stars === 1 || stars === 3,
      bold: stars >= 2,
    });
    last = match.index + (match[0] as string).length;
  }
  if (last < line.length) {
    runs.push({ text: line.slice(last), italic: false, bold: false });
  }
  return runs.filter((run) => run.text !== "");
}

/** Markdown stripped to plain prose, for formats that carry no emphasis. */
export function plainText(line: string): string {
  return runsFromMarkdown(line)
    .map((run) => run.text)
    .join("");
}
