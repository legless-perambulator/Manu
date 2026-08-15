import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../tauri";
import type { EditProposal, EditRequest, ManuscriptEditor } from "@jellytind/editing";
import type { SecretStore } from "@jellytind/model-router";
import type { BranchId } from "@jellytind/domain";
import { createManuscriptEditor, explainEditError } from "../lib/editing";
import {
  PANELS,
  PANEL_GROUPS,
  panelById,
  visiblePanels,
  type DockSide,
  type LeftPanelId,
} from "../lib/panels";
import {
  PRESETS,
  closePanel,
  loadLayout,
  movePanel,
  openPanel as openPanelIn,
  presetLayout,
  repairLayout,
  resizeDock,
  saveLayout,
  setActive,
  setFocus,
  toggleDock,
  type WorkbenchLayout,
} from "../lib/workbench";
import { loadStyle, saveStyle, type ManuscriptStyle } from "../lib/typography";
import { loadWorkspaceState, saveWorkspaceState } from "../lib/workspace-state";
import { SessionWords } from "../lib/session-words";
import { GenreRuntime, extensionKindsFor } from "@jellytind/genre";
import type { Theme } from "../lib/theme";
import { CommandPalette, type Command } from "./CommandPalette";
import { Wordmark } from "./Wordmark";
import { VersionsPanel } from "./VersionsPanel";
import { VoicePanel } from "./VoicePanel";
import { openOnBranch, type ProjectSession } from "../repo/session";
import { ProjectExplorer } from "./ProjectExplorer";
import { ManuscriptPanel } from "./ManuscriptPanel";
import { OutlinePanel } from "./OutlinePanel";
import { DocumentsPanel } from "./DocumentsPanel";
import { CharacterSheet } from "./CharacterSheet";
import { ManuscriptAppearance } from "./ManuscriptAppearance";
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
import { UsagePanel } from "./UsagePanel";
import { StoryMapPanel, type MapFocus } from "./StoryMapPanel";
import { WorldPanel } from "./WorldPanel";
import { CausalityPanel } from "./CausalityPanel";
import { ChapterBuildPanel } from "./ChapterBuildPanel";
import { ChapterPlanPanel } from "./ChapterPlanPanel";
import { ActBuildPanel } from "./ActBuildPanel";
import { BookBuildPanel } from "./BookBuildPanel";
import { ResearchPanel } from "./ResearchPanel";
import { RefactorPanel } from "./RefactorPanel";
import { TerminalPanel } from "./TerminalPanel";
import { MappingPanel } from "./MappingPanel";
import { ExportPanel } from "./ExportPanel";
import { UniversePanel } from "./UniversePanel";
import {
  buildCommandSet,
  paletteEntries,
  type CommandEnvironment,
  type ManuCommands,
} from "../lib/commands";

interface WorkspaceProps {
  session: ProjectSession;
  onSession: (session: ProjectSession) => void;
  secrets: SecretStore;
  theme: Theme;
  onChangeTheme: (theme: Theme) => void;
  onClose: () => void;
  onOpenSettings: () => void;
  /** Open a file immediately. Used by the browser preview harness. */
  initialPath?: string;
}

/**
 * The workbench.
 *
 * The manuscript is the centre and everything else is a panel the writer may
 * or may not want today. The arrangement lives in `lib/workbench.ts` as data;
 * this component renders it, and every change goes through one of that
 * module's verbs so the rules — a panel in one dock only, the manuscript never
 * squeezed below its floor, a layout that survives a change of display — hold
 * in one place rather than in fifteen event handlers (docs/UX.md).
 */
