/**
 * A browser-only preview harness for the workspace chrome.
 *
 * It mounts the real Workspace against an in-memory project so the layout,
 * palette and theming can be looked at without a desktop build. It is not part
 * of the shipped application: `preview.html` is excluded from the Tauri bundle.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { BranchStore, StoryRepository, openBranch } from "@jellytind/story-repository";
import { Workspace } from "./components/Workspace";
import { createSecretStore } from "./lib/secrets";
import { useTheme } from "./lib/theme";
import type { ProjectSession } from "./repo/session";
import "./styles.css";

function Preview() {
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    void (async () => {
      const store = new InMemoryProjectStore();
      await StoryRepository.createProject({ store, title: "The Blackthorn Inheritance" });
      const repo = await openBranch(store);
      const branch = await new BranchStore(store).active();
      setSession({ repo, store, root: "", branch });
    })();
  }, []);

  // `?theme=dark` and `?palette=1` make the harness drivable from a
  // screenshotting browser, which has no way to click or type.
  const params = new URLSearchParams(window.location.search);
  const forcedTheme = params.get("theme");
  useEffect(() => {
    if (forcedTheme === "dark" || forcedTheme === "light") setTheme(forcedTheme);
  }, [forcedTheme, setTheme]);

  const openPalette = params.get("palette") === "1";
  useEffect(() => {
    if (session === null || !openPalette) return;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  }, [session, openPalette]);

  if (session === null) return <p className="placeholder">Preparing preview…</p>;
  return (
    <Workspace
      session={session}
      onSession={setSession}
      secrets={createSecretStore()}
      theme={theme}
      onChangeTheme={setTheme}
      onClose={() => undefined}
      onOpenSettings={() => undefined}
    />
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
