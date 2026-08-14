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
import { AiProviderSettings } from "./components/AiProviderSettings";
import { Workspace } from "./components/Workspace";
import { createSecretStore } from "./lib/secrets";
import { useTheme } from "./lib/theme";
import type { ProjectSession } from "./repo/session";
import "./styles.css";

/** Two plausible connections, written straight to the settings key. */
function seedConnections(): void {
  const full = { streaming: true, structuredOutput: true, tools: true };
  const model = (provider: string, modelId: string, displayName: string, unknown?: string[]) => ({
    provider,
    modelId,
    displayName,
    capabilities: full,
    supportsTools: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    ...(unknown === undefined ? {} : { unknownCapabilities: unknown }),
  });
  window.localStorage.setItem(
    "manu.ai-settings",
    JSON.stringify({
      connections: [
        {
          id: "ollama",
          providerId: "ollama",
          label: "Ollama — GPU box",
          baseUrl: "http://192.168.1.50:11434",
          models: [
            model("ollama", "llama3:8b", "llama3:8b", ["tools", "structuredOutput"]),
            model("ollama", "qwen2.5:14b", "qwen2.5:14b", ["tools", "structuredOutput"]),
          ],
          modelsRefreshedAt: "2026-01-01T10:00:00.000Z",
        },
        {
          id: "anthropic",
          providerId: "anthropic",
          label: "Anthropic",
          models: [
            model("anthropic", "claude-opus-5", "Claude Opus 5"),
            model("anthropic", "claude-sonnet-5", "Claude Sonnet 5"),
          ],
          modelsRefreshedAt: "2026-01-01T10:00:00.000Z",
        },
      ],
      purposes: { default: { connectionId: "anthropic", modelId: "claude-opus-5" } },
    }),
  );
}

function Preview() {
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    void (async () => {
      const store = new InMemoryProjectStore();
      const created = await StoryRepository.createProject({
        store,
        title: "The Blackthorn Inheritance",
      });
      // A chapter with real prose, so the harness shows the editor doing the
      // thing the editor is for rather than an empty state.
      const chapter = await created.addChapter({ title: "The Cellar Door" });
      await created.writeProjectFile(
        chapter.filePath,
        `---\nid: ${String(chapter.id)}\ntitle: ${chapter.title}\n---\n\n` +
          "The cellar door had been painted shut for as long as Mara could remember, " +
          "and she had never once thought to ask why. That was the part she would " +
          "turn over afterwards — not the door, not the dark behind it, but the " +
          "twenty-six years of not asking.\n\n" +
          "Elias found her there at seven in the morning with a chisel in her hand " +
          "and paint flakes in her hair.\n\n" +
          "\u201cYou could have waited,\u201d he said.\n\n" +
          "\u201cI did wait. I waited twenty-six years.\u201d\n",
      );
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

  // `?settings=1` opens the AI providers screen; `?settings=demo` seeds two
  // pretend connections first, so the configured state can be looked at without
  // a key, a server or anything to click.
  const settingsParam = params.get("settings");
  const openSettings = settingsParam !== null;
  if (settingsParam === "demo") seedConnections();
  const openPalette = params.get("palette") === "1";
  // `?open=<path>` starts with a file in the editor, so the harness can show
  // the manuscript rather than the empty state.
  const openPath = params.get("open");
  useEffect(() => {
    if (session === null || !openPalette) return;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  }, [session, openPalette]);

  if (session === null) return <p className="placeholder">Preparing preview…</p>;
  const secrets = createSecretStore();
  return (
    <>
      <Workspace
        session={session}
        onSession={setSession}
        secrets={secrets}
        theme={theme}
        onChangeTheme={setTheme}
        onClose={() => undefined}
        onOpenSettings={() => undefined}
        {...(openPath === null ? {} : { initialPath: openPath })}
      />
      {openSettings && <AiProviderSettings secrets={secrets} onClose={() => undefined} />}
    </>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
