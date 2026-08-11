import { useState } from "react";
import type { StoryRepository } from "@jellytind/story-repository";
import { ProjectExplorer } from "./ProjectExplorer";
import { EntitiesPanel } from "./EntitiesPanel";
import { SearchPanel } from "./SearchPanel";
import { HistoryPanel } from "./HistoryPanel";
import { Editor } from "./Editor";
import { Inspector } from "./Inspector";
import { DiffViewer } from "./DiffViewer";

type LeftTab = "files" | "entities" | "search" | "history";

interface WorkspaceProps {
  repo: StoryRepository;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function Workspace({ repo, onClose, onOpenSettings }: WorkspaceProps) {
  const [tab, setTab] = useState<LeftTab>("files");
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = () => setRefreshToken((n) => n + 1);

  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand">JellyTind</span>
        <span className="subtitle">{repo.project.title}</span>
        <button className="btn btn--ghost" onClick={onOpenSettings}>
          Model settings
        </button>
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
            <button
              className={`tab${tab === "search" ? " tab--active" : ""}`}
              onClick={() => setTab("search")}
            >
              Search
            </button>
            <button
              className={`tab${tab === "history" ? " tab--active" : ""}`}
              onClick={() => setTab("history")}
            >
              History
            </button>
          </div>
          {tab === "files" && (
            <ProjectExplorer
              repo={repo}
              activePath={openPath}
              onOpenFile={setOpenPath}
              refreshToken={refreshToken}
            />
          )}
          {tab === "entities" && (
            <EntitiesPanel
              repo={repo}
              selectedId={selectedEntityId}
              onSelect={setSelectedEntityId}
              refreshToken={refreshToken}
              onChanged={refresh}
            />
          )}
          {tab === "search" && (
            <SearchPanel
              repo={repo}
              onOpenFile={(p) => {
                setOpenPath(p);
              }}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
              }}
              refreshToken={refreshToken}
            />
          )}
          {tab === "history" && (
            <HistoryPanel
              repo={repo}
              selectedChangeId={selectedChangeId}
              onSelectChange={setSelectedChangeId}
              refreshToken={refreshToken}
              onChanged={refresh}
            />
          )}
        </aside>

        <main className="panel panel--editor">
          {selectedChangeId !== null ? (
            <DiffViewer
              repo={repo}
              changeId={selectedChangeId}
              onReverted={() => {
                setSelectedChangeId(null);
                refresh();
              }}
              onClose={() => setSelectedChangeId(null)}
            />
          ) : (
            <Editor repo={repo} path={openPath} onSaved={refresh} />
          )}
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
