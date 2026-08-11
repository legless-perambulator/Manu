import { useCallback, useState } from "react";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { ProjectExplorer } from "./ProjectExplorer";
import { EntitiesPanel } from "./EntitiesPanel";
import { SearchPanel } from "./SearchPanel";
import { HistoryPanel } from "./HistoryPanel";
import { Editor } from "./Editor";
import { Inspector } from "./Inspector";
import { DiffViewer } from "./DiffViewer";
import { AgentPanel } from "./AgentPanel";
import { ContextPanel } from "./ContextPanel";

type LeftTab = "files" | "entities" | "search" | "history";
type RightTab = "inspector" | "agent" | "context";

interface WorkspaceProps {
  repo: StoryRepository;
  secrets: SecretStore;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function Workspace({ repo, secrets, onClose, onOpenSettings }: WorkspaceProps) {
  const [tab, setTab] = useState<LeftTab>("files");
  const [rightTab, setRightTab] = useState<RightTab>("inspector");
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [activityLine, setActivityLine] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = () => setRefreshToken((n) => n + 1);
  const showActivity = useCallback((line: string | null) => setActivityLine(line), []);

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
          <div className="tabbar">
            <button
              className={`tab${rightTab === "inspector" ? " tab--active" : ""}`}
              onClick={() => setRightTab("inspector")}
            >
              Inspector
            </button>
            <button
              className={`tab${rightTab === "agent" ? " tab--active" : ""}`}
              onClick={() => setRightTab("agent")}
            >
              Agent
            </button>
            <button
              className={`tab${rightTab === "context" ? " tab--active" : ""}`}
              onClick={() => setRightTab("context")}
            >
              Context
            </button>
          </div>
          {rightTab === "inspector" && (
            <Inspector
              repo={repo}
              entityId={selectedEntityId}
              onChanged={refresh}
              onDeleted={() => setSelectedEntityId(null)}
            />
          )}
          {rightTab === "agent" && (
            <AgentPanel repo={repo} secrets={secrets} onActivityLine={showActivity} />
          )}
          {rightTab === "context" && <ContextPanel repo={repo} refreshToken={refreshToken} />}
        </aside>
      </div>

      <footer className="panel panel--activity">
        <span className="activity__id">
          {repo.project.id} · schema v{repo.project.schemaVersion}
        </span>
        {activityLine !== null && <span className="activity__line">{activityLine}</span>}
      </footer>
    </div>
  );
}
