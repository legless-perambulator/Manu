import { useEffect, useRef, useState } from "react";
import type { EditRequest } from "@jellytind/editing";
import type { StoryRepository } from "@jellytind/story-repository";
import { AiEditBar } from "./AiEditBar";

interface Props {
  repo: StoryRepository;
  path: string | null;
  onSaved: () => void;
  /** Scene the author is working in, used to pick the context recipe. */
  sceneId?: string | null;
  /** Run an AI edit against the current selection. */
  onRunEdit?: (request: EditRequest) => void;
  aiBusy?: boolean;
}

export function Editor({ repo, path, onSaved, sceneId = null, onRunEdit, aiBusy = false }: Props) {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ text: string; start: number; end: number } | null>(
    null,
  );
  const area = useRef<HTMLTextAreaElement | null>(null);

  /** Track the selection so an AI edit can address exactly that range. */
  function captureSelection() {
    const el = area.current;
    if (el === null) return;
    const { selectionStart: start, selectionEnd: end } = el;
    setSelection(start === end ? null : { text: el.value.slice(start, end), start, end });
  }

  useEffect(() => {
    let active = true;
    if (path === null) {
      setContent("");
      setLoaded(false);
      setDirty(false);
      return;
    }
    setLoaded(false);
    setError(null);
    repo
      .readProjectFile(path)
      .then((text) => {
        if (!active) return;
        setContent(text ?? "");
        setLoaded(true);
        setDirty(false);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      active = false;
    };
  }, [repo, path]);

  async function save() {
    if (path === null) return;
    setSaving(true);
    setError(null);
    try {
      await repo.writeProjectFile(path, content);
      setDirty(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (path === null) {
    return (
      <div className="editor editor--empty">
        <p className="placeholder">Select a file from the project explorer to start editing.</p>
      </div>
    );
  }

  return (
    <div className="editor">
      <div className="editor__bar">
        <span className="editor__path">
          {path}
          {dirty ? " •" : ""}
        </span>
        <button
          className="btn btn--primary"
          onClick={() => void save()}
          disabled={!dirty || saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {error !== null && <p className="editor__error">{error}</p>}
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
        className="editor__area"
        value={content}
        spellCheck={false}
        disabled={!loaded}
        onSelect={captureSelection}
        onBlur={captureSelection}
        onChange={(e) => {
          setContent(e.target.value);
          setDirty(true);
          setSelection(null);
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
