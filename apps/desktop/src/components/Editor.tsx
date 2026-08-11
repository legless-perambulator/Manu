import { useEffect, useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";

interface Props {
  repo: StoryRepository;
  path: string | null;
  onSaved: () => void;
}

export function Editor({ repo, path, onSaved }: Props) {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <textarea
        className="editor__area"
        value={content}
        spellCheck={false}
        disabled={!loaded}
        onChange={(e) => {
          setContent(e.target.value);
          setDirty(true);
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
