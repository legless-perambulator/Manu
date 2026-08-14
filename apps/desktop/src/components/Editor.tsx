import { useCallback, useEffect, useRef, useState } from "react";
import type { EditRequest } from "@jellytind/editing";
import type { StoryRepository } from "@jellytind/story-repository";
import { AiEditBar } from "./AiEditBar";
import { clearDraft, findDraft, keepDraft } from "../lib/drafts";

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
  const area = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest values, for the flush that runs on close or when switching away.
  const latest = useRef({ path, content, state });
  latest.current = { path, content, state };

  const dirty = state === "dirty" || state === "failed" || state === "conflict";
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  /** Track the selection so an AI edit can address exactly that range. */
  function captureSelection() {
    const el = area.current;
    if (el === null) return;
    const { selectionStart: start, selectionEnd: end } = el;
    setSelection(start === end ? null : { text: el.value.slice(start, end), start, end });
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
        if (draft !== null && draft.content !== (text ?? "")) {
          setContent(draft.content);
          setRecovered(true);
          setState("dirty");
        } else {
          setContent(text ?? "");
          setState("saved");
        }
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [repo, path, root]);

  /** Debounced autosave. Never runs while a conflict is unresolved. */
  function scheduleSave(next: string) {
    if (path === null) return;
    keepDraft({ root, path, content: next, at: new Date().toISOString() });
    if (timer.current !== null) clearTimeout(timer.current);
    if (state === "conflict") return;
    timer.current = setTimeout(() => {
      void save({ path, content: next });
    }, AUTOSAVE_MS);
  }

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  if (path === null) {
    return (
      <div className="editor editor--empty">
        <div className="empty">
          <p className="empty__title">Nothing open</p>
          <p className="empty__body">
            Pick a chapter in Files to start writing, or press <kbd className="kbd">⌘K</kbd> to go
            anywhere in the project.
          </p>
        </div>
      </div>
    );
  }

  // Manuscript prose is set as prose. The records that describe it are data,
  // and are set as data.
  const prose = path.startsWith("manuscript/");

  return (
    <div className="editor">
      <div className="editor__bar">
        <span className="editor__path" title={path}>
          {path}
          <span className={`editor__state editor__state--${state}`}>{LABEL[state]}</span>
        </span>
        <button
          className="btn btn--small"
          onClick={() => void save()}
          disabled={state === "saving"}
        >
          Save now
        </button>
      </div>

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
            Another application modified <strong>{path}</strong> after Manu loaded it. Your unsaved
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

      {onRunEdit !== undefined && (
        <AiEditBar
          selection={selection}
          path={path}
          sceneId={sceneId}
          busy={aiBusy}
          dirty={dirty}
          onRun={onRunEdit}
        />
      )}
      <textarea
        ref={area}
        className={`editor__area${prose ? " editor__area--prose" : " editor__area--data"}`}
        aria-label={path}
        value={content}
        spellCheck={prose}
        disabled={!loaded}
        onSelect={captureSelection}
        onBlur={captureSelection}
        onChange={(e) => {
          const next = e.target.value;
          setContent(next);
          if (state !== "conflict") setState("dirty");
          setSelection(null);
          scheduleSave(next);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            void save();
          }
        }}
      />
    </div>
  );
}
