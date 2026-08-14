import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../tauri";
import type { EditProposal, EditRequest, ManuscriptEditor } from "@jellytind/editing";
import type { SecretStore } from "@jellytind/model-router";
import type { BranchId } from "@jellytind/domain";
import { createManuscriptEditor, explainEditError } from "../lib/editing";
import {
  PANEL_GROUPS,
  firstPanelOfGroup,
  panelById,
  panelsInGroup,
  visiblePanels,
  type LeftPanelId,
  type PanelGroupId,
} from "../lib/panels";
import { GenreRuntime, extensionKindsFor } from "@jellytind/genre";
import type { Theme } from "../lib/theme";
import { CommandPalette, type Command } from "./CommandPalette";
import { Wordmark } from "./Wordmark";
import { VersionsPanel } from "./VersionsPanel";
import { VoicePanel } from "./VoicePanel";
import { openOnBranch, type ProjectSession } from "../repo/session";
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
import { DebugPanel } from "./DebugPanel";
import { SkillsPanel } from "./SkillsPanel";
import { WorkflowPanel } from "./WorkflowPanel";
import { ReadersPanel } from "./ReadersPanel";
import { BehaviourPanel } from "./BehaviourPanel";
import { MysteryPanel } from "./MysteryPanel";
import { ModulesPanel } from "./ModulesPanel";
import { WorldPanel } from "./WorldPanel";
import { CausalityPanel } from "./CausalityPanel";
import { RefactorPanel } from "./RefactorPanel";

type RightTab = "inspector" | "agent" | "context";

const RIGHT_TABS: readonly { id: RightTab; label: string; purpose: string }[] = [
  { id: "inspector", label: "Inspector", purpose: "The record behind the current selection" },
  { id: "agent", label: "Agent", purpose: "Put an agent to work on the project" },
  { id: "context", label: "Context", purpose: "Exactly what a model would be given" },
];

interface WorkspaceProps {
  session: ProjectSession;
  onSession: (session: ProjectSession) => void;
  secrets: SecretStore;
  theme: Theme;
  onChangeTheme: (theme: Theme) => void;
  onClose: () => void;
  onOpenSettings: () => void;
}

