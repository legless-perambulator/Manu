import { useMemo, useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import { StartScreen } from "./components/StartScreen";
import { Workspace } from "./components/Workspace";
import { ModelSettings } from "./components/ModelSettings";
import { createSecretStore } from "./lib/secrets";
import { useTheme } from "./lib/theme";

/**
 * Manu — the application shell. Either a project is open and the workspace is
 * showing, or it is not and the start screen is. Model configuration is a
 * modal over whichever of the two is in front, because a writer should never
 * have to close their book to change a provider.
 */
export function App() {
  const [repo, setRepo] = useState<StoryRepository | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const secrets = useMemo(() => createSecretStore(), []);
  const [theme, setTheme] = useTheme();

  return (
    <>
      {repo === null ? (
        <StartScreen onReady={setRepo} onOpenSettings={() => setSettingsOpen(true)} />
      ) : (
        <Workspace
          repo={repo}
          secrets={secrets}
          theme={theme}
          onChangeTheme={setTheme}
          onClose={() => setRepo(null)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {settingsOpen && <ModelSettings secrets={secrets} onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
