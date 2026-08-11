/**
 * Minimal line-based diff (LCS) for the diff viewer. Deterministic and
 * dependency-free. Classifies each line as unchanged, added or removed;
 * a "modification" is rendered as a removed line followed by an added line.
 */

export type DiffOp = "context" | "add" | "remove";

export interface DiffLine {
  readonly op: DiffOp;
  readonly text: string;
}

export interface DiffStat {
  readonly added: number;
  readonly removed: number;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  return text.replace(/\n$/, "").split("\n");
}

/** Longest-common-subsequence line diff of two texts. */
export function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "context", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ op: "remove", text: a[i]! });
      i++;
    } else {
      out.push({ op: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ op: "remove", text: a[i++]! });
  while (j < m) out.push({ op: "add", text: b[j++]! });
  return out;
}

export function diffStat(lines: readonly DiffLine[]): DiffStat {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.op === "add") added++;
    else if (line.op === "remove") removed++;
  }
  return { added, removed };
}
