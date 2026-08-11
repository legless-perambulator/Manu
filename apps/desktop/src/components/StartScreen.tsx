import { useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import { createProjectAt, openProjectAt, validateProjectAt } from "../repo/session";
import { pickDirectory } from "../lib/dialog";
import { isTauri } from "../tauri";

export function StartScreen({ onReady }: { onReady: (repo: StoryRepository) => void }) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inApp = isTauri();

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
      onReady(await createProjectAt(dir, trimmed));
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
        setError(validation.errors[0] ?? "That folder is not a valid JellyTind project.");
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
        <h1 className="start__brand">JellyTind</h1>
        <p className="start__tagline">AI-native fiction development environment</p>

        {!inApp && (
          <p className="start__warn">
            Running in a browser — creating and opening projects requires the desktop app.
          </p>
        )}

        <section className="start__section">
          <h2>New project</h2>
          <input
            className="start__input"
            placeholder="Project title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy || !inApp}
          />
          <button className="btn btn--primary" onClick={handleCreate} disabled={busy || !inApp}>
            Choose folder & create
          </button>
        </section>

        <section className="start__section">
          <h2>Open project</h2>
          <button className="btn" onClick={handleOpen} disabled={busy || !inApp}>
            Open existing project…
          </button>
        </section>

        {error !== null && <p className="start__error">{error}</p>}
      </div>
    </div>
  );
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "Something went wrong.";
}
