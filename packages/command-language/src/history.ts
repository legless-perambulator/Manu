import type { Invocation } from "./types";

/**
 * Local command history (§10).
 *
 * A bounded list of lines with an arrow-key cursor, held by the terminal and
 * persisted by the host in localStorage. Two rules keep it safe to persist:
 * lines are stored as typed (never any command's *output*), and a line whose
 * invocation carried a `sensitive` option value is not stored at all.
 */
export class CommandHistory {
  private lines: string[];
  private readonly limit: number;
  /** null = not navigating; otherwise an index into `lines`. */
  private cursor: number | null = null;
  /** What was in the input when navigation started, restored by ArrowDown. */
  private draft = "";

  constructor(initial: readonly string[] = [], limit = 200) {
    this.limit = Math.max(1, limit);
    this.lines = initial.slice(-this.limit);
  }

  /** Record a line. Consecutive duplicates collapse, as a shell's history does. */
  push(line: string): void {
    const trimmed = line.trim();
    if (trimmed === "" || this.lines[this.lines.length - 1] === trimmed) {
      this.cursor = null;
      return;
    }
    this.lines.push(trimmed);
    if (this.lines.length > this.limit) this.lines = this.lines.slice(-this.limit);
    this.cursor = null;
  }

  /** ArrowUp: the previous line, remembering the in-progress draft. */
  previous(current: string): string | null {
    if (this.lines.length === 0) return null;
    if (this.cursor === null) {
      this.draft = current;
      this.cursor = this.lines.length - 1;
    } else if (this.cursor > 0) {
      this.cursor -= 1;
    }
    return this.lines[this.cursor] ?? null;
  }

  /** ArrowDown: forward again, ending at the draft the writer was typing. */
  next(): string | null {
    if (this.cursor === null) return null;
    if (this.cursor < this.lines.length - 1) {
      this.cursor += 1;
      return this.lines[this.cursor] ?? null;
    }
    this.cursor = null;
    return this.draft;
  }

  entries(): readonly string[] {
    return this.lines;
  }
}

/** True when a parsed line set any option marked `sensitive` — do not store it. */
export function carriesSensitiveValue(invocation: Invocation): boolean {
  return invocation.spec.options.some(
    (option) => option.sensitive === true && invocation.options[option.name] !== undefined,
  );
}
