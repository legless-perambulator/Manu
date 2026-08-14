import { useCallback, useEffect, useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import { documentName } from "../lib/naming";

interface Props {
  repo: StoryRepository;
  /** The folder this panel is a view of — `notes` or `research`. */
  folder: "notes" | "research";
  activePath: string | null;
  onOpenFile: (path: string) => void;
  refreshToken: number;
  onChanged: () => void;
}

const COPY: Readonly<Record<Props["folder"], { title: string; empty: string }>> = {
  notes: {
    title: "Notes",
    empty: "Anything you write to yourself lives here — ideas, questions, things to fix later.",
  },
  research: {
    title: "Research",
    empty: "What you looked up while writing: places, periods, procedures, names.",
  },
};

/**
 * Notes and research, as documents rather than files.
 *
 * These are real folders in the project — the writer can put anything in them
 * from outside Manu and it appears here. What changes is the presentation: a
 * file called `cellar_door-ideas.md` is listed as *Cellar door ideas*, and
 * opening it opens prose rather than a record.
 *
 * One component serves both because they are the same view of two folders.
 * Building two would guarantee they drifted.
 */
export function DocumentsPanel({
  repo,
  folder,
  activePath,
  onOpenFile,
  refreshToken,
  onChanged,
}: Props) {
  const [paths, setPaths] = useState<readonly string[] | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const files = await repo.listProjectFiles(folder);
    setPaths(files.filter((path) => /\.(md|txt)$/i.test(path)).sort());
  }, [repo, folder]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  async function create() {
    const trimmed = name.trim();
    if (trimmed === "") return;
    // The filename is derived from the title so the folder stays browsable from
    // outside Manu, which is the whole point of these being plain files.
    const slug = trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug === "") {
      setError("Give the document a name using letters or numbers.");
      return;
    }
    const path = `${folder}/${slug}.md`;
    setError(null);
    try {
      if ((await repo.readProjectFile(path)) !== null) {
        setError("There is already a document with that name.");
        return;
      }
      await repo.writeProjectFile(path, `# ${trimmed}\n\n`);
      setName("");
      setNaming(false);
      onChanged();
      await reload();
      onOpenFile(path);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not make that document.");
    }
  }

  const copy = COPY[folder];

  return (
    <div className="library">
      {paths === null ? (
        <p className="placeholder">Reading…</p>
      ) : paths.length === 0 && !naming ? (
        <div className="empty empty--panel">
          <p className="empty__title">No {copy.title.toLowerCase()} yet</p>
          <p className="empty__body">{copy.empty}</p>
          <button className="btn btn--small" onClick={() => setNaming(true)}>
            New document
          </button>
        </div>
      ) : (
        <>
          <ul className="library__list">
            {paths.map((path) => (
              <li key={path}>
                <button
                  className={`library__row${path === activePath ? " library__row--active" : ""}`}
                  title={path}
                  onClick={() => onOpenFile(path)}
                >
                  <span className="library__title">{documentName(path)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="library__foot">
            {naming ? (
              <>
                <input
                  className="library__name"
                  autoFocus
                  value={name}
                  placeholder="What is it called?"
                  aria-label={`New ${copy.title.toLowerCase()} document`}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void create();
                    if (event.key === "Escape") {
                      setNaming(false);
                      setError(null);
                    }
                  }}
                />
                <button className="btn btn--small" onClick={() => void create()}>
                  Make it
                </button>
              </>
            ) : (
              <button className="btn btn--ghost btn--small" onClick={() => setNaming(true)}>
                New document
              </button>
            )}
          </div>
        </>
      )}
      {error !== null && (
        <p className="status status--error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
