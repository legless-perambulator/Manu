import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { EditRequest } from "@jellytind/editing";
import type { StoryRepository } from "@jellytind/story-repository";
import { SelectionBar } from "./SelectionBar";
import { FindBar, type Options as FindOptions } from "./FindBar";
import { ManuscriptPreview } from "./ManuscriptPreview";
import { clearDraft, findDraft, keepDraft } from "../lib/drafts";
import {
  countWords,
  insertSceneBreak,
  outlineOf,
  replaceAll as replaceAllIn,
  replaceMatch,
  setBlockStyle,
  toggleInline,
  type BlockStyle,
  type Edit,
  type InlineMark,
} from "../lib/markdown";
import { areaName, documentTitle, isProsePath } from "../lib/naming";
import { splitFrontMatter, titleOf } from "../lib/front-matter";
import { styleVariables, type ManuscriptStyle } from "../lib/typography";
import { UndoStack } from "../lib/undo";

interface Props {
  repo: StoryRepository;
  /** Project root, so drafts belong to the right book. */
  root: string;
  path: string | null;
  onSaved: () => void;
  /** Scene the author is working in, used to pick the context recipe. */
  sceneId?: string | null;
  /** Run an AI edit against the current selection. */
  onRunEdit?: (request: EditRequest) => void;
  aiBusy?: boolean;
  /** Told whenever there is unsaved prose, so switching versions can warn. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Given a flush function that saves now and resolves when it is safe to go. */
  onRegisterFlush?: (flush: (() => Promise<boolean>) | null) => void;
  /** How the writer has asked for the manuscript to be set. */
  style: ManuscriptStyle;
  /** Focus Mode: the page and nothing else. */
  focus?: boolean;
  onToggleFocus?: () => void;
  /** Live word count of the open document, for the status bar. */
  onWords?: (path: string, words: number) => void;
  /** Where the writer was, restored when a project is reopened. */
  initialCaret?: number;
  /** Told where the caret is now, so the place can be remembered. */
  onCaret?: (path: string, caret: number) => void;
}

/**
 * What the writer needs to know about their words, and nothing more.
 *
 * `conflict` is the state the audit's P0 produced silently: the file changed
 * underneath Manu. It is the only one that stops autosave, because continuing
 * to write over somebody's other editor is exactly the harm being prevented.
 */
type SaveState = "saved" | "dirty" | "saving" | "failed" | "conflict";

const LABEL: Readonly<Record<SaveState, string>> = {
  saved: "Saved",
  dirty: "Unsaved",
  saving: "Saving…",
  failed: "Save failed",
  conflict: "Changed outside Manu",
};

/** Idle time before autosave runs. Long enough not to fight a fast typist. */
const AUTOSAVE_MS = 1200;

