import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_STYLE,
  LIMITS,
  repairStyle,
  styleVariables,
  type ManuscriptStyle,
} from "./typography";
import { COALESCE_MS, MAX_ENTRIES, UndoStack } from "./undo";
import {
  EMPTY_STATE,
  forgetWorkspaceState,
  loadWorkspaceState,
  saveWorkspaceState,
} from "./workspace-state";

describe("manuscript typography is the writer's, within limits", () => {
  it("clamps every setting rather than rendering something unreadable", () => {
    const absurd = repairStyle({ size: 400, lineHeight: 0.1, measure: 900, paragraphSpacing: -4 });
    expect(absurd.size).toBe(LIMITS.size.max);
    expect(absurd.lineHeight).toBe(LIMITS.lineHeight.min);
    expect(absurd.measure).toBe(LIMITS.measure.max);
    expect(absurd.paragraphSpacing).toBe(LIMITS.paragraphSpacing.min);
  });

  it("falls back to the default for anything it cannot read", () => {
    for (const value of [null, undefined, 3, "serif", [], { face: "comic" }, { size: "big" }]) {
      expect(repairStyle(value).face).toBe(DEFAULT_STYLE.face);
      expect(repairStyle(value).size).toBe(DEFAULT_STYLE.size);
    }
  });

  it("keeps a valid style exactly as given", () => {
    const chosen: ManuscriptStyle = {
      face: "sans",
      size: 20,
      lineHeight: 1.6,
      paragraphSpacing: 0.5,
      measure: 72,
    };
    expect(repairStyle(chosen)).toEqual(chosen);
  });

  it("expresses the measure in characters so it survives a change of face", () => {
    // "68 characters" has to still mean 68 characters after the writer switches
    // typeface or size, which is the only reason `ch` is the right unit.
    const vars = styleVariables({ ...DEFAULT_STYLE, measure: 68 });
    expect(vars["--manuscript-measure"]).toBe("68ch");
    expect(styleVariables({ ...DEFAULT_STYLE, face: "mono" })["--manuscript-face"]).toContain(
      "mono",
    );
  });

  it("produces a complete set of variables", () => {
    const vars = styleVariables(DEFAULT_STYLE);
    for (const key of [
      "--manuscript-face",
      "--manuscript-size",
      "--manuscript-leading",
      "--manuscript-paragraph",
      "--manuscript-measure",
    ]) {
      expect(vars[key]).toBeTruthy();
    }
  });
});

