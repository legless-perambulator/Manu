import { useEffect, useState } from "react";
import { SequentialIdGenerator, ENTITY_KINDS } from "@jellytind/domain";
import { getAppInfo, type AppInfo } from "./tauri";

/**
 * Phase-0 desktop shell.
 *
 * This screen exists to prove the stack is wired end to end: the React UI
 * renders, a workspace domain package (`@jellytind/domain`) is imported and
 * runs in the renderer, and — when running inside Tauri — a Rust command is
 * invoked over the bridge. The four-panel frame previews the intended IDE
 * layout (docs/UX.md); it is a NON-FUNCTIONAL scaffold, deliberately labelled as
 * such (AGENTS.md — "No Fake Features").
 */
export function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [bridge, setBridge] = useState<"checking" | "connected" | "browser">("checking");

  useEffect(() => {
    let active = true;
    getAppInfo()
      .then((info) => {
        if (!active) return;
        setAppInfo(info);
        setBridge("connected");
      })
      .catch(() => {
        if (!active) return;
        setBridge("browser");
      });
    return () => {
      active = false;
    };
  }, []);

  // Exercise a domain primitive in the renderer to prove the wiring.
  const gen = new SequentialIdGenerator();
  const sampleIds = [gen.next("character"), gen.next("scene"), gen.next("plot_thread")];

  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand">JellyTind</span>
        <span className="subtitle">AI-native fiction development environment</span>
        <span className={`bridge bridge--${bridge}`}>
          {bridge === "connected"
            ? `Tauri bridge connected · v${appInfo?.version ?? "?"}`
            : bridge === "browser"
              ? "Running in browser (Tauri bridge unavailable)"
              : "Connecting…"}
        </span>
      </header>

      <div className="workbench">
        <aside className="panel panel--explorer">
          <h2>Project Explorer</h2>
          <p className="placeholder">Manuscript · Scenes · Characters · Plot · World — planned.</p>
        </aside>

        <main className="panel panel--editor">
          <h2>Writing Workspace</h2>
          <p className="placeholder">
            Phase 0 establishes the architecture only. The editor, agents and story intelligence
            arrive in later slices (docs/ROADMAP.md).
          </p>
          <section className="proof">
            <h3>Foundation self-check</h3>
            <ul>
              <li>
                React renderer: <strong>rendering</strong>
              </li>
              <li>
                Domain package (<code>@jellytind/domain</code>) sample IDs:{" "}
                <code>{sampleIds.join(", ")}</code>
              </li>
              <li>
                Entity kinds registered: <code>{ENTITY_KINDS.length}</code>
              </li>
              <li>
                Tauri bridge: <strong>{bridge}</strong>
              </li>
            </ul>
          </section>
        </main>

        <aside className="panel panel--inspector">
          <h2>Inspector / AI</h2>
          <p className="placeholder">Scene metadata, story state, AI interaction — planned.</p>
        </aside>
      </div>

      <footer className="panel panel--activity">
        <h2>Agent Activity</h2>
        <p className="placeholder">Tool activity, findings and plans will stream here — planned.</p>
      </footer>
    </div>
  );
}
