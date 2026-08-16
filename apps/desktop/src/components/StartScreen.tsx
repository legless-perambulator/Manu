import { useState } from "react";
import { createProjectAt, openProjectAt, validateProjectAt } from "../repo/session";
import type { ProjectSession } from "../repo/session";
import { pickDirectory } from "../lib/dialog";
import { isTauri } from "../tauri";
import { TEMPLATES } from "@jellytind/genre";
import { projectFolderName } from "@jellytind/story-repository";
import { forgetProject, listRecentProjects } from "../repo/recents";
import { Wordmark } from "./Wordmark";
import { ImportWizard } from "./ImportWizard";
import { bookRoot, peekUniverse } from "../lib/universe-session";
import type { UniverseManifest } from "@jellytind/universe";

interface StartScreenProps {
  onReady: (session: ProjectSession) => void;
  onOpenSettings: () => void;
}

const SEEN_KEY = "manu.introduced";

function firstRun(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === null;
  } catch {
    return false;
  }
}

/**
 * The first thing anybody sees.
 *
 * Two columns of ordinary controls, not a landing page: what you came to do on
 * the left, what you were doing last on the right. The audit found this screen
 * as a single narrow column whose call to action was a full-width Manuscript Red
 * block and whose "Open project" sat below the fold at 1280×800 — a marketing
 * shape for an application whose first job is to get out of the way.
 */