export function Workspace({
  session,
  onSession,
  secrets,
  theme,
  onChangeTheme,
  onClose,
  onOpenSettings,
  initialPath,
}: WorkspaceProps) {
  const repo = session.repo;
  const [pendingSwitch, setPendingSwitch] = useState<BranchId | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  /** Saves whatever the editor is holding. Registered by the editor itself. */
  const flushEditor = useRef<(() => Promise<boolean>) | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [openPath, setOpenPath] = useState<string | null>(initialPath ?? null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [activityLine, setActivityLine] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  /** A semantic finding handed to the Story Debugger as its opening problem. */
  const [debugSeed, setDebugSeed] = useState<string | null>(null);
  /** Where the Story Map should land next: search results, a refactor focus. */
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);
  /** The command set the terminal and the palette share (Phase 39). */
  const [commandSet, setCommandSet] = useState<ManuCommands | null>(null);
  /** A line the palette asked the terminal to run. */
  const [terminalSeed, setTerminalSeed] = useState<{ line: string; nonce: number } | null>(null);
  /** Hand-offs from terminal commands into the workflows that own the work. */
  const [searchSeed, setSearchSeed] = useState<string | null>(null);
  const [refactorSeed, setRefactorSeed] = useState<string | null>(null);
  const [versionSeed, setVersionSeed] = useState<string | null>(null);
  const [chapterBuildSeed, setChapterBuildSeed] = useState<string | null>(null);
  const [skillSeed, setSkillSeed] = useState<string | null>(null);
  const [debugCommandSeed, setDebugCommandSeed] = useState<string | null>(null);
  const [editor, setEditor] = useState<ManuscriptEditor | null>(null);
  const [proposal, setProposal] = useState<EditProposal | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [enabledModuleIds, setEnabledModuleIds] = useState<readonly string[]>([]);
  const [layout, setLayout] = useState<WorkbenchLayout>(() =>
    loadLayout(PANELS.map((panel) => panel.id)),
  );
  const [style, setStyle] = useState<ManuscriptStyle>(loadStyle);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [words, setWords] = useState(0);
  const session_ = useRef(new SessionWords());
  const [sessionTotal, setSessionTotal] = useState(0);
  const workbench = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef(0);
  /** Where the writer was when this project was last open. */
  const remembered = useRef(loadWorkspaceState(session.root));

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
   * Build the command set: the standard commands plus every skill's /command,
   * including the project's own custom skills — rebuilt when modules or the
   * project change so the registry mirrors what is really available.
   */
  useEffect(() => {
    let active = true;
    void buildCommandSet(repo, enabledModuleIds).then((built) => {
      if (active) setCommandSet(built);
    });
    return () => {
      active = false;
    };
  }, [repo, enabledModuleIds, refreshToken]);

  /** The panels this project can currently see — one filter, used everywhere. */
  const panels = useMemo(
    () =>
      visiblePanels(enabledModuleIds, {
        hasExtensionKinds: extensionKindsFor(enabledModuleIds).length > 0,
      }),
    [enabledModuleIds],
  );

  // Switching a module off while its panel is docked would otherwise leave a
  // tab whose content no longer exists.
  useEffect(() => {
    setLayout((current) =>
      repairLayout(
        current,
        panels.map((panel) => panel.id),
      ),
    );
  }, [panels]);

  useEffect(() => saveLayout(layout), [layout]);

  /**
   * Put the writer back in front of their words.
   *
   * Reopening a novel should not begin with a file picker. The document that
   * was open is restored, and a project opened for the first time lands on its
   * first chapter rather than on nothing (§28).
   */
  useEffect(() => {
    if (openPath !== null) return;
    let active = true;
    void (async () => {
      const place = remembered.current;
      if (place.path !== null && (await repo.readProjectFile(place.path)) !== null) {
        if (active) setOpenPath(place.path);
        return;
      }
      const first = [...(await repo.listChapters())].sort((a, b) => a.order - b.order)[0];
      if (active && first !== undefined) setOpenPath(first.filePath);
    })();
    return () => {
      active = false;
    };
    // Runs once per project: this is where the writer *was*, not a control.
  }, [repo]);

  // Remember the place as it moves, so a crash loses at most the last document.
  useEffect(() => {
    if (openPath === null) return;
    saveWorkspaceState(session.root, { path: openPath, caret: caretRef.current, scroll: 0 });
  }, [openPath, session.root]);

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

  const showActivity = useCallback((line: string | null) => setActivityLine(line), []);

  /** Show a panel. One verb, whether the request came from a click or a chord. */
  const showPanel = useCallback((id: LeftPanelId, side?: DockSide) => {
    setLayout((current) => openPanelIn(current, id, side));
  }, []);

  const selectEntity = useCallback((id: string) => {
    setSelectedEntityId(id);
    setLayout((current) =>
      openPanelIn(current, id.startsWith("CHAR_") ? "characters" : "inspector"),
    );
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
      setLayout((current) => openPanelIn(current, "inspector"));
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
  if (editorDirty && openPath !== null) unsaved.push("unsaved changes in the open document");
  if (proposal !== null) unsaved.push("an AI proposal you have not accepted or discarded");

  const sceneIdForEditor =
    selectedEntityId?.startsWith("SCENE_") === true ? selectedEntityId : null;

  const noteWords = useCallback((path: string, count: number) => {
    setWords(count);
    session_.current.update(path, count);
    setSessionTotal(session_.current.total);
  }, []);

  const noteCaret = useCallback((_path: string, caret: number) => {
    caretRef.current = caret;
  }, []);

  const toggleFocus = useCallback(() => {
    setLayout((current) => setFocus(current, !current.focus));
  }, []);

  /**
   * What a terminal command may do to the workbench. Seeds hand work to the
   * panel that owns it — the terminal never holds a workflow of its own, and
   * never applies what a workflow would stage (Phase 39 §8, §9).
   */
  const environment = useMemo<CommandEnvironment>(
    () => ({
      repo,
      enabledModules: enabledModuleIds,
      openPath,
      showPanel,
      openFile: setOpenPath,
      selectEntity,
      openScene: (sceneId: string) => void openScene(sceneId),
      seedDebug: setDebugCommandSeed,
      seedRefactor: setRefactorSeed,
      seedSearch: setSearchSeed,
      seedVersionName: setVersionSeed,
      seedChapterBuild: setChapterBuildSeed,
      seedSkill: setSkillSeed,
      focusMap: setMapFocus,
      toggleFocusMode: toggleFocus,
    }),
    [repo, enabledModuleIds, openPath, showPanel, selectEntity, openScene, toggleFocus],
  );

  const commands = useMemo<readonly Command[]>(() => {
    const goTo = panels.map<Command>((panel) => ({
      id: `panel.${panel.id}`,
      section: PANEL_GROUPS.find((group) => group.id === panel.group)?.label ?? "Go to",
      label: panel.label,
      hint: panel.purpose,
      run: () => showPanel(panel.id),
    }));
    const presets = PRESETS.filter((preset) => preset.id !== "custom").map<Command>((preset) => ({
      id: `preset.${preset.id}`,
      section: "Workspace",
      label: preset.label,
      hint: preset.purpose,
      run: () =>
        setLayout(
          repairLayout(
            presetLayout(preset.id),
            panels.map((p) => p.id),
          ),
        ),
    }));
    // The palette and the terminal share one registry (Phase 39 §6): every
    // no-argument command is a palette entry that runs through the terminal.
    const terminalCommands =
      commandSet === null
        ? []
        : paletteEntries(commandSet, (line) => {
            setTerminalSeed({ line, nonce: Date.now() });
            showPanel("terminal");
          });
    return [
      ...goTo,
      ...presets,
      ...terminalCommands,
      {
        id: "layout.focus",
        section: "Workspace",
        label: "Focus Mode",
        hint: "The manuscript alone — ⌘⇧Return",
        run: toggleFocus,
      },
      {
        id: "layout.left",
        section: "Workspace",
        label: "Toggle the left panel",
        hint: "⌘⇧E",
        run: () => setLayout((current) => toggleDock(current, "left")),
      },
      {
        id: "layout.right",
        section: "Workspace",
        label: "Toggle the right panel",
        hint: "⌘⇧I",
        run: () => setLayout((current) => toggleDock(current, "right")),
      },
      {
        id: "manuscript.appearance",
        section: "Manuscript",
        label: "How the manuscript is set",
        hint: "Typeface, size, line height, measure",
        run: () => setAppearanceOpen(true),
      },
      {
        id: "theme.dark",
        section: "Appearance",
        label: "Manu Dark",
        hint: "The default appearance",
        run: () => onChangeTheme("dark"),
      },
      {
        id: "theme.light",
        section: "Appearance",
        label: "Paper",
        hint: "The light appearance",
        run: () => onChangeTheme("light"),
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
        label: "AI providers",
        hint: "Connections, models and API keys",
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
  }, [panels, commandSet, showPanel, toggleFocus, onChangeTheme, onOpenSettings, onClose]);

  /**
   * The workbench's keyboard layer.
   *
   * Every chord here is shifted or unshared, because the manuscript owns the
   * unshifted ones — ⌘B is bold, not Story Build. A writer's most frequent
   * action wins the shortest chord.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && layout.focus) {
        event.preventDefault();
        setLayout((current) => setFocus(current, false));
        return;
      }
      const chord = event.metaKey || event.ctrlKey;
      if (!chord) return;
      const key = event.key.toLowerCase();
      if (key === "k" || (event.shiftKey && key === "p")) {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.shiftKey && key === "enter") {
        event.preventDefault();
        toggleFocus();
      } else if (event.shiftKey && key === "b") {
        event.preventDefault();
        showPanel("build");
      } else if (event.shiftKey && key === "f") {
        event.preventDefault();
        showPanel("search");
      } else if (key === "`") {
        event.preventDefault();
        showPanel("terminal");
      } else if (event.shiftKey && key === "e") {
        event.preventDefault();
        setLayout((current) => toggleDock(current, "left"));
      } else if (event.shiftKey && key === "i") {
        event.preventDefault();
        setLayout((current) => toggleDock(current, "right"));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showPanel, toggleFocus, layout.focus]);

  /**
   * Drag a dock's edge.
   *
   * The fraction is computed against the workbench's own width, which is what
   * makes the stored value portable to another display (lib/workbench.ts).
   */
  function startResize(side: DockSide, event: ReactPointerEvent) {
    event.preventDefault();
    const container = workbench.current;
    if (container === null) return;
    const bounds = container.getBoundingClientRect();
    const move = (moveEvent: PointerEvent) => {
      const fraction =
        side === "left"
          ? (moveEvent.clientX - bounds.left) / bounds.width
          : (bounds.right - moveEvent.clientX) / bounds.width;
      setLayout((current) => resizeDock(current, side, fraction));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  function renderPanel(id: LeftPanelId): ReactNode {
    switch (id) {
      case "manuscript":
        return (
          <ManuscriptPanel
            repo={repo}
            activePath={openPath}
            onOpenFile={setOpenPath}
            refreshToken={refreshToken}
            onChanged={refresh}
          />
        );
      case "outline":
        return (
          <OutlinePanel
            repo={repo}
            activePath={openPath}
            onOpenFile={setOpenPath}
            onSelectEntity={selectEntity}
            refreshToken={refreshToken}
            onChanged={refresh}
          />
        );
      case "notes":
        return (
          <DocumentsPanel
            repo={repo}
            folder={id}
            activePath={openPath}
            onOpenFile={setOpenPath}
            refreshToken={refreshToken}
            onChanged={refresh}
          />
        );
      case "research":
        return (
          <ResearchPanel
            repo={repo}
            secrets={secrets}
            refreshToken={refreshToken}
            onChanged={refresh}
            selectedEntityId={selectedEntityId}
          />
        );
      case "characters":
        return (
          <CharacterSheet
            repo={repo}
            selectedId={selectedEntityId}
            onSelect={setSelectedEntityId}
            refreshToken={refreshToken}
          />
        );
      case "files":
        return (
          <ProjectExplorer
            repo={repo}
            activePath={openPath}
            onOpenFile={setOpenPath}
            refreshToken={refreshToken}
          />
        );
      case "usage":
        return <UsagePanel repo={repo} refreshToken={refreshToken} />;
      case "entities":
        return (
          <EntitiesPanel
            repo={repo}
            selectedId={selectedEntityId}
            onSelect={selectEntity}
            refreshToken={refreshToken}
            onChanged={refresh}
          />
        );
      case "search":
        return (
          <SearchPanel
            repo={repo}
            onOpenFile={setOpenPath}
            onSelectEntity={selectEntity}
            refreshToken={refreshToken}
            onShowOnMap={(sceneIds) => {
              setMapFocus({ view: "timeline", sceneIds });
              showPanel("storymap");
            }}
            {...(searchSeed !== null ? { seedQuery: searchSeed } : {})}
          />
        );
      case "terminal":
        return (
          <TerminalPanel
            commands={commandSet}
            environment={environment}
            refreshToken={refreshToken}
            seedLine={terminalSeed}
          />
        );
      case "mapping":
        return (
          <MappingPanel
            repo={repo}
            secrets={secrets}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSelectEntity={selectEntity}
          />
        );
      case "export":
        return <ExportPanel repo={repo} refreshToken={refreshToken} />;
      case "universe":
        return <UniversePanel session={session} refreshToken={refreshToken} onChanged={refresh} />;
      case "storymap":
        return (
          <StoryMapPanel
            repo={repo}
            refreshToken={refreshToken}
            onOpenScene={(sceneId) => void openScene(sceneId)}
            onSelectEntity={selectEntity}
            focus={mapFocus}
          />
        );
      case "state":
        return (
          <StatePanel
            repo={repo}
            secrets={secrets}
            refreshToken={refreshToken}
            onChanged={refresh}
          />
        );
      case "knowledge":
        return <KnowledgePanel repo={repo} refreshToken={refreshToken} />;
      case "relations":
        return <RelationshipPanel repo={repo} refreshToken={refreshToken} onChanged={refresh} />;
      case "objects":
        return (
          <ObjectPanel
            repo={repo}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSelectEntity={selectEntity}
          />
        );
      case "threads":
        return (
          <ThreadPanel
            repo={repo}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSelectEntity={selectEntity}
          />
        );
      case "timeline":
        return (
          <TimelinePanel
            repo={repo}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSelectEntity={selectEntity}
          />
        );
      case "world":
        return (
          <WorldPanel
            repo={repo}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSelectEntity={selectEntity}
          />
        );
      case "inspector":
        return (
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
        );
      case "agent":
        return <AgentPanel repo={repo} secrets={secrets} onActivityLine={showActivity} />;
      case "chapterplan":
        return (
          <ChapterPlanPanel
            repo={repo}
            secrets={secrets}
            refreshToken={refreshToken}
            onChanged={refresh}
          />
        );
      case "bookbuild":
        return (
          <BookBuildPanel
            repo={repo}
            secrets={secrets}
            branchId={session.branch.id as string}
            refreshToken={refreshToken}
            onChanged={refresh}
          />
        );
      case "actbuild":
        return (
          <ActBuildPanel
            repo={repo}
            secrets={secrets}
            branchId={session.branch.id as string}
            refreshToken={refreshToken}
            onChanged={refresh}
          />
        );
      case "chapterbuild":
        return (
          <ChapterBuildPanel
            repo={repo}
            secrets={secrets}
            branchId={session.branch.id as string}
            refreshToken={refreshToken}
            onChanged={refresh}
            onOpenFile={setOpenPath}
            {...(chapterBuildSeed !== null ? { seedChapterId: chapterBuildSeed } : {})}
          />
        );
      case "context":
        return <ContextPanel repo={repo} refreshToken={refreshToken} />;
      case "build":
        return (
          <BuildPanel
            repo={repo}
            secrets={secrets}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSelectEntity={selectEntity}
            onOpenScene={(sceneId) => void openScene(sceneId)}
            onDebugFinding={(question) => {
              setDebugSeed(question);
              showPanel("debug");
            }}
          />
        );
      case "tests":
        return (
          <StoryTestPanel
            repo={repo}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSelectEntity={selectEntity}
            onOpenScene={(sceneId) => void openScene(sceneId)}
          />
        );
      case "debug":
        return (
          <DebugPanel
            repo={repo}
            secrets={secrets}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSimulateBehaviour={() => showPanel("behaviour")}
            onSelectEntity={selectEntity}
            onOpenScene={(sceneId) => void openScene(sceneId)}
            {...(debugSeed !== null ? { seedProblem: debugSeed } : {})}
            {...(debugCommandSeed !== null ? { seedCommand: debugCommandSeed } : {})}
          />
        );
      case "skills":
        return (
          <SkillsPanel
            repo={repo}
            secrets={secrets}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSelectEntity={selectEntity}
            onOpenScene={(sceneId) => void openScene(sceneId)}
            {...(skillSeed !== null ? { seedCommand: skillSeed } : {})}
          />
        );
      case "workflows":
        return (
          <WorkflowPanel
            repo={repo}
            secrets={secrets}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSelectEntity={selectEntity}
          />
        );
      case "readers":
        return (
          <ReadersPanel
            repo={repo}
            secrets={secrets}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSelectEntity={selectEntity}
          />
        );
      case "behaviour":
        return (
          <BehaviourPanel
            repo={repo}
            secrets={secrets}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSelectEntity={selectEntity}
            onOpenScene={(id) => void openScene(id)}
          />
        );
      case "mystery":
        return (
          <MysteryPanel
            repo={repo}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSelectEntity={selectEntity}
            onOpenScene={(id) => void openScene(id)}
          />
        );
      case "voice":
        return <VoicePanel repo={repo} refreshToken={refreshToken} onChanged={refresh} />;
      case "history":
        return (
          <HistoryPanel
            repo={repo}
            selectedChangeId={selectedChangeId}
            onSelectChange={setSelectedChangeId}
            refreshToken={refreshToken}
            onChanged={refresh}
          />
        );
      case "versions":
        return (
          <VersionsPanel
            session={session}
            onSwitch={(branchId) => setPendingSwitch(branchId)}
            onChanged={refresh}
            {...(versionSeed !== null ? { seedName: versionSeed } : {})}
          />
        );
      case "causality":
        return (
          <CausalityPanel
            repo={repo}
            secrets={secrets}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSelectEntity={selectEntity}
            onOpenScene={(sceneId) => void openScene(sceneId)}
          />
        );
      case "refactor":
        return (
          <RefactorPanel
            repo={repo}
            secrets={secrets}
            refreshToken={refreshToken}
            onChanged={refresh}
            onSelectEntity={selectEntity}
            onVisualiseImpact={(entityId) => {
              setMapFocus({ view: "causality", focusId: entityId });
              showPanel("storymap");
            }}
            {...(refactorSeed !== null ? { seedInstruction: refactorSeed } : {})}
          />
        );
      case "modules":
        return <ModulesPanel repo={repo} refreshToken={refreshToken} onChanged={refresh} />;
    }
  }

  /*
   * Docks and splitters are render *functions*, not nested components.
   *
   * A component declared inside another is a new type on every render, so React
   * unmounts and remounts its whole subtree — which here would tear down and
   * refetch every panel on every keystroke as the word count changes. Calling
   * them as functions inlines the elements and keeps the panels alive.
   */
  function renderDock(side: DockSide): ReactNode {
    const state = layout[side];
    if (layout.focus || !state.open || state.active === null) return null;
    return (
      <aside className={`dock dock--${side}`} style={{ width: `${state.width * 100}%` }}>
        <div className="dock__tabs" role="tablist" aria-label={`${side} panels`}>
          {state.panels.map((id) => {
            const panel = panelById(id);
            return (
              <span key={id} className="dock__tabwrap">
                <button
                  role="tab"
                  aria-selected={state.active === id}
                  title={panel.purpose}
                  className={`dock__tab${state.active === id ? " dock__tab--active" : ""}`}
                  onClick={() => setLayout((current) => setActive(current, side, id))}
                >
                  {panel.label}
                </button>
                {state.active === id && (
                  <>
                    <button
                      className="dock__act"
                      title={`Move ${panel.label} to the ${side === "left" ? "right" : "left"}`}
                      aria-label={`Move ${panel.label} to the other side`}
                      onClick={() =>
                        setLayout((current) =>
                          movePanel(current, id, side === "left" ? "right" : "left"),
                        )
                      }
                    >
                      {side === "left" ? "⇥" : "⇤"}
                    </button>
                    <button
                      className="dock__act"
                      title={`Close ${panel.label}`}
                      aria-label={`Close ${panel.label}`}
                      onClick={() => setLayout((current) => closePanel(current, id))}
                    >
                      ✕
                    </button>
                  </>
                )}
              </span>
            );
          })}
        </div>
        <div className="dock__body">{renderPanel(state.active)}</div>
      </aside>
    );
  }

  function renderSplitter(side: DockSide): ReactNode {
    const state = layout[side];
    if (layout.focus || !state.open) return null;
    return (
      <div
        className={`splitter splitter--${side}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize the ${side} panel`}
        tabIndex={0}
        onPointerDown={(event) => startResize(side, event)}
        onKeyDown={(event) => {
          const by = event.key === "ArrowLeft" ? -0.02 : event.key === "ArrowRight" ? 0.02 : 0;
          if (by === 0) return;
          event.preventDefault();
          const delta = side === "left" ? by : -by;
          setLayout((current) => resizeDock(current, side, current[side].width + delta));
        }}
      />
    );
  }

  const centre =
    proposal !== null && editor !== null ? (
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
        style={style}
        focus={layout.focus}
        onToggleFocus={toggleFocus}
        onWords={noteWords}
        onCaret={noteCaret}
        initialCaret={remembered.current.path === openPath ? remembered.current.caret : 0}
      />
    );

  return (
    <div className={`app${layout.focus ? " app--focus" : ""}`}>
      {/*
        The application's chrome: who you are, what you are working on, and the
        two things that reach everything else. Every other action moved into the
        More menu or the palette — a row of equal-weight buttons is a menu bar
        that forgot it was one (§26).
      */}
      <header className="titlebar">
        <Wordmark className="titlebar__wordmark" height={18} />
        <span className="titlebar__divider" aria-hidden="true" />
        <span className="titlebar__project" title={`${repo.project.title} · ${session.root}`}>
          {repo.project.title}
        </span>
        <span className="titlebar__spacer" />
        {!layout.focus && (
          <>
            <button
              className="btn btn--ghost btn--small"
              onClick={() => setPaletteOpen(true)}
              title="Everything Manu can do — ⌘K"
            >
              Commands <kbd className="kbd">⌘K</kbd>
            </button>
            <details className="menu">
              <summary className="btn btn--ghost btn--small" aria-label="More">
                ⋯
              </summary>
              {/* Choosing something closes the menu: a disclosure that stays
                  open behind whatever it opened is a stuck panel. */}
              <div
                className="menu__body"
                role="menu"
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest("select") !== null) return;
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                <span className="menu__title">Workspace</span>
                {PRESETS.filter((preset) => preset.id !== "custom").map((preset) => (
                  <button
                    key={preset.id}
                    role="menuitem"
                    className={`menu__item${layout.preset === preset.id ? " menu__item--on" : ""}`}
                    onClick={() =>
                      setLayout(
                        repairLayout(
                          presetLayout(preset.id),
                          panels.map((panel) => panel.id),
                        ),
                      )
                    }
                  >
                    {preset.label}
                    <span className="menu__hint">{preset.purpose}</span>
                  </button>
                ))}
                <span className="menu__title">Manuscript</span>
                <button
                  role="menuitem"
                  className="menu__item"
                  onClick={() => setAppearanceOpen(true)}
                >
                  How the manuscript is set
                  <span className="menu__hint">Typeface, size, line height, measure</span>
                </button>
                <span className="menu__title">Project</span>
                <button
                  role="menuitem"
                  className="menu__item"
                  onClick={() => showPanel("versions")}
                >
                  Versions
                  <span className="menu__hint">On {session.branch.name}</span>
                </button>
                <button role="menuitem" className="menu__item" onClick={onOpenSettings}>
                  AI providers
                </button>
                <button role="menuitem" className="menu__item" onClick={onClose}>
                  Close project
                </button>
                <span className="menu__title">Appearance</span>
                <label className="menu__row">
                  <span>Theme</span>
                  <select
                    value={theme}
                    onChange={(event) => onChangeTheme(event.target.value as Theme)}
                    aria-label="Appearance"
                  >
                    <option value="dark">Manu Dark</option>
                    <option value="light">Paper</option>
                    <option value="system">System</option>
                  </select>
                </label>
              </div>
            </details>
          </>
        )}
      </header>

      {aiError !== null && (
        <p className="editor__error" role="alert">
          {aiError}
        </p>
      )}

      <div className="workbench" ref={workbench}>
        {renderDock("left")}
        {renderSplitter("left")}
        <main className="panel panel--editor">{centre}</main>
        {renderSplitter("right")}
        {renderDock("right")}
      </div>

      {!layout.focus && (
        <footer className="statusbar">
          <span className="statusbar__words">
            {words.toLocaleString()} {words === 1 ? "word" : "words"}
          </span>
          {sessionTotal !== 0 && (
            <span className="statusbar__session" title="Net words written since you opened Manu">
              {sessionTotal > 0 ? "+" : ""}
              {sessionTotal.toLocaleString()} this session
            </span>
          )}
          {activityLine !== null && (
            <span className="statusbar__activity" role="status">
              {activityLine}
            </span>
          )}
          <span className="titlebar__spacer" />
          <button
            className="statusbar__branch"
            title="Alternative versions of this story"
            onClick={() => showPanel("versions")}
          >
            {session.branch.name}
          </button>
        </footer>
      )}

      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}

      {appearanceOpen && (
        <ManuscriptAppearance
          style={style}
          onChange={(next) => {
            setStyle(next);
            saveStyle(next);
          }}
          onClose={() => setAppearanceOpen(false)}
        />
      )}

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
