import { useMemo, useState } from "react";
import { StartScreen } from "./components/StartScreen";
import { Workspace } from "./components/Workspace";
import { AiProviderSettings } from "./components/AiProviderSettings";
import { createSecretStore } from "./lib/secrets";
import type { ProjectSession } from "./repo/session";
import { useTheme } from "./lib/theme";

/**
 * Manu — the application shell. Either a project is open and the workspace is
 * showing, or it is not and the start screen is. Model configuration is a
 * modal over whichever of the two is in front, because a writer should never
 * have to close their book to change a provider.
 */
export function App() {
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const secrets = useMemo(() => createSecretStore(), []);
  const [theme, setTheme] = useTheme();

  return (
    <>
      {session === null ? (
        <StartScreen onReady={setSession} onOpenSettings={() => setSettingsOpen(true)} />
      ) : (
        <Workspace
          session={session}
          onSession={setSession}
          secrets={secrets}
          theme={theme}
          onChangeTheme={setTheme}
          onClose={() => setSession(null)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {settingsOpen && (
        <AiProviderSettings secrets={secrets} onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );
}