export function StartScreen({ onReady, onOpenSettings }: StartScreenProps) {
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState("novel");
  const [recents, setRecents] = useState(listRecentProjects);
  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(firstRun);
  const [importing, setImporting] = useState(false);
  const [universePick, setUniversePick] = useState<{
    root: string;
    manifest: UniverseManifest;
  } | null>(null);
  const inApp = isTauri();

  const trimmed = title.trim();
  const folder = trimmed === "" ? null : projectFolderName(trimmed);

  /** Said once, then never again. A first run is an orientation, not a tour. */
  function dismissIntro() {
    setShowIntro(false);
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Not remembering is a small cost; blocking the writer is not.
    }
  }

  async function handleCreate() {
    setError(null);
    if (trimmed === "") {
      setError("Give the project a title first.");
      return;
    }
    const dir = await pickDirectory(`Choose where to put "${trimmed}"`);
    if (dir === null) return;
    // Creation writes forty-odd files. On a slow disk that is long enough to
    // look like nothing happened, so it says what it is doing.
    setBusy(`Creating ${folder ?? trimmed}…`);
    try {
      onReady(await createProjectAt(dir, trimmed, template));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleOpen() {
    setError(null);
    const dir = await pickDirectory("Open an existing project");
    if (dir === null) return;
    setBusy("Opening…");
    try {
      const validation = await validateProjectAt(dir);
      if (!validation.ok) {
        setError(validation.errors[0] ?? "That folder is not a Manu project.");
        return;
      }
      onReady(await openProjectAt(dir));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Open a universe (Phase 41 §15): pick the universe folder, then a book in
   * it. A book still opens as a book — the universe adds navigation, not
   * weight.
   */
  async function handleOpenUniverse() {
    setError(null);
    const dir = await pickDirectory("Open a universe folder");
    if (dir === null) return;
    try {
      const manifest = await peekUniverse(dir);
      if (manifest === null) {
        setError("That folder is not a Manu universe (.universe/universe.json missing).");
        return;
      }
      if (manifest.books.length === 0) {
        setError(`"${manifest.name}" has no books yet — create or import one, then join it.`);
        return;
      }
      setUniversePick({ root: dir, manifest });
    } catch (e) {
      setError(messageOf(e));
    }
  }

  async function openUniverseBook(root: string, path: string) {
    setUniversePick(null);
    setBusy("Opening…");
    try {
      onReady(await openProjectAt(bookRoot(root, { path } as never)));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function openRecent(root: string) {
    setError(null);
    setBusy("Opening…");
    try {
      onReady(await openProjectAt(root));
    } catch (e) {
      // A project that has been moved or deleted should not sit in the list
      // pretending otherwise.
      setError(`${messageOf(e)} — removed from recent projects.`);
      forgetProject(root);
      setRecents(listRecentProjects());
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null || !inApp;
  const summary = TEMPLATES.find((entry) => entry.id === template)?.summary;

  return (
    <div className="start">
      <header className="start__masthead">
        <h1 className="start__brand">
          <Wordmark height={30} />
          <span className="visually-hidden">Manu</span>
        </h1>
        <p className="start__tagline">You are the author. Manu is the hand.</p>
        <span className="start__spacer" />
        <button className="btn btn--ghost btn--small" onClick={onOpenSettings}>
          Settings
        </button>
      </header>

      {showIntro && (
        <section className="intro" aria-label="First time here">
          <p className="intro__line">
            A project is a <strong>folder of plain files</strong> you own. <strong>Build</strong>{" "}
            checks continuity without a model. A model, if you connect one, only ever{" "}
            <strong>proposes</strong> — nothing reaches the manuscript until you accept it.
          </p>
          <p className="intro__line">
            Manu keeps rolling copies inside the project, and you can point{" "}
            <strong>scheduled backups</strong> at any folder — an external drive, a synced directory
            — from the Export panel. Your own backups still matter, like with any writing tool.
          </p>
          <button className="btn btn--ghost btn--small" onClick={dismissIntro}>
            Got it
          </button>
        </section>
      )}

      {!inApp && (
        <p className="start__warn" role="status">
          Running in a browser. Creating and opening projects needs the desktop app — everything
          here works on your own files, so it has to reach the filesystem.
        </p>
      )}

      {error !== null && (
        <p className="start__error" role="alert">
          {error}
        </p>
      )}

      <div className="start__columns">
        <section className="start__column" aria-labelledby="start-new">
          <h2 id="start-new" className="start__heading">
            New project
          </h2>

          <label className="field">
            <span>Title</span>
            <input
              placeholder="The Blackthorn Inheritance"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={disabled}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !disabled) void handleCreate();
              }}
            />
          </label>

          <div className="start__templates" role="radiogroup" aria-label="Template">
            {TEMPLATES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={template === entry.id}
                title={entry.summary}
                className={`start__template${template === entry.id ? " is-on" : ""}`}
                disabled={disabled}
                onClick={() => setTemplate(entry.id)}
              >
                {entry.name}
              </button>
            ))}
          </div>
          {summary !== undefined && <p className="hint">{summary}</p>}

          <div className="start__actions">
            <button
              className="btn btn--primary"
              onClick={() => void handleCreate()}
              disabled={disabled}
            >
              Choose a folder…
            </button>
            {busy !== null && (
              <span className="start__busy" role="status">
                {busy}
              </span>
            )}
          </div>

          {/*
            The audit's second-worst finding was that picking a folder made
            *that folder* the project. It creates a folder inside now — and says
            so, with the name it will use, before anything is written.
          */}
          <p className="hint">
            Manu will create{" "}
            {folder === null ? <span>a folder named after the title</span> : <code>{folder}/</code>}{" "}
            inside the folder you choose. A template switches modules on; you can change them
            whenever you like.
          </p>
        </section>

        <section className="start__column" aria-labelledby="start-open">
          <h2 id="start-open" className="start__heading">
            Open a project
          </h2>

          {recents.length === 0 ? (
            <p className="hint">
              Projects you open will be listed here. Nothing is uploaded — the list is just paths on
              this machine.
            </p>
          ) : (
            <ul className="start__recents">
              {recents.map((entry) => (
                <li key={entry.root}>
                  <button
                    className="start__recent"
                    disabled={disabled}
                    title={entry.root}
                    onClick={() => void openRecent(entry.root)}
                  >
                    <span className="start__recent-title">{entry.title}</span>
                    <span className="start__recent-path">{entry.root}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="start__actions">
            <button className="btn" onClick={() => void handleOpen()} disabled={disabled}>
              Open a folder…
            </button>
            <button className="btn" onClick={() => setImporting(true)} disabled={disabled}>
              Import a manuscript…
            </button>
            <button className="btn" onClick={() => void handleOpenUniverse()} disabled={disabled}>
              Open a universe…
            </button>
          </div>
          {universePick !== null && (
            <div className="start__universe">
              <p className="hint">
                {universePick.manifest.name} — {universePick.manifest.books.length} book(s). Open
                which?
              </p>
              {[...universePick.manifest.books]
                .sort((a, b) => a.readingOrder - b.readingOrder)
                .map((book) => (
                  <button
                    key={book.bookId}
                    className="start__recent"
                    disabled={disabled}
                    onClick={() => void openUniverseBook(universePick.root, book.path)}
                  >
                    <span className="start__recent-title">
                      {book.readingOrder}. {book.title}
                    </span>
                  </button>
                ))}
            </div>
          )}
          <p className="hint">
            Already wrote the book? Import DOCX, Markdown, plain text or EPUB and Manu will map it
            into a structured project — or restore a Manu project archive.
          </p>
        </section>
      </div>
      {importing && <ImportWizard onReady={onReady} onClose={() => setImporting(false)} />}
    </div>
  );
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "Something went wrong.";
}
