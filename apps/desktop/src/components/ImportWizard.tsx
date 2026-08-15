import { useState } from "react";
import { pickDirectory } from "../lib/dialog";
import { pickManuscriptFile } from "../lib/external-files";
import {
  createImportedProject,
  importProjectArchive,
  loadManuscriptForImport,
  type LoadedImport,
} from "../lib/importing";
import type { ProjectSession } from "../repo/session";

interface Props {
  onReady: (session: ProjectSession) => void;
  onClose: () => void;
}

/**
 * The import wizard (Phase 40 §1–§3).
 *
 * Pick a file, see what Manu detected — title, chapters, word counts,
 * formatting, problems — correct it, and only then commit. The source file is
 * read once and never modified; a `.zip` restores a Manu project archive
 * instead of importing prose.
 */
export function ImportWizard({ onReady, onClose }: Props) {
  const [loaded, setLoaded] = useState<LoadedImport | null>(null);
  const [title, setTitle] = useState("");
  const [chapterTitles, setChapterTitles] = useState<Array<string | null>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick() {
    setError(null);
    try {
      const path = await pickManuscriptFile();
      if (path === null) return;
      const fileName = path.slice(path.lastIndexOf("/") + 1);
      if (/\.zip$/i.test(fileName)) {
        const parent = await pickDirectory("Choose where to restore the project");
        if (parent === null) return;
        setBusy("Restoring the project archive…");
        onReady(await importProjectArchive(parent, fileName, path));
        return;
      }
      setBusy("Reading the manuscript…");
      const held = await loadManuscriptForImport(path);
      setLoaded(held);
      setTitle(held.preview.title ?? fileName.replace(/\.[^.]+$/, ""));
      setChapterTitles(held.preview.chapters.map((chapter) => chapter.title));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  async function commit() {
    if (loaded === null) return;
    setError(null);
    const trimmed = title.trim();
    if (trimmed === "") {
      setError("Give the project a title first.");
      return;
    }
    const parent = await pickDirectory(`Choose where to put "${trimmed}"`);
    if (parent === null) return;
    setBusy("Creating the project…");
    try {
      onReady(await createImportedProject(parent, loaded, { title: trimmed, chapterTitles }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label="Import a manuscript"
      >
        <div className="modal__header">
          <h2>Import a manuscript</h2>
        </div>
        <div className="modal__body">
          {loaded === null ? (
            <>
              <p>
                Bring an existing book into Manu: DOCX, Markdown, plain text or EPUB — or restore a
                Manu project archive (.zip). The original file is never modified. Import manuscripts
                you are authorised to work with.
              </p>
              {error !== null && <p className="status status--error">{error}</p>}
              <div className="modal__actions">
                <button
                  className="btn btn--primary"
                  disabled={busy !== null}
                  onClick={() => void pick()}
                >
                  {busy ?? "Choose a file…"}
                </button>
                <button className="btn" onClick={onClose} disabled={busy !== null}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="field">
                <span>Project title</span>
                <input value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <p className="hint">
                {loaded.preview.words.toLocaleString()} words ·{" "}
                {chapterTitles.filter((held) => held !== null).length} chapters · preserved:{" "}
                {loaded.preview.formatting.join(", ")}
                {loaded.preview.author !== null ? ` · by ${loaded.preview.author}` : ""}
              </p>
              {loaded.preview.problems.length > 0 && (
                <ul className="review__warnings">
                  {loaded.preview.problems.map((problem, index) => (
                    <li key={index}>{problem}</li>
                  ))}
                </ul>
              )}
              <ul className="import__chapters">
                {loaded.preview.chapters.map((chapter, index) => (
                  <li key={index} className="import__chapter">
                    <input
                      type="checkbox"
                      checked={chapterTitles[index] !== null}
                      aria-label={`Include ${chapter.title}`}
                      onChange={(event) =>
                        setChapterTitles((current) => {
                          const next = [...current];
                          next[index] = event.target.checked ? chapter.title : null;
                          return next;
                        })
                      }
                    />
                    <input
                      className="import__title"
                      value={chapterTitles[index] ?? chapter.title}
                      disabled={chapterTitles[index] === null}
                      onChange={(event) =>
                        setChapterTitles((current) => {
                          const next = [...current];
                          next[index] = event.target.value;
                          return next;
                        })
                      }
                    />
                    <span className="import__words">{chapter.words.toLocaleString()} words</span>
                    <span className="import__boundary">{chapter.boundary}</span>
                  </li>
                ))}
              </ul>
              {error !== null && <p className="status status--error">{error}</p>}
              <div className="modal__actions">
                <button
                  className="btn btn--primary"
                  disabled={busy !== null}
                  onClick={() => void commit()}
                >
                  {busy ?? "Create the project"}
                </button>
                <button className="btn" onClick={() => setLoaded(null)} disabled={busy !== null}>
                  Choose a different file
                </button>
                <button className="btn btn--ghost" onClick={onClose} disabled={busy !== null}>
                  Cancel
                </button>
              </div>
              <p className="hint">
                After import, open <strong>Map Manuscript</strong> to reconstruct characters,
                locations, timeline, knowledge and plot threads from the prose.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
