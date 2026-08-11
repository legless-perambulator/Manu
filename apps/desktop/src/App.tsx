import { useMemo, useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import { StartScreen } from "./components/StartScreen";
import { Workspace } from "./components/Workspace";
import { ModelSettings } from "./components/ModelSettings";
import { createSecretStore } from "./lib/secrets";

/**
 * Phase-6 desktop app: real fiction projects backed by the Story Repository,
 * plus provider-independent model configuration. The app configures a provider
 * and proves it can reach a model through the `LanguageModel` interface; no
 * provider SDK type appears in application code (docs/MODEL_ROUTER.md).
 */
export function App() {
  const [repo, setRepo] = useState<StoryRepository | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const secrets = useMemo(() => createSecretStore(), []);

  return (
    <>
      {repo === null ? (
        <StartScreen onReady={setRepo} onOpenSettings={() => setSettingsOpen(true)} />
      ) : (
        <Workspace
          repo={repo}
          onClose={() => setRepo(null)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {settingsOpen && <ModelSettings secrets={secrets} onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
