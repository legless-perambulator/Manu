import { useCallback, useState } from "react";
import type { EditProposal, EditRequest, ManuscriptEditor } from "@jellytind/editing";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { createManuscriptEditor, explainEditError } from "../lib/editing";
import { ProjectExplorer } from "./ProjectExplorer";
import { EntitiesPanel } from "./EntitiesPanel";
import { SearchPanel } from "./SearchPanel";
import { HistoryPanel } from "./HistoryPanel";
import { Editor } from "./Editor";
import { Inspector } from "./Inspector";
import { DiffViewer } from "./DiffViewer";
import { AgentPanel } from "./AgentPanel";
import { ContextPanel } from "./ContextPanel";
import { ProposalReview } from "./ProposalReview";
import { StatePanel } from "./StatePanel";
import { KnowledgePanel } from "./KnowledgePanel";
import { RelationshipPanel } from "./RelationshipPanel";
import { TimelinePanel } from "./TimelinePanel";
import { ObjectPanel } from "./ObjectPanel";
import { ThreadPanel } from "./ThreadPanel";
import { BuildPanel } from "./BuildPanel";
import { StoryTestPanel } from "./StoryTestPanel";

type LeftTab =
  | "files"
  | "entities"
  | "search"
  | "state"
  | "knowledge"
  | "relations"
  | "objects"
  | "threads"
  | "timeline"
  | "build"
  | "tests"
  | "history";
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
  const [editor, setEditor] = useState<ManuscriptEditor | null>(null);
  const [proposal, setProposal] = useState<EditProposal | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const refresh = () => setRefreshToken((n) => n + 1);
  const showActivity = useCallback((line: string | null) => setActivityLine(line), []);

  /**
   * Run an AI edit and show the proposal. The editor is built lazily so opening
   * a project never requires a configured model.
   */
  const runEdit = useCallback(
    async (request: EditRequest) => {
      setAiBusy(true);
      setAiError(null);
      setActivityLine(`${request.operation.replace(/_/g, " ")}…`);
      try {
        const active = editor ?? (await createManuscriptEditor(repo, secrets));
        if (editor === null) setEditor(active);
        setProposal(await active.propose(request));
        setSelectedChangeId(null);
      } catch (cause) {
        setAiError(explainEditError(cause));
      } finally {
        setAiBusy(false);
        setActivityLine(null);
      }
    },
    [editor, repo, secrets],
  );

  /**
   * Navigate to a scene: select it for the inspector and open the prose it
   * lives in, so a diagnostic leads to the words rather than to a record.
   */
  const openScene = useCallback(
    async (sceneId: string) => {
      setSelectedEntityId(sceneId);
      setRightTab("inspector");
      const scene = (await repo.listScenes()).find((s) => s.id === sceneId);
      const chapter = (await repo.listChapters()).find((c) => c.id === scene?.chapterId);
      if (chapter !== undefined) setOpenPath(chapter.filePath);
    },
    [repo],
  );

  const sceneIdForEditor =
    selectedEntityId?.startsWith("SCENE_") === true ? selectedEntityId : null;

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
              className={`tab${tab === "state" ? " tab--active" : ""}`}
              onClick={() => setTab("state")}
            >
              State
            </button>
            <button
              className={`tab${tab === "knowledge" ? " tab--active" : ""}`}
              onClick={() => setTab("knowledge")}
            >
              Knowledge
            </button>
            <button
              className={`tab${tab === "relations" ? " tab--active" : ""}`}
              onClick={() => setTab("relations")}
            >
              Relations
            </button>
            <button
              className={`tab${tab === "objects" ? " tab--active" : ""}`}
              onClick={() => setTab("objects")}
            >
              Objects
            </button>
            <button
              className={`tab${tab === "threads" ? " tab--active" : ""}`}
              onClick={() => setTab("threads")}
            >
              Threads
            </button>
            <button
              className={`tab${tab === "timeline" ? " tab--active" : ""}`}
              onClick={() => setTab("timeline")}
            >
              Timeline
            </button>
            <button
              className={`tab${tab === "build" ? " tab--active" : ""}`}
              onClick={() => setTab("build")}
            >
              Build
            </button>
            <button
              className={`tab${tab === "tests" ? " tab--active" : ""}`}
              onClick={() => setTab("tests")}
            >
              Tests
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
          {tab === "state" && (
            <StatePanel
              repo={repo}
              secrets={secrets}
              refreshToken={refreshToken}
              onChanged={refresh}
            />
          )}
          {tab === "knowledge" && <KnowledgePanel repo={repo} refreshToken={refreshToken} />}
          {tab === "relations" && (
            <RelationshipPanel repo={repo} refreshToken={refreshToken} onChanged={refresh} />
          )}
          {tab === "objects" && (
            <ObjectPanel
              repo={repo}
              refreshToken={refreshToken}
              onChanged={refresh}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                setRightTab("inspector");
              }}
            />
          )}
          {tab === "threads" && (
            <ThreadPanel
              repo={repo}
              refreshToken={refreshToken}
              onChanged={refresh}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                setRightTab("inspector");
              }}
            />
          )}
          {tab === "timeline" && (
            <TimelinePanel
              repo={repo}
              refreshToken={refreshToken}
              onChanged={refresh}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                setRightTab("inspector");
              }}
            />
          )}
          {tab === "build" && (
            <BuildPanel
              repo={repo}
              refreshToken={refreshToken}
              onChanged={refresh}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                setRightTab("inspector");
              }}
              onOpenScene={(sceneId) => {
                void openScene(sceneId);
              }}
            />
          )}
          {tab === "tests" && (
            <StoryTestPanel
              repo={repo}
              refreshToken={refreshToken}
              onChanged={refresh}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                setRightTab("inspector");
              }}
              onOpenScene={(sceneId) => {
                void openScene(sceneId);
              }}
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
          {aiError !== null && <p className="editor__error">{aiError}</p>}
          {proposal !== null && editor !== null ? (
            <ProposalReview
              editor={editor}
              proposal={proposal}
              onResolved={(outcome) => {
                setProposal(null);
                if (outcome === "accepted") refresh();
              }}
            />
          ) : selectedChangeId !== null ? (
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
            <Editor
              repo={repo}
              path={openPath}
              onSaved={refresh}
              sceneId={sceneIdForEditor}
              aiBusy={aiBusy}
              onRunEdit={(request) => void runEdit(request)}
            />
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
              aiBusy={aiBusy}
              onSceneEdit={(operation, sceneId) =>
                void runEdit(
                  operation === "rewrite_scene" ? { operation, sceneId } : { operation, sceneId },
                )
              }
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
