import { useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import { ProjectExplorer } from "./ProjectExplorer";
import { Editor } from "./Editor";

export function Workspace({ repo, onClose }: { repo: StoryRepository; onClose: () => void }) {
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [creating, setCreating] = useState(false);

  const refresh = () => setRefreshToken((n) => n + 1);

  async function newChapter() {
    setCreating(true);
    try {
      const chapter = await repo.addChapter({ title: "Untitled Chapter" });
      refresh();
      setOpenPath(chapter.filePath);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand">JellyTind</span>
        <span className="subtitle">{repo.project.title}</span>
        <button className="btn btn--ghost" onClick={onClose}>
          Close project
        </button>
      </header>

      <div className="workbench workbench--two">
        <aside className="panel panel--explorer">
          <div className="explorer__actions">
            <button
              className="btn btn--small"
              onClick={() => void newChapter()}
              disabled={creating}
            >
              ＋ Chapter
            </button>
          </div>
          <ProjectExplorer
            repo={repo}
            activePath={openPath}
            onOpenFile={setOpenPath}
            refreshToken={refreshToken}
          />
        </aside>

        <main className="panel panel--editor">
          <Editor repo={repo} path={openPath} onSaved={refresh} />
        </main>
      </div>

      <footer className="panel panel--activity">
        <span className="activity__id">
          {repo.project.id} · schema v{repo.project.schemaVersion}
        </span>
      </footer>
    </div>
  );
}