describe("undo survives a formatting command", () => {
  const snap = (text: string, caret = text.length) => ({ text, start: caret, end: caret });

  it("coalesces a run of typing into one step", () => {
    const stack = new UndoStack(snap(""), 0);
    stack.push(snap("H"), "typing", 10);
    stack.push(snap("He"), "typing", 20);
    stack.push(snap("Hell"), "typing", 30);
    stack.push(snap("Hello"), "typing", 40);
    expect(stack.depth).toBe(1);
    expect(stack.undo()?.text).toBe("");
  });

  it("breaks the run at a pause", () => {
    const stack = new UndoStack(snap(""), 0);
    stack.push(snap("One"), "typing", 10);
    stack.push(snap("One two"), "typing", 10 + COALESCE_MS + 1);
    expect(stack.undo()?.text).toBe("One");
  });

  it("undoes one paragraph at a time", () => {
    // Without the newline rule, a fast writer's whole page is one undo step.
    const stack = new UndoStack(snap(""), 0);
    stack.push(snap("Para one"), "typing", 10);
    stack.push(snap("Para one\n\n"), "typing", 20);
    stack.push(snap("Para one\n\nPara two"), "typing", 30);
    expect(stack.undo()?.text).toBe("Para one");
    expect(stack.undo()?.text).toBe("");
  });

  it("makes a command its own step, always", () => {
    // The reason this class exists: ⌘B then ⌘Z undoes the bold and nothing else.
    const stack = new UndoStack(snap("word"), 0);
    stack.push(snap("**word**"), "command", 1);
    expect(stack.undo()?.text).toBe("word");
    expect(stack.redo()?.text).toBe("**word**");
  });

  it("does not record a change that changed nothing", () => {
    const stack = new UndoStack(snap("word"), 0);
    stack.push({ text: "word", start: 0, end: 4 }, "typing", 1);
    expect(stack.canUndo).toBe(false);
    // The selection is still remembered, so redo lands where the writer was.
    expect(stack.value.end).toBe(4);
  });

  it("throws away the redo branch when new work is done", () => {
    const stack = new UndoStack(snap(""), 0);
    stack.push(snap("one"), "command", 1);
    stack.undo();
    expect(stack.canRedo).toBe(true);
    stack.push(snap("other"), "command", 2);
    expect(stack.canRedo).toBe(false);
  });

  it("reports nothing to undo at the bottom of the stack", () => {
    const stack = new UndoStack(snap("only"), 0);
    expect(stack.undo()).toBeNull();
    expect(stack.redo()).toBeNull();
  });

  it("stays bounded on a long session", () => {
    const stack = new UndoStack(snap(""), 0);
    for (let i = 1; i <= MAX_ENTRIES + 50; i += 1) stack.push(snap("x".repeat(i)), "command", i);
    expect(stack.depth).toBe(MAX_ENTRIES);
  });

  it("starts again when a different document is opened", () => {
    // Undoing across a file switch would write one chapter's words into another.
    const stack = new UndoStack(snap("chapter one"), 0);
    stack.push(snap("chapter one, edited"), "command", 1);
    stack.reset(snap("chapter two"), 2);
    expect(stack.canUndo).toBe(false);
    expect(stack.value.text).toBe("chapter two");
  });
});

/** A `localStorage` good enough to test against, with no browser involved. */
class MemoryStorage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}

describe("reopening a project returns the writer to their words", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    (globalThis as { window?: unknown }).window = { localStorage: storage };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("remembers the document and the place, per project", () => {
    saveWorkspaceState("/books/blackthorn", {
      path: "manuscript/CHAPTER_0004.md",
      caret: 1200,
      scroll: 0.4,
    });
    saveWorkspaceState("/books/other", { path: "notes/beats.md", caret: 3, scroll: 0 });
    expect(loadWorkspaceState("/books/blackthorn").path).toBe("manuscript/CHAPTER_0004.md");
    expect(loadWorkspaceState("/books/blackthorn").caret).toBe(1200);
    expect(loadWorkspaceState("/books/other").path).toBe("notes/beats.md");
  });

  it("returns an empty place for a project never opened", () => {
    expect(loadWorkspaceState("/books/new")).toEqual(EMPTY_STATE);
  });

  it("repairs nonsense rather than throwing on open", () => {
    storage.setItem("manu.workspace./books/bad", "{{{");
    expect(loadWorkspaceState("/books/bad")).toEqual(EMPTY_STATE);
    storage.setItem(
      "manu.workspace./books/odd",
      JSON.stringify({ path: 7, caret: -20, scroll: 9 }),
    );
    expect(loadWorkspaceState("/books/odd")).toEqual({ path: null, caret: 0, scroll: 1 });
  });

  it("forgets a project when asked", () => {
    saveWorkspaceState("/books/gone", { path: "notes/a.md", caret: 0, scroll: 0 });
    forgetWorkspaceState("/books/gone");
    expect(loadWorkspaceState("/books/gone")).toEqual(EMPTY_STATE);
  });

  it("does not grow without bound over years of projects", () => {
    for (let i = 0; i < 40; i += 1) {
      saveWorkspaceState(`/books/${i}`, { path: "notes/a.md", caret: 0, scroll: 0 });
    }
    const kept = storage.keys().filter((key) => key.startsWith("manu.workspace."));
    expect(kept.length).toBeLessThanOrEqual(20);
  });
});
