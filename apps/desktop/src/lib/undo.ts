/**
 * Undo that survives a formatting command.
 *
 * A browser textarea has its own undo stack, and it is good enough right up to
 * the moment something other than a keystroke changes the text. Setting `value`
 * from JavaScript — which is what every formatting command, every Replace and
 * every accepted AI edit does — silently empties it in most engines. A writer
 * who presses ⌘B and then ⌘Z would lose more than the bold.
 *
 * So Manu keeps its own history. Not a general-purpose one: a bounded stack of
 * snapshots of one document, with the two behaviours that make undo feel right
 * rather than merely correct.
 *
 * **Typing coalesces.** Thirty keystrokes in a sentence are one undo, not
 * thirty. Runs are broken by a pause, by a newline, and by anything that is not
 * typing — so ⌘Z after a formatting command undoes the formatting exactly, and
 * ⌘Z after a paragraph undoes the paragraph.
 *
 * **The stack is bounded.** A novel-length document held two hundred times over
 * is real memory. Old entries fall off the bottom; nobody undoes two hundred
 * steps, and the file on disk is the real safety net.
 */

export interface Snapshot {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** How the change arrived, which is what decides whether it can be coalesced. */
export type ChangeKind = "typing" | "command";

export const MAX_ENTRIES = 200;
/** A pause this long ends a typing run. Long enough to finish a sentence. */
export const COALESCE_MS = 900;

interface Entry {
  readonly snapshot: Snapshot;
  readonly kind: ChangeKind;
  readonly at: number;
}

export class UndoStack {
  private past: Entry[] = [];
  private future: Entry[] = [];
  private current: Entry;

  constructor(initial: Snapshot, now = Date.now()) {
    this.current = { snapshot: initial, kind: "command", at: now };
  }

  get value(): Snapshot {
    return this.current.snapshot;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** How many steps are held, for the tests and for nothing else. */
  get depth(): number {
    return this.past.length;
  }

  /**
   * Record a new state.
   *
   * A typing change that continues a recent typing run replaces the top of the
   * stack instead of pushing onto it. Anything else always pushes, so a command
   * is always undoable on its own.
   */
  push(snapshot: Snapshot, kind: ChangeKind = "typing", now = Date.now()): void {
    if (snapshot.text === this.current.snapshot.text) {
      // Selection moved but nothing changed. Worth remembering where the caret
      // is, not worth an undo step of its own.
      this.current = { ...this.current, snapshot };
      return;
    }
    this.future = [];
    if (!this.coalesces(kind, snapshot, now)) {
      this.past.push(this.current);
      if (this.past.length > MAX_ENTRIES) this.past.shift();
    }
    this.current = { snapshot, kind, at: now };
  }

  private coalesces(kind: ChangeKind, snapshot: Snapshot, now: number): boolean {
    if (kind !== "typing" || this.current.kind !== "typing") return false;
    if (now - this.current.at > COALESCE_MS) return false;
    // Pressing Enter ends the run, so undoing gives back one paragraph rather
    // than everything written since the last pause.
    return snapshot.text[snapshot.start - 1] !== "\n";
  }

  undo(): Snapshot | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(this.current);
    this.current = previous;
    return previous.snapshot;
  }

  redo(): Snapshot | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.current);
    this.current = next;
    return next.snapshot;
  }

  /**
   * Start again from a new document.
   *
   * Called when the editor opens a different file. History belongs to a
   * document: undoing across a file switch would write one chapter's words into
   * another, which is the kind of bug that ends up in a remediation register.
   */
  reset(snapshot: Snapshot, now = Date.now()): void {
    this.past = [];
    this.future = [];
    this.current = { snapshot, kind: "command", at: now };
  }
}
