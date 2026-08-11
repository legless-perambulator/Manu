import { useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import { ProjectExplorer } from "./ProjectExplorer";
import { EntitiesPanel } from "./EntitiesPanel";
import { Editor } from "./Editor";
import { Inspector } from "./Inspector";

type LeftTab = "files" | "entities";

export function Workspace({ repo, onClose }: { repo: StoryRepository; onClose: () => void }) {
  const [tab, setTab] = useState<LeftTab>("files");
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = () => setRefreshToken((n) => n + 1);

  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand">JellyTind</span>
        <span className="subtitle">{repo.project.title}</span>
        <button className="btn btn--ghost" onClick={onClose}>
          Close project
        </button>
      </header>

      <div className="workbench workbench--three">
        <aside className="panel panel--explorer">
          <div className="tabbar">
            <button
              className={`tab${tab === "files" ? " tab--active" : ""}`}
              onClick={() => setTab("files")}
            >
              Files
            </button>
            <button
              className={`tab${tab === "entities" ? " tab--active" : ""}`}
              onClick={() => setTab("entities")}
            >
              Entities
            </button>
          </div>
          {tab === "files" ? (
            <ProjectExplorer
              repo={repo}
              activePath={openPath}
              onOpenFile={setOpenPath}
              refreshToken={refreshToken}
            />
          ) : (
            <EntitiesPanel
              repo={repo}
              selectedId={selectedEntityId}
              onSelect={setSelectedEntityId}
              refreshToken={refreshToken}
              onChanged={refresh}
            />
          )}
        </aside>

        <main className="panel panel--editor">
          <Editor repo={repo} path={openPath} onSaved={refresh} />
        </main>

        <aside className="panel panel--inspector">
          <Inspector
            repo={repo}
            entityId={selectedEntityId}
            onChanged={refresh}
            onDeleted={() => setSelectedEntityId(null)}
          />
        </aside>
      </div>

      <footer className="panel panel--activity">
        <span className="activity__id">
          {repo.project.id} · schema v{repo.project.schemaVersion}
        </span>
      </footer>
    </div>
  );
}
