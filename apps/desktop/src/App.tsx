import { useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import { StartScreen } from "./components/StartScreen";
import { Workspace } from "./components/Workspace";

/**
 * Phase-1 desktop app: create, open and edit real fiction projects backed by the
 * Story Repository (the authoritative on-disk project format). No AI yet — this
 * proves the persistent project foundation end to end (docs/STORY_REPOSITORY.md).
 */
export function App() {
  const [repo, setRepo] = useState<StoryRepository | null>(null);

  if (repo === null) {
    return <StartScreen onReady={setRepo} />;
  }
  return <Workspace repo={repo} onClose={() => setRepo(null)} />;
}
