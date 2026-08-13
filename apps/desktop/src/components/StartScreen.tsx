import { useState } from "react";
import { createProjectAt, openProjectAt, validateProjectAt } from "../repo/session";
import type { ProjectSession } from "../repo/session";
import { pickDirectory } from "../lib/dialog";
import { isTauri } from "../tauri";
import { TEMPLATES } from "@jellytind/genre";
import { Wordmark } from "./Wordmark";

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

export function StartScreen({ onReady, onOpenSettings }: StartScreenProps) {
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState("novel");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(firstRun);
  const inApp = isTauri();

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
    const trimmed = title.trim();
    if (trimmed === "") {
      setError("Please enter a project title.");
      return;
    }
    const dir = await pickDirectory("Choose a folder for the new project");
    if (dir === null) return;
    setBusy(true);
    try {
      onReady(await createProjectAt(dir, trimmed, template));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen() {
    setError(null);
    const dir = await pickDirectory("Open an existing project");
    if (dir === null) return;
    setBusy(true);
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
      setBusy(false);
    }
  }

  return (
    <div className="start">
      <div className="start__card">
        <h1 className="start__brand">
          <Wordmark height={44} />
          <span className="visually-hidden">Manu</span>
        </h1>
        <p className="start__tagline">You are the author. Manu is the hand.</p>

        {showIntro && (
          <section className="intro">
            <h2 className="intro__title">First time here</h2>
            <ul className="intro__list">
              <li>
                A project is a <strong>folder of plain files</strong> on your machine. Manu records
                the story&rsquo;s structure alongside the prose; both stay yours and readable
                without it.
              </li>
              <li>
                <strong>Build</strong> checks continuity deterministically — who knew what, where
                things were, what a change would reach. It needs no model and makes no judgements
                about your writing.
              </li>
              <li>
                A model, if you configure one, <strong>proposes</strong>. Nothing it writes reaches
                the manuscript until you accept it, and everything it did is in History.
              </li>
            </ul>
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

        <section className="start__section">
          <h2>New project</h2>
          <input
            className="start__input"
            placeholder="Project title"
            aria-label="Project title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy || !inApp}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy && inApp) void handleCreate();
            }}
          />
          <div className="start__templates" role="radiogroup" aria-label="Template">
            {TEMPLATES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={template === entry.id}
                title={entry.summary}
                className={`start__template${template === entry.id ? " start__template--on" : ""}`}
                disabled={busy || !inApp}
                onClick={() => setTemplate(entry.id)}
              >
                {entry.name}
              </button>
            ))}
          </div>
          <p className="start__note">{TEMPLATES.find((entry) => entry.id === template)?.summary}</p>
          <button
            className="btn btn--primary"
            onClick={() => void handleCreate()}
            disabled={busy || !inApp}
          >
            Choose a folder and create
          </button>
          <p className="start__note">
            A Manu project is a folder of plain files you own. Nothing is stored anywhere else. A
            template switches modules on — you can change them whenever you like.
          </p>
        </section>

        <section className="start__section">
          <h2>Open project</h2>
          <button className="btn" onClick={() => void handleOpen()} disabled={busy || !inApp}>
            Open an existing project…
          </button>
        </section>

        <section className="start__section">
          <h2>Model provider</h2>
          <button className="btn btn--ghost" onClick={onOpenSettings}>
            Model settings…
          </button>
          <p className="start__note">
            Optional. Every deterministic check — the build, the tests, the timeline — runs with no
            model configured at all.
          </p>
        </section>

        {error !== null && (
          <p className="start__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "Something went wrong.";
}
