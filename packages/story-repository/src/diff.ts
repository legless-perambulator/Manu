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

// ── Hunks ───────────────────────────────────────────────────────────────────

/**
 * A contiguous run of changed lines, with the surrounding context stripped.
 *
 * Hunks are what makes *partial* acceptance of an AI edit possible: a reviewer
 * takes the two sentences that improved the scene and leaves the paragraph that
 * did not, instead of facing an all-or-nothing choice.
 */
export interface DiffHunk {
  /** Stable within one diff, so a UI can track selections. */
  readonly id: string;
  /** Index of the hunk's first line in the diff. */
  readonly at: number;
  readonly lines: readonly DiffLine[];
  readonly added: number;
  readonly removed: number;
}

/** Group a diff's changed lines into hunks, in order. */
export function buildHunks(lines: readonly DiffLine[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let run: DiffLine[] = [];
  let start = 0;

  const flush = (): void => {
    if (run.length === 0) return;
    hunks.push({
      id: `h${String(hunks.length + 1)}`,
      at: start,
      lines: run,
      added: run.filter((l) => l.op === "add").length,
      removed: run.filter((l) => l.op === "remove").length,
    });
    run = [];
  };

  lines.forEach((line, index) => {
    if (line.op === "context") {
      flush();
      return;
    }
    if (run.length === 0) start = index;
    run.push(line);
  });
  flush();
  return hunks;
}

/**
 * Rebuild the text that results from accepting only some hunks.
 *
 * Accepting every hunk returns `after` byte-for-byte and accepting none returns
 * `before`, so the common cases are exact rather than reconstructed. A partial
 * selection is rebuilt from the diff: accepted hunks contribute their additions,
 * rejected hunks keep their removals.
 */
export function applyHunks(
  before: string,
  after: string,
  acceptedHunkIds: readonly string[],
): string {
  const lines = computeLineDiff(before, after);
  const hunks = buildHunks(lines);
  const accepted = new Set(acceptedHunkIds);

  if (hunks.every((h) => accepted.has(h.id))) return after;
  if (hunks.every((h) => !accepted.has(h.id))) return before;

  const acceptedAt = new Map(hunks.map((h) => [h.at, accepted.has(h.id)]));
  const out: string[] = [];
  let inHunk = false;
  let keepAdds = false;

  lines.forEach((line, index) => {
    if (line.op === "context") {
      inHunk = false;
      out.push(line.text);
      return;
    }
    if (!inHunk) {
      inHunk = true;
      keepAdds = acceptedAt.get(index) ?? false;
    }
    if (line.op === "add" ? keepAdds : !keepAdds) out.push(line.text);
  });

  const text = out.join("\n");
  return after.endsWith("\n") || before.endsWith("\n") ? `${text}\n` : text;
}
