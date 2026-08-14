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
  /** Characters of front matter the textarea is not showing. */
  const hidden = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest values, for the flush that runs on close or when switching away.
  const latest = useRef({ path, content, state });
  latest.current = { path, content, state };

  const dirty = state === "dirty" || state === "failed" || state === "conflict";
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

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
  // Front matter is kept and rewritten, never shown. Only prose files hide it:
  // in a `.json` record the structure *is* the content.
  const { head, body } = prose ? splitFrontMatter(content) : { head: "", body: content };
  hidden.current = head.length;

  return (
    <div className="editor">
      <div className="editor__bar">
        {/*
          What you are writing, not where it is stored. The full path is still
          one hover away — a writer thinks in chapters, and the file is an
          implementation detail of the promise that the file is plain.
        */}
        <span className="editor__where" title={path}>
          <span className="editor__name">{titleOf(head) ?? fileLabel(path)}</span>
          <span className="editor__folder">{folderOf(path)}</span>
        </span>
        <span className="editor__spacer" />
        <span className={`editor__state editor__state--${state}`} role="status">
          {LABEL[state]}
        </span>
        <button
          className="btn btn--ghost btn--small"
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
        value={body}
        spellCheck={prose}
        disabled={!loaded}
        onSelect={captureSelection}
        onBlur={captureSelection}
        onChange={(e) => {
          const next = head + e.target.value;
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

/**
 * Split a record file into its front matter and its prose.
 *
 * A chapter file carries a YAML block that keeps the record and the words in
 * one portable document — the thing that makes "plain files you own" true. A
 * writer should still not have to look at it: the audit's screenshot opens on
 * `---`, `id:`, `title:`, which is a manuscript that looks like source code.
 *
 * The head is preserved byte for byte and re-attached on every save, so what is
 * hidden is only hidden from the eye. If the block is malformed or absent, the
 * whole file is prose and nothing is hidden — guessing would be worse.
 */
export function splitFrontMatter(text: string): { head: string; body: string } {
  if (!text.startsWith("---")) return { head: "", body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { head: "", body: text };
  // Include the closing fence and the blank line that conventionally follows.
  const after = text.indexOf("\n", end + 1);
  if (after === -1) return { head: "", body: text };
  let cut = after + 1;
  if (text[cut] === "\n") cut += 1;
  return { head: text.slice(0, cut), body: text.slice(cut) };
}

/**
 * The chapter's own title, from its front matter.
 *
 * `CHAPTER_0001` is the file. "The Cellar Door" is what the writer called it,
 * and it is what the bar should say.
 */
export function titleOf(head: string): string | null {
  const match = /^title:[ \t]*(.+)$/m.exec(head);
  const title = match?.[1]?.trim() ?? "";
  return title === "" ? null : title.replace(/^["']|["']$/g, "");
}

/** The file's own name, without its extension — a chapter reads as a chapter. */
function fileLabel(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.(md|json|txt|ya?ml)$/i, "");
}

/** Where it sits, said quietly beside the name. */
function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}