export function Editor({
  repo,
  root,
  path,
  onSaved,
  sceneId = null,
  onRunEdit,
  aiBusy = false,
  onDirtyChange,
  onRegisterFlush,
  style,
  focus = false,
  onToggleFocus,
  onWords,
  initialCaret,
  onCaret,
}: Props) {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [external, setExternal] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [selection, setSelection] = useState<{ text: string; start: number; end: number } | null>(
    null,
  );
  const [caret, setCaret] = useState(0);
  const [showFind, setShowFind] = useState(false);
  const [reading, setReading] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const area = useRef<HTMLTextAreaElement | null>(null);
  /** Characters of front matter the textarea is not showing. */
  const hidden = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Manu's own undo history.
   *
   * A textarea's built-in stack is emptied by any programmatic write, and every
   * formatting command, every Replace and every accepted proposal is one. Undo
   * has to survive them or a writer stops trusting ⌘Z (lib/undo.ts).
   */
  const history = useRef(new UndoStack({ text: "", start: 0, end: 0 }));

  // Latest values, for the flush that runs on close or when switching away.
  const latest = useRef({ path, content, state });
  latest.current = { path, content, state };

  const dirty = state === "dirty" || state === "failed" || state === "conflict";
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Manuscript prose is set as prose. The records that describe it are data,
  // and are set as data.
  const prose = path !== null && isProsePath(path);
  // Front matter is kept and rewritten, never shown. Only prose files hide it:
  // in a `.json` record the structure *is* the content.
  const { head, body } = prose ? splitFrontMatter(content) : { head: "", body: content };
  hidden.current = head.length;

  const words = useMemo(() => (prose ? countWords(body) : 0), [prose, body]);
  useEffect(() => {
    if (path !== null && loaded) onWords?.(path, words);
  }, [path, words, loaded, onWords]);

  const outline = useMemo(() => (prose ? outlineOf(body) : []), [prose, body]);

  /**
   * Apply an edit to the prose, keeping everything else true.
   *
   * One funnel for every programmatic change — formatting, replace, scene break
   * — so each of them records an undo step, marks the document dirty, schedules
   * the same autosave and restores the selection the writer expects. A second
   * path here is how one of those four gets forgotten.
   */
  const applyEdit = useCallback(
    (edit: Edit) => {
      const next = head + edit.text;
      setContent(next);
      history.current.push({ text: edit.text, start: edit.start, end: edit.end }, "command");
      if (state !== "conflict") setState("dirty");
      scheduleSaveRef.current?.(next);
      // The textarea has not re-rendered yet, so the selection is restored on
      // the next frame — the ordinary React ordering, made explicit.
      requestAnimationFrame(() => {
        const el = area.current;
        if (el === null) return;
        el.focus();
        el.setSelectionRange(edit.start, edit.end);
        captureSelection();
      });
    },
    // `captureSelection` is hoisted and the save scheduler is held in a ref,
    // so neither belongs in this dependency list.
    [head, state],
  );

  /**
   * Track the selection so an AI edit can address exactly that range.
   *
   * Offsets are shifted by the hidden front matter, because an edit request
   * addresses the *file* and the textarea only holds the prose. Getting this
   * wrong would rewrite the wrong characters, so it is asserted in the tests.
   */
  function captureSelection() {
    const el = area.current;
    if (el === null) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const shift = hidden.current;
    setCaret(start);
    if (path !== null) onCaret?.(path, start);
    setSelection(
      start === end
        ? null
        : { text: el.value.slice(start, end), start: start + shift, end: end + shift },
    );
  }

  const save = useCallback(
    async (target?: { path: string; content: string }): Promise<boolean> => {
      const where = target?.path ?? latest.current.path;
      const what = target?.content ?? latest.current.content;
      if (where === null) return true;

      setState("saving");
      setError(null);
      try {
        await repo.writeProjectFile(where, what);
        clearDraft(root, where);
        setState("saved");
        onSaved();
        return true;
      } catch (e) {
        // An external-change refusal is not a failure to save; it is a
        // different question, and it needs a different answer from the writer.
        const message = e instanceof Error ? e.message : String(e);
        if (
          message.includes("modified by another application") ||
          message.includes("was deleted")
        ) {
          setExternal(await repo.readProjectFile(where).catch(() => null));
          setState("conflict");
        } else {
          setState("failed");
        }
        setError(message);
        return false;
      }
    },
    [repo, root, onSaved],
  );

  // Give the shell a way to force a save before it does something destructive.
  useEffect(() => {
    onRegisterFlush?.(async () => {
      if (latest.current.state === "saved" || latest.current.path === null) return true;
      return save();
    });
    return () => onRegisterFlush?.(null);
  }, [onRegisterFlush, save]);

  // Load, offering back anything a crash left behind.
  useEffect(() => {
    let active = true;
    if (timer.current !== null) clearTimeout(timer.current);
    setExternal(null);
    setRecovered(false);
    setShowFind(false);
    setSelection(null);
    if (path === null) {
      setContent("");
      setLoaded(false);
      setState("saved");
      return;
    }
    setLoaded(false);
    setError(null);
    repo
      .readProjectFile(path)
      .then((text) => {
        if (!active) return;
        const draft = findDraft(root, path);
        const recoveredDraft = draft !== null && draft.content !== (text ?? "");
        const loadedText = recoveredDraft ? draft.content : (text ?? "");
        setContent(loadedText);
        setRecovered(recoveredDraft);
        setState(recoveredDraft ? "dirty" : "saved");
        setLoaded(true);
        // History belongs to a document: undoing across a file switch would
        // write one chapter's words into another.
        const visible = isProsePath(path) ? splitFrontMatter(loadedText).body : loadedText;
        history.current.reset({ text: visible, start: 0, end: 0 });
        // Put the writer back where they were, clamped against a file that may
        // have got shorter since (§28).
        const place = Math.min(Math.max(0, initialCaret ?? 0), visible.length);
        requestAnimationFrame(() => {
          const el = area.current;
          if (el === null || place === 0) return;
          el.setSelectionRange(place, place);
          el.blur();
          el.focus();
        });
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
    // `initialCaret` is read once per document deliberately: it is where the
    // writer *was*, not a control that should move the caret while they write.
  }, [repo, path, root]);

  /** Debounced autosave. Never runs while a conflict is unresolved. */
  const scheduleSave = useCallback(
    (next: string) => {
      if (path === null) return;
      keepDraft({ root, path, content: next, at: new Date().toISOString() });
      if (timer.current !== null) clearTimeout(timer.current);
      if (state === "conflict") return;
      timer.current = setTimeout(() => {
        void save({ path, content: next });
      }, AUTOSAVE_MS);
    },
    [path, root, state, save],
  );
  const scheduleSaveRef = useRef(scheduleSave);
  scheduleSaveRef.current = scheduleSave;

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  /** Move the caret and bring it into view — used by Find and by the outline. */
  const goTo = useCallback((start: number, end: number) => {
    const el = area.current;
    if (el === null) return;
    el.focus();
    el.setSelectionRange(start, end);
    // A textarea will not scroll to a selection on its own. Scrolling by the
    // proportion of the document is close enough to land the line on screen and
    // costs nothing to compute.
    const ratio = el.value.length === 0 ? 0 : start / el.value.length;
    el.scrollTop = Math.max(0, ratio * el.scrollHeight - el.clientHeight / 2);
  }, []);

  const runUndo = useCallback(
    (direction: "undo" | "redo") => {
      const snapshot = direction === "undo" ? history.current.undo() : history.current.redo();
      if (snapshot === null) return;
      setContent(head + snapshot.text);
      if (state !== "conflict") setState("dirty");
      scheduleSaveRef.current(head + snapshot.text);
      requestAnimationFrame(() => {
        const el = area.current;
        if (el === null) return;
        el.focus();
        el.setSelectionRange(snapshot.start, snapshot.end);
      });
    },
    [head, state],
  );

  const format = useCallback(
    (mark: InlineMark) => {
      const el = area.current;
      if (el === null) return;
      applyEdit(toggleInline(el.value, el.selectionStart, el.selectionEnd, mark));
    },
    [applyEdit],
  );

  const block = useCallback(
    (blockStyle: BlockStyle) => {
      const el = area.current;
      if (el === null) return;
      applyEdit(setBlockStyle(el.value, el.selectionStart, el.selectionEnd, blockStyle));
    },
    [applyEdit],
  );

  const sceneBreak = useCallback(() => {
    const el = area.current;
    if (el === null) return;
    applyEdit(insertSceneBreak(el.value, el.selectionStart));
  }, [applyEdit]);

  /**
   * The editor's own keyboard layer.
   *
   * Bound to the textarea rather than the window, so the workbench's shortcuts
   * and the manuscript's cannot fight over the same chord depending on focus.
   */
  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const chord = event.metaKey || event.ctrlKey;
    if (!chord) return;
    const key = event.key.toLowerCase();
    const shift = event.shiftKey;
    const alt = event.altKey;

    const run = (fn: () => void) => {
      event.preventDefault();
      fn();
    };

    if (key === "s" && !shift) return run(() => void save());
    if (key === "b" && !shift && !alt) return run(() => format("bold"));
    if (key === "i" && !shift && !alt) return run(() => format("italic"));
    if (key === "x" && shift) return run(() => format("strikethrough"));
    if (key === "f" && !shift) return run(() => setShowFind(true));
    if (key === "z" && !shift) return run(() => runUndo("undo"));
    if ((key === "z" && shift) || (key === "y" && !shift)) return run(() => runUndo("redo"));
    if (key === "." && shift) return run(() => block("quote"));
    if (key === "8" && shift) return run(() => block("bullets"));
    if (key === "7" && shift) return run(() => block("numbers"));
    // ⌘⏎, not ⌘⇧⏎ — the shifted chord is Focus Mode, and two handlers racing
    // over one chord is how a scene break lands in a focused window.
    if (key === "enter" && !shift) return run(sceneBreak);
    if (alt && ["1", "2", "3", "0"].includes(key)) {
      const styles: Record<string, BlockStyle> = {
        "1": "heading1",
        "2": "heading2",
        "3": "heading3",
        "0": "body",
      };
      const chosen = styles[key];
      if (chosen !== undefined) return run(() => block(chosen));
    }
  }

  if (path === null) {
    return (
      <div className="editor editor--empty">
        <div className="empty">
          <p className="empty__title">Nothing open</p>
          <p className="empty__body">
            Pick a chapter in Manuscript to start writing, or press <kbd className="kbd">⌘K</kbd> to
            go anywhere in the project.
          </p>
        </div>
      </div>
    );
  }

  const title = documentTitle(path, titleOf(head));

  return (
    <div
      className={`editor${focus ? " editor--focus" : ""}`}
      style={styleVariables(style) as CSSProperties}
    >
      <div className="editor__bar">
        {/*
          What you are writing, not where it is stored. The full path is still
          one hover away — a writer thinks in chapters, and the file is an
          implementation detail of the promise that the file is plain.
        */}
        <span className="editor__where" title={path}>
          <span className="editor__name">{title}</span>
          {!focus && <span className="editor__folder">{areaName(path)}</span>}
        </span>
        <span className="editor__spacer" />
        {/* In Focus Mode "Saved" is noise; anything else is still worth saying. */}
        <span className={`editor__state editor__state--${state}`} role="status">
          {focus && state === "saved" ? "" : LABEL[state]}
        </span>
        {!focus && prose && outline.length > 0 && (
          <button
            className={`btn btn--ghost btn--small${showOutline ? " btn--on" : ""}`}
            aria-expanded={showOutline}
            onClick={() => setShowOutline((on) => !on)}
            title="This document's headings and scene breaks"
          >
            Sections
          </button>
        )}
        {!focus && prose && (
          <button
            className={`btn btn--ghost btn--small${reading ? " btn--on" : ""}`}
            aria-pressed={reading}
            onClick={() => setReading((on) => !on)}
            title="Read the chapter as a formatted page"
          >
            {reading ? "Write" : "Read"}
          </button>
        )}
        {onToggleFocus !== undefined && (
          <button
            className="btn btn--ghost btn--small"
            onClick={onToggleFocus}
            title={focus ? "Leave Focus — Esc" : "Focus Mode — ⌘⇧Return"}
          >
            {focus ? "Leave Focus" : "Focus"}
          </button>
        )}
      </div>

      {showOutline && outline.length > 0 && (
        <nav className="editor__sections" aria-label="Sections of this document">
          {outline.map((item) => (
            <button
              key={`${item.offset}-${item.label}`}
              className={`editor__section editor__section--${item.kind} editor__section--l${item.level}`}
              onClick={() => goTo(item.offset, item.offset)}
            >
              {item.kind === "scene-break" ? "· · ·" : item.label}
            </button>
          ))}
        </nav>
      )}

      {recovered && (
        <p className="editor__notice" role="status">
          Recovered unsaved text from your last session. Saving keeps it; reopening the file without
          saving discards it.
        </p>
      )}

      {state === "conflict" && (
        <section className="editor__conflict" role="alert">
          <p className="editor__conflict-title">This file changed outside Manu</p>
          <p className="editor__conflict-body">
            Another application modified <strong>{title}</strong> after Manu loaded it. Your unsaved
            text is still here and nothing has been overwritten.
          </p>
          {external !== null && (
            <details className="editor__conflict-diff">
              <summary>What is on disk now ({external.length} characters)</summary>
              <pre>{external.slice(0, 4000)}</pre>
            </details>
          )}
          <div className="editor__conflict-actions">
            <button
              className="btn btn--small"
              onClick={() =>
                void repo.acceptExternalChange(path).then((text) => {
                  setContent(text ?? "");
                  setExternal(null);
                  setState("saved");
                  setError(null);
                  clearDraft(root, path);
                })
              }
            >
              Use the version on disk
            </button>
            <button
              className="btn btn--small btn--danger"
              onClick={() =>
                void repo
                  .overwriteProjectFile(path, content)
                  .then(() => {
                    clearDraft(root, path);
                    setExternal(null);
                    setState("saved");
                    setError(null);
                    onSaved();
                  })
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
              }
            >
              Keep my version and overwrite
            </button>
          </div>
          <p className="hint">
            Overwriting is recorded in History, so the version on disk can be recovered afterwards.
          </p>
        </section>
      )}

      {error !== null && state !== "conflict" && (
        <p className="editor__error" role="alert">
          {error}
        </p>
      )}

      {showFind && (
        <FindBar
          text={body}
          caret={caret}
          onGo={(match) => goTo(match.start, match.end)}
          onReplace={(match, replacement) => applyEdit(replaceMatch(body, match, replacement))}
          onReplaceAll={(query, replacement, options: FindOptions) => {
            const result = replaceAllIn(body, query, replacement, options);
            if (result.count > 0) applyEdit({ text: result.text, start: 0, end: 0 });
          }}
          onClose={() => {
            setShowFind(false);
            area.current?.focus();
          }}
        />
      )}

      {selection !== null && selection.text.trim() !== "" && !reading && (
        <SelectionBar
          selection={selection}
          path={path}
          sceneId={sceneId}
          aiBusy={aiBusy}
          dirty={dirty}
          onFormat={format}
          onBlock={block}
          onRunEdit={onRunEdit}
        />
      )}

      {reading ? (
        <div className="editor__reading">
          <ManuscriptPreview text={body} />
        </div>
      ) : (
        <textarea
          ref={area}
          className={`editor__area${prose ? " editor__area--prose" : " editor__area--data"}`}
          aria-label={title}
          value={body}
          spellCheck={prose}
          disabled={!loaded}
          onSelect={captureSelection}
          onBlur={captureSelection}
          onChange={(e) => {
            const next = head + e.target.value;
            setContent(next);
            history.current.push({
              text: e.target.value,
              start: e.target.selectionStart,
              end: e.target.selectionEnd,
            });
            if (state !== "conflict") setState("dirty");
            setSelection(null);
            scheduleSave(next);
          }}
          onKeyDown={onKeyDown}
        />
      )}

      {prose && !focus && (
        <div className="editor__foot">
          <span className="editor__words">
            {words.toLocaleString()} {words === 1 ? "word" : "words"}
          </span>
        </div>
      )}
    </div>
  );
}

/*
 * `splitFrontMatter` and `titleOf` live in `lib/front-matter.ts` and are
 * re-exported here, because the tests that guard the hidden-offset behaviour
 * were written against this module and the panels need the same split to count
 * words. One implementation, two consumers.
 */
export { splitFrontMatter, titleOf };