export function Workspace({
  session,
  onSession,
  secrets,
  theme,
  onChangeTheme,
  onClose,
  onOpenSettings,
}: WorkspaceProps) {
  const repo = session.repo;
  const [tab, setTab] = useState<LeftPanelId>("files");
  const [pendingSwitch, setPendingSwitch] = useState<BranchId | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  /** Saves whatever the editor is holding. Registered by the editor itself. */
  const flushEditor = useRef<(() => Promise<boolean>) | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [group, setGroup] = useState<PanelGroupId>("project");
  const [paletteOpen, setPaletteOpen] = useState(false);
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

  const [enabledModuleIds, setEnabledModuleIds] = useState<readonly string[]>([]);

  const refresh = () => setRefreshToken((n) => n + 1);

  /**
   * Attach the genre framework, and learn which modules are on.
   *
   * Done here rather than in the session so the repository stays independent of
   * the framework: the app is what decides to wire the two together
   * (docs/GENRE_MODULES.md).
   */
  useEffect(() => {
    GenreRuntime.attach(repo);
    void repo.modules.enabled().then(setEnabledModuleIds);
  }, [repo, refreshToken]);

  /**
   * Nothing leaves the building with unsaved words in its pockets.
   *
   * The frontend cannot be trusted to have flushed in time, so the window's own
   * close request is intercepted: Manu saves first and only then closes. If the
   * save fails — a disk error, or a file changed outside Manu — the close is
   * cancelled and the writer is left looking at the problem rather than at
   * nothing (MANU-004).
   */
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        const flush = flushEditor.current;
        if (flush === null) return;
        event.preventDefault();
        const saved = await flush();
        if (saved) await getCurrentWindow().destroy();
        else setActivityLine("Could not save — closing cancelled. Your text is still here.");
      })
      .then((off) => {
        unlisten = off;
      });
    return () => unlisten?.();
  }, []);

  /** The panels this project can currently see — one filter, used everywhere. */
  const panels = useMemo(
    () =>
      visiblePanels(enabledModuleIds, {
        hasExtensionKinds: extensionKindsFor(enabledModuleIds).length > 0,
      }),
    [enabledModuleIds],
  );

  // Switching a module off while looking at its panel would otherwise leave the
  // writer on a tab that is no longer in the strip.
  useEffect(() => {
    if (!panels.some((panel) => panel.id === tab)) setTab(firstPanelOfGroup(group, panels));
  }, [panels, tab, group]);
  const showActivity = useCallback((line: string | null) => setActivityLine(line), []);

  /** Open a panel and bring its group with it, from wherever the request came. */
  const openPanel = useCallback((id: LeftPanelId) => {
    setTab(id);
    setGroup(panelById(id).group);
  }, []);

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

  /**
   * Switching versions re-opens the project against different files. Anything
   * held only in the editor's buffer or in a staged proposal belongs to the
   * version it was written on, so the writer is told what would be lost and
   * has to say so explicitly (docs/VERSIONING.md).
   */
  const performSwitch = useCallback(
    async (branchId: BranchId) => {
      setSwitchError(null);
      try {
        const next = await openOnBranch(session, branchId);
        setProposal(null);
        setEditor(null);
        setSelectedChangeId(null);
        setSelectedEntityId(null);
        setOpenPath(null);
        setEditorDirty(false);
        setPendingSwitch(null);
        onSession(next);
      } catch (cause) {
        setSwitchError(cause instanceof Error ? cause.message : "Could not switch version.");
      }
    },
    [onSession, session],
  );

  const unsaved: string[] = [];
  if (editorDirty && openPath !== null) unsaved.push(`unsaved changes in ${openPath}`);
  if (proposal !== null) unsaved.push("an AI proposal you have not accepted or discarded");

  const sceneIdForEditor =
    selectedEntityId?.startsWith("SCENE_") === true ? selectedEntityId : null;

  const commands = useMemo<readonly Command[]>(() => {
    const goTo = panels.map<Command>((panel) => ({
      id: `panel.${panel.id}`,
      section: "Go to",
      label: panel.label,
      hint: panel.purpose,
      run: () => openPanel(panel.id),
    }));
    const inspectors = RIGHT_TABS.map<Command>((entry) => ({
      id: `right.${entry.id}`,
      section: "Show",
      label: entry.label,
      hint: entry.purpose,
      run: () => setRightTab(entry.id),
    }));
    return [
      ...goTo,
      ...inspectors,
      {
        id: "theme.light",
        section: "Appearance",
        label: "Paper",
        hint: "Light theme",
        run: () => onChangeTheme("light"),
      },
      {
        id: "theme.dark",
        section: "Appearance",
        label: "Manu Black",
        hint: "Dark theme",
        run: () => onChangeTheme("dark"),
      },
      {
        id: "theme.system",
        section: "Appearance",
        label: "Match the system",
        hint: "Follow the desktop setting",
        run: () => onChangeTheme("system"),
      },
      {
        id: "app.settings",
        section: "Project",
        label: "Model settings",
        hint: "Providers, models and API keys",
        run: onOpenSettings,
      },
      {
        id: "app.close",
        section: "Project",
        label: "Close project",
        hint: "Return to the start screen",
        run: onClose,
      },
    ];
  }, [onChangeTheme, onClose, onOpenSettings, openPanel]);

  // Keyboard first: the palette reaches everything, and the panels a writer
  // returns to most have a key of their own.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const chord = event.metaKey || event.ctrlKey;
      if (!chord) return;
      const key = event.key.toLowerCase();
      if (key === "k" || (event.shiftKey && key === "p")) {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (key === "b" && !event.shiftKey) {
        event.preventDefault();
        openPanel("build");
      } else if (event.shiftKey && key === "f") {
        event.preventDefault();
        openPanel("search");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openPanel]);

  return (
    <div className="app">
      <header className="titlebar">
        <Wordmark className="titlebar__wordmark" height={18} />
        <span className="titlebar__divider" aria-hidden="true" />
        <span className="titlebar__project" title={repo.project.title}>
          {repo.project.title}
        </span>
        <button
          className="titlebar__version"
          title="Alternative versions of this story"
          onClick={() => openPanel("versions")}
        >
          {session.branch.name}
        </button>
        <span className="titlebar__spacer" />
        <button
          className="btn btn--ghost btn--small"
          onClick={() => setPaletteOpen(true)}
          title="Command palette"
        >
          Commands <kbd className="kbd">⌘K</kbd>
        </button>
        <button className="btn btn--ghost btn--small" onClick={onOpenSettings}>
          Model settings
        </button>
        <button className="btn btn--ghost btn--small" onClick={onClose}>
          Close project
        </button>
      </header>

      <div className="workbench workbench--three">
        <aside className="panel panel--explorer">
          <nav className="groupbar" aria-label="Panel groups">
            {PANEL_GROUPS.map((entry) => (
              <button
                key={entry.id}
                className={`group${group === entry.id ? " group--active" : ""}`}
                aria-current={group === entry.id ? "page" : undefined}
                title={entry.purpose}
                onClick={() => {
                  setGroup(entry.id);
                  if (panelById(tab).group !== entry.id)
                    setTab(firstPanelOfGroup(entry.id, panels));
                }}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          <div className="tabbar" role="tablist" aria-label="Panels">
            {panelsInGroup(group, panels).map((panel) => (
              <button
                key={panel.id}
                role="tab"
                aria-selected={tab === panel.id}
                title={panel.purpose}
                className={`tab${tab === panel.id ? " tab--active" : ""}`}
                onClick={() => setTab(panel.id)}
              >
                {panel.label}
              </button>
            ))}
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
          {tab === "debug" && (
            <DebugPanel
              repo={repo}
              secrets={secrets}
              refreshToken={refreshToken}
              onChanged={refresh}
              onSimulateBehaviour={() => setTab("behaviour")}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                setRightTab("inspector");
              }}
              onOpenScene={(sceneId) => {
                void openScene(sceneId);
              }}
            />
          )}
          {tab === "skills" && (
            <SkillsPanel
              repo={repo}
              secrets={secrets}
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
          {tab === "workflows" && (
            <WorkflowPanel
              repo={repo}
              secrets={secrets}
              refreshToken={refreshToken}
              onChanged={refresh}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                setRightTab("inspector");
              }}
            />
          )}
          {tab === "readers" && (
            <ReadersPanel
              repo={repo}
              secrets={secrets}
              refreshToken={refreshToken}
              onChanged={refresh}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                setRightTab("inspector");
              }}
            />
          )}
          {tab === "behaviour" && (
            <BehaviourPanel
              repo={repo}
              secrets={secrets}
              refreshToken={refreshToken}
              onChanged={refresh}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                setRightTab("inspector");
              }}
              onOpenScene={(id) => {
                void openScene(id);
              }}
            />
          )}
          {tab === "modules" && (
            <ModulesPanel repo={repo} refreshToken={refreshToken} onChanged={refresh} />
          )}
          {tab === "world" && (
            <WorldPanel
              repo={repo}
              refreshToken={refreshToken}
              onChanged={refresh}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                setRightTab("inspector");
              }}
            />
          )}
          {tab === "mystery" && (
            <MysteryPanel
              repo={repo}
              refreshToken={refreshToken}
              onChanged={refresh}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                setRightTab("inspector");
              }}
              onOpenScene={(id) => {
                void openScene(id);
              }}
            />
          )}
          {tab === "causality" && (
            <CausalityPanel
              repo={repo}
              secrets={secrets}
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
          {tab === "refactor" && (
            <RefactorPanel
              repo={repo}
              secrets={secrets}
              refreshToken={refreshToken}
              onChanged={refresh}
              onSelectEntity={(id) => {
                setSelectedEntityId(id);
                setRightTab("inspector");
              }}
            />
          )}
          {tab === "versions" && (
            <VersionsPanel
              session={session}
              onSwitch={(branchId) => setPendingSwitch(branchId)}
              onChanged={refresh}
            />
          )}
          {tab === "voice" && (
            <VoicePanel repo={repo} refreshToken={refreshToken} onChanged={refresh} />
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
              root={session.root}
              path={openPath}
              onSaved={refresh}
              sceneId={sceneIdForEditor}
              aiBusy={aiBusy}
              onRunEdit={(request) => void runEdit(request)}
              onDirtyChange={setEditorDirty}
              onRegisterFlush={(flush) => {
                flushEditor.current = flush;
              }}
            />
          )}
        </main>

        <aside className="panel panel--inspector">
          <div className="tabbar" role="tablist" aria-label="Inspectors">
            {RIGHT_TABS.map((entry) => (
              <button
                key={entry.id}
                role="tab"
                aria-selected={rightTab === entry.id}
                title={entry.purpose}
                className={`tab${rightTab === entry.id ? " tab--active" : ""}`}
                onClick={() => setRightTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
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

      <footer className="statusbar">
        <span className="statusbar__id">
          {repo.project.id} · schema v{repo.project.schemaVersion}
        </span>
        {activityLine !== null && (
          <span className="statusbar__activity" role="status">
            {activityLine}
          </span>
        )}
        <span className="titlebar__spacer" />
        <label className="statusbar__theme">
          <span className="visually-hidden">Appearance</span>
          <select
            value={theme}
            onChange={(event) => onChangeTheme(event.target.value as Theme)}
            aria-label="Appearance"
          >
            <option value="system">System</option>
            <option value="light">Paper</option>
            <option value="dark">Manu Black</option>
          </select>
        </label>
      </footer>

      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}

      {pendingSwitch !== null && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-label="Switch version">
            <div className="modal__header">
              <h2>Switch version</h2>
            </div>
            <div className="modal__body">
              {unsaved.length === 0 ? (
                <p>
                  Everything on <strong>{session.branch.name}</strong> is saved. Switching leaves it
                  exactly as it is, and you can come back to it whenever you like.
                </p>
              ) : (
                <>
                  <p className="review__label review__label--warn">Not saved yet</p>
                  <p>
                    Switching now would leave this behind on <strong>{session.branch.name}</strong>:
                  </p>
                  <ul className="review__warnings">
                    {unsaved.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <p className="hint">
                    Save the file, or accept or discard the proposal, then switch again.
                  </p>
                </>
              )}
              {switchError !== null && (
                <p className="status status--error" role="alert">
                  {switchError}
                </p>
              )}
              <div className="modal__actions">
                <button
                  className="btn btn--primary"
                  disabled={unsaved.length > 0}
                  onClick={() => void performSwitch(pendingSwitch)}
                >
                  Switch
                </button>
                <button className="btn" onClick={() => setPendingSwitch(null)}>
                  Stay here
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
