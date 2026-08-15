import {
  SequentialIdGenerator,
  createStoryProjectId,
  entityKindOf,
  normalizeSequenceSnapshot,
  SCHEMA_VERSION,
  APP_FORMAT_VERSION,
  type ProjectManifest,
  type Project,
  type Chapter,
  type Scene,
  type Character,
  type Location,
  type StoryObject,
  type PlotThread,
  type Fact,
  type WorldRule,
  type StoryEvent,
  type Relationship,
  type Setup,
  type Decision,
  type Dependency,
  type DependencyKind,
  type DependencySource,
  type DependencyStatus,
  DEPENDENCY_NODE_KINDS,
  isDependencyNode,
  type Subtlety,
  type ChapterStatus,
  type SceneStatus,
  type CharacterStatus,
  type ObjectStatus,
  type PlotThreadStatus,
  type FactStatus,
  type WorldRuleSeverity,
  type StoryProjectId,
  type ChapterId,
  type SceneId,
  type CharacterId,
  type LocationId,
  type ObjectId,
  type PlotThreadId,
  type FactId,
  type StoryTime,
  type StoryDuration,
  type TemporalLink,
  type TemporalRelation,
  type TravelRule,
  type Assertion,
  type StoryTest,
  type TestScope,
  type TestSeverity,
  orderScenes,
  normaliseStoryTime,
  assertionEntities,
  isDeterministicAssertion,
  DEFAULT_TEST_SEVERITY,
  indexLocations,
  isWithin,
  locationDescendants,
  locationPath,
} from "@jellytind/domain";
import {
  InMemoryProjectStore,
  normalizeProjectPath,
  type ProjectStore,
} from "@jellytind/persistence";
import type { SearchHit, SearchQuery } from "@jellytind/search";
import type { AgentStore } from "@jellytind/agent-runtime";
import {
  checkContinuity,
  checkKnowledgeViolations,
  checkNarrative,
  checkTimeline,
  isOpen,
  isRunning,
  openSetupsBefore,
  setupsForScene,
  factKnowledgeGraph,
  falseBeliefsAt,
  StoryChronology,
  StoryTimeline,
  timelineNodes,
  validateTransition,
  type CharacterState,
  type CharacterTimelineEntry,
  type ContinuityViolation,
  type FactKnowledgeGraph,
  type ObjectChange,
  type ObjectState,
  type ObjectTransfer,
  type KnowledgeViolation,
  type ManuscriptMetrics,
  type NarrativeFinding,
  type ThreadDormancy,
  type ThreadState,
  type ThreadStep,
  QUALITATIVE_LEVELS,
  type DimensionValue,
  type RelationshipChange,
  type RelationshipState,
  type StateBoundary,
  type StateTransition,
  type TimelineNode,
  type TimelinePoint,
  type TimelineView,
  type TimelineViolation,
  type TransitionDraft,
} from "@jellytind/story-state";
import {
  buildStory,
  compareBuilds,
  runStoryTests,
  CORE_RULES,
  type BuildComparison,
  type BuildConfig,
  type BuildContext,
  type BuildInputKind,
  type BuildSummary,
  type SemanticBuildContext,
  type StoryBuild,
  type TestRunSummary,
} from "@jellytind/story-compiler";
import {
  parseDebugCommand,
  traceProblem,
  tracedEntities,
  type DebugReport,
  type DebugReportSummary,
  type DebugRequest,
  type DebugRequestInput,
  type DebugTrace,
  type Diagnosis,
  type Intervention,
  type ParsedCommand,
} from "@jellytind/story-debugger";
import {
  CausalityGraph,
  checkDependencies,
  type BlastRadius,
  type DependencyFinding,
  type DependencyPath,
  type TraversalOptions,
} from "@jellytind/story-causality";
import { RepositoryError } from "./errors";
import { RepositoryAgentStore } from "./agent-store";
import { TransitionStore } from "./state-store";
import { TimelineStore } from "./timeline-store";
import { BuildStore } from "./build-store";
import { TestStore } from "./test-store";
import type { VoiceAttributes, VoiceRule, VoiceTendency } from "@jellytind/domain";
import { VoiceStore } from "./voice-store";
import { CharacterVoiceStore } from "./character-voice-store";
import { representativeLines } from "./character-voice";
import { DebugStore } from "./debug-store";
import { SkillRunStore } from "./skill-run-store";
import { WorkflowRunStore } from "./workflow-run-store";
import { ChapterBuildStore } from "./chapter-build-store";
import { ChapterPlanStore } from "./chapter-plan-store";
import { ActPlanStore } from "./act-plan-store";
import { ActBuildStore } from "./act-build-store";
import { BookPlanStore } from "./book-plan-store";
import { BookBuildStore } from "./book-build-store";
import type { BookPlan, BookPlanFinding } from "@jellytind/domain";
import { ResearchStore } from "./research-store";
import { UsageStore } from "./usage-store";
import { SemanticStore } from "./semantic-store";
import { findResearchPlaceholders } from "@jellytind/domain";
import type { ResearchItem, ResearchScope, ResearchTask } from "@jellytind/domain";
import { listSceneSpans } from "./scene-text";
import type { ChapterPlan, PlanFinding, PlannedScene } from "@jellytind/domain";
import {
  summariseGoalReport,
  type ActGoalResult,
  type ActGoalReport,
  type ActPlan,
  type ActPlanFinding,
} from "@jellytind/domain";
import { ReaderSimulationStore } from "./reader-sim-store";
import { PersonalityStore } from "./personality-store";
import { MysteryStore } from "./mystery-store";
import { DependencyStore } from "./dependency-store";
import { RefactorStore } from "./refactor-store";
import { ProjectSearch } from "./project-search";
import {
  scenesByCharacter,
  scenesByPov,
  scenesByLocation,
  scenesByObject,
  scenesByPlotThread,
  scenesBetweenChapters,
  characterAppearances,
} from "./queries";
import {
  PATHS,
  EXPLORER_ROOTS,
  chapterFilePath,
  characterFilePath,
  locationFilePath,
  objectFilePath,
} from "./paths";
import { GuardedProjectStore } from "@jellytind/persistence";
import { migrateProject } from "./migrations";
import { ProjectBackups } from "./backups";
import { ExtensionStore } from "./extension-store";
import { ModuleStore } from "./module-store";
import type { ModuleRuntime } from "./module-runtime";
import { scaffoldProject } from "./scaffold";
import { buildManifest, validateManifest } from "./manifest";
import { readCatalog, writeCatalog, type CatalogEntity } from "./catalog";
import {
  EntityGraph,
  outgoingEdges,
  type GraphKind,
  type ReferenceEdge,
  type IntegrityReport,
} from "./graph";
import type { HasId } from "./stores";
import { JournaledProjectStore } from "./journaled-store";
import { HistoryStore, type SnapshotFile } from "./history-store";
import type {
  Actor,
  AiProvenance,
  ChangeSet,
  ChangeSetSummary,
  Checkpoint,
  EntityChange,
} from "./history";
import { StagedTransaction, type StagedFileOp } from "./transaction";

const HISTORY_PREFIX = ".writer/revisions/";
const inverseChange = (c: EntityChange["change"]): EntityChange["change"] =>
  c === "created" ? "deleted" : c === "deleted" ? "created" : "updated";

export interface CreateProjectOptions {
  readonly store: ProjectStore;
  readonly title: string;
  readonly rootPath?: string;
  readonly now?: () => string;
  readonly projectId?: StoryProjectId;
}

export interface OpenProjectOptions {
  readonly store: ProjectStore;
  readonly rootPath?: string;
  readonly now?: () => string;
}

export interface ProjectValidation {
  readonly ok: boolean;
  readonly manifest?: ProjectManifest;
  readonly errors: readonly string[];
  readonly code?: string;
}

/** How to handle a delete when other entities reference the target. */
export type DeleteMode = "prevent" | "unlink";

export interface DeleteResult {
  readonly deletedId: string;
  /** Entities that were modified/removed to remove references (unlink mode). */
  readonly unlinked: readonly string[];
}

/** Attribution for a staged transaction's resulting change set. */
export interface TransactionMeta {
  readonly actor?: Actor;
  readonly operation?: string;
  readonly taskId?: string;
  readonly modelId?: string;
  readonly ai?: AiProvenance;
}

/** True when a transition names this entity anywhere. */
function citesEntity(t: StateTransition, id: string): boolean {
  return t.subjectId === id || t.value === id || t.sourceEntityId === id;
}

const nowIso = (): string => new Date().toISOString();

/** The scene or chapter IDs a test scope names. */
function scopeAnchors(scope: TestScope): string[] {
  if (scope.kind === "always") return [];
  return scope.kind === "between" ? [scope.anchorId, scope.untilId] : [scope.anchorId];
}

/** Words in a chapter file, front matter excluded. */
function countWords(raw: string): number {
  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const words = body.trim().match(/\S+/g);
  return words === null ? 0 : words.length;
}

/**
 * The Story Repository service: the authoritative gateway to a fiction project.
 * Beyond files and the manifest it owns the fiction-domain graph — structured,
 * first-class story entities linked by stable ID, with referential integrity.
 * See docs/STORY_REPOSITORY.md and docs/DOMAIN_MODEL.md.
 */
export class StoryRepository {
  private readonly store: JournaledProjectStore;
  private readonly history: HistoryStore;
  private readonly graph: EntityGraph;
  private readonly search: ProjectSearch;
  private readonly agentStore: RepositoryAgentStore;
  private readonly transitions: TransitionStore;
  private readonly timeline: TimelineStore;
  private readonly builds: BuildStore;
  private readonly tests: TestStore;
  /** The Author Voice profile for this project (docs/AUTHOR_VOICE.md). */
  readonly voice: VoiceStore;
  /** Per-character speech profiles (docs/CHARACTER_VOICE.md). */
  readonly characterVoices: CharacterVoiceStore;
  /** Runs of Writing Skills, resumable (docs/WRITING_SKILLS.md). */
  readonly skillRuns: SkillRunStore;
  /** Multi-agent workflow runs and their handoffs (docs/ORCHESTRATION.md). */
  readonly workflowRuns: WorkflowRunStore;
  /** Long-form chapter builds, resumable across sessions (docs/CHAPTER_BUILDER.md). */
  readonly chapterBuilds: ChapterBuildStore;
  /** Simulated readers and what they made of the book (docs/SIMULATIONS.md). */
  readonly readerSims: ReaderSimulationStore;
  /** Author-confirmed personality, for character simulation (docs/SIMULATIONS.md). */
  readonly personalities: PersonalityStore;
  /** Chapter plans — the layer between outline and builder (docs/PLANNING.md). */
  readonly plans: ChapterPlanStore;
  /** Act plans — goals that span chapters (docs/ACT_BUILDER.md). */
  readonly actPlans: ActPlanStore;
  /** Act builds, resumable across sessions (docs/ACT_BUILDER.md). */
  readonly actBuilds: ActBuildStore;
  /** The book plan — the top of the planning hierarchy (docs/BOOK_BUILDER.md). */
  readonly bookPlan: BookPlanStore;
  /** Book builds, resumable across sessions and hours (docs/BOOK_BUILDER.md). */
  readonly bookBuilds: BookBuildStore;
  /** The research library — sourced knowledge, apart from canon (docs/RESEARCH.md). */
  readonly research: ResearchStore;
  /** What model calls actually cost, call by call (docs/MODEL_ROUTER.md). */
  readonly usage: UsageStore;
  /** Semantic findings' lifecycle, cache and configuration (docs/STORY_COMPILER.md). */
  readonly semantic: SemanticStore;
  /** Clues, suspects and deductions (docs/MYSTERY_ENGINE.md). */
  readonly mysteries: MysteryStore;
  /** Which genre modules are switched on (docs/GENRE_MODULES.md). */
  readonly modules: ModuleStore;
  /** Records belonging to genre modules (docs/GENRE_MODULES.md). */
  readonly extensions: ExtensionStore;
  /** Bounded local snapshots of everything the writer owns (docs/BACKUPS.md). */
  readonly backups: ProjectBackups;
  private readonly debugReports: DebugStore;
  private readonly dependencies: DependencyStore;
  private readonly refactors: RefactorStore;
  private manifest: ProjectManifest;
  private ids: SequentialIdGenerator;
  private moduleRuntime: ModuleRuntime | null = null;
  /**
   * The external-change guard sitting under every write to a user-owned file.
   * Held so conflicts can be resolved deliberately (docs/STORY_REPOSITORY.md).
   */
  private readonly guarded: GuardedProjectStore;

  private constructor(
    rawStore: ProjectStore,
    manifest: ProjectManifest,
    ids: SequentialIdGenerator,
    private readonly rootPath: string,
    private readonly clock: () => string,
  ) {
    // The guard sits closest to the disk, so nothing above it can overwrite a
    // file that changed underneath Manu. `.writer/` bookkeeping is excluded:
    // nobody hand-edits id-sequences.json, and guarding it would manufacture
    // conflicts a writer could not act on (docs/STORY_REPOSITORY.md).
    this.guarded = new GuardedProjectStore(rawStore);
    this.store = new JournaledProjectStore(this.guarded);
    this.history = new HistoryStore(rawStore);
    this.manifest = manifest;
    this.ids = ids;
    this.graph = new EntityGraph(this.store);
    this.search = new ProjectSearch(this.store, this.graph);
    this.agentStore = new RepositoryAgentStore(rawStore);
    // Journaled: a state transition is canon, so changing it is a change set.
    this.transitions = new TransitionStore(this.store);
    // Likewise chronology: "this happens before that" is an authored claim.
    this.timeline = new TimelineStore(this.store);
    // Not journaled: a build is derived analysis, and running one changes
    // nothing about the story.
    this.builds = new BuildStore(rawStore);
    // Journaled: a story test is the writer's stated intention, and as authored
    // as any other piece of canon.
    this.tests = new TestStore(this.store);
    this.voice = new VoiceStore(this.store);
    this.characterVoices = new CharacterVoiceStore(this.store);
    // Not journaled, for the same reason as builds: investigating a problem is
    // not a change to the story.
    this.debugReports = new DebugStore(rawStore);
    // Not journaled either: running a skill audits the story, it does not
    // change it. The run record is an audit trail, not a revision.
    this.skillRuns = new SkillRunStore(rawStore);
    // Likewise: orchestrating agents is not a change to the story. The changes
    // a workflow commits are ordinary change sets, and the run records them.
    this.workflowRuns = new WorkflowRunStore(rawStore);
    // Same reasoning again: a chapter build's record is progress bookkeeping;
    // the prose it commits arrives as ordinary journaled change sets.
    this.chapterBuilds = new ChapterBuildStore(rawStore);
    // Not journaled either: a reader reading the book changes nothing in it.
    this.readerSims = new ReaderSimulationStore(rawStore);
    // Journaled: what a character is really like is as authored as any other
    // piece of canon, and changing it is a change to the story.
    this.personalities = new PersonalityStore(this.store);
    // Journaled: a plan is the writer's working document, and editing it is a
    // change to the project like editing any plot file (docs/PLANNING.md).
    this.plans = new ChapterPlanStore(this.store);
    // Journaled for the same reason: an act plan is authored plot material.
    this.actPlans = new ActPlanStore(this.store);
    // Not journaled: like a chapter build, an act build's record is progress
    // bookkeeping; what it commits arrives through the child builds' change sets.
    this.actBuilds = new ActBuildStore(rawStore);
    // Journaled: the book plan is the most authored file in the project.
    this.bookPlan = new BookPlanStore(this.store);
    // Not journaled, same reasoning as every other build record.
    this.bookBuilds = new BookBuildStore(rawStore);
    // Items journal (they are authored knowledge, written inside recordChange
    // sessions below); tasks live under .writer/ and pass through unrecorded.
    this.research = new ResearchStore(this.store);
    // Not journaled: accounting is bookkeeping about API spend, not a claim
    // about the story. It is still the writer's money, so it is never lost to
    // a restart — records land on disk as calls complete (Phase 36 §10).
    this.usage = new UsageStore(rawStore);
    // Not journaled: a judgement about the story is not a change to it. The
    // writer's "this is intentional" survives restarts because it is on disk.
    this.semantic = new SemanticStore(rawStore);
    // Journaled: who did it, and what each clue really means, is canon.
    this.mysteries = new MysteryStore(this.store);
    // Not journaled: which modules are switched on is a setting about the
    // workspace, not a claim about the story.
    this.modules = new ModuleStore(rawStore);
    // Journaled, unlike the setting above: a culture or a relationship beat is
    // authored material and belongs in the revision history.
    this.extensions = new ExtensionStore(this.store);
    // Journaled, so a restore appears in History like any other change — the
    // commonest way to lose work with a restore feature is restoring the wrong
    // snapshot, and this makes that reversible too.
    this.backups = new ProjectBackups(this.store);
    // Journaled: a registered dependency is the author's claim about how their
    // story holds together, as authored as a plot thread.
    this.dependencies = new DependencyStore(this.store);
    // Not journaled: the refactor's *change* is a change set; the record of it
    // is an audit trail, and recording that too would double every entry.
    this.refactors = new RefactorStore(rawStore);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  static async createProject(options: CreateProjectOptions): Promise<StoryRepository> {
    const { store } = options;
    const clock = options.now ?? nowIso;

    if (await store.exists(PATHS.manifest)) {
      throw new RepositoryError(
        "already_exists",
        "A project already exists at this location (.writer/project.json present).",
      );
    }

    const title = options.title.trim();
    if (title.length === 0) {
      throw new RepositoryError("invalid_manifest", "Project title must not be empty.");
    }

    const now = clock();
    const manifest = buildManifest({
      id: options.projectId ?? createStoryProjectId(),
      title,
      now,
    });

    await scaffoldProject(store, title);
    await store.writeFile(PATHS.manifest, serialize(manifest));

    const repo = new StoryRepository(
      store,
      manifest,
      new SequentialIdGenerator(),
      options.rootPath ?? "",
      clock,
    );
    // Every project starts with a "Draft 0" checkpoint to revert back to.
    await repo.createCheckpoint("Draft 0");
    return repo;
  }

  static async openProject(options: OpenProjectOptions): Promise<StoryRepository> {
    const { store } = options;
    const validation = await StoryRepository.validateProject(store);
    if (!validation.ok || validation.manifest === undefined) {
      const message = validation.errors[0] ?? "Not a valid project.";
      throw new RepositoryError((validation.code as never) ?? "not_a_project", message);
    }

    // Every schema version is accounted for before anything reads project
    // content: migrated by a registered step, or refused. A version we cannot
    // interpret must never be treated as current (docs/STORY_REPOSITORY.md).
    const migration = await migrateProject(store, validation.manifest);
    const manifest =
      migration.applied.length === 0
        ? validation.manifest
        : ((await StoryRepository.validateProject(store)).manifest ?? validation.manifest);

    const ids = await loadIdGenerator(store);

    return new StoryRepository(store, manifest, ids, options.rootPath ?? "", options.now ?? nowIso);
  }

  /** Validate that a store contains a well-formed project. Never throws. */
  static async validateProject(store: ProjectStore): Promise<ProjectValidation> {
    const raw = await store.readFile(PATHS.manifest);
    if (raw === null) {
      return {
        ok: false,
        errors: ["No project manifest found (.writer/project.json is missing)."],
        code: "not_a_project",
      };
    }
    const parsed = validateManifest(raw);
    if (!parsed.ok) {
      return { ok: false, errors: [parsed.error.message], code: parsed.error.code };
    }

    const missing: string[] = [];
    for (const dir of [...EXPLORER_ROOTS, ".writer"]) {
      if (!(await store.exists(dir))) missing.push(dir);
    }
    return {
      ok: true,
      manifest: parsed.value,
      errors: missing.map((d) => `Expected directory "${d}" is missing.`),
    };
  }

  // ── Metadata ─────────────────────────────────────────────────────────────

  get project(): Project {
    return {
      id: this.manifest.id,
      title: this.manifest.title,
      rootPath: this.rootPath,
      createdAt: this.manifest.createdAt,
      updatedAt: this.manifest.updatedAt,
      schemaVersion: this.manifest.schemaVersion,
    };
  }

  getManifest(): ProjectManifest {
    return this.manifest;
  }

  async saveProjectMetadata(patch: { title?: string }): Promise<ProjectManifest> {
    const title = patch.title?.trim();
    if (title !== undefined && title.length === 0) {
      throw new RepositoryError("invalid_manifest", "Project title must not be empty.");
    }
    await this.recordChange(
      { actor: "human", operation: "update_metadata", summary: "Update project metadata" },
      async () => {
        this.manifest = {
          ...this.manifest,
          ...(title !== undefined ? { title } : {}),
          updatedAt: this.clock(),
        };
        await this.store.writeFile(PATHS.manifest, serialize(this.manifest));
      },
    );
    return this.manifest;
  }

  // ── Safe file operations ─────────────────────────────────────────────────

  async listProjectFiles(prefix?: string): Promise<string[]> {
    return this.store.list(prefix === undefined ? undefined : normalizeProjectPath(prefix));
  }

  /**
   * Read a project file, and take what is there as the version Manu now knows.
   *
   * This is the deliberate refresh the guard does not do on its own: opening a
   * file in Manu means "I have seen this version", which is exactly what makes
   * a later external change detectable (docs/STORY_REPOSITORY.md).
   */
  async readProjectFile(path: string): Promise<string | null> {
    return this.guarded.adopt(normalizeProjectPath(path));
  }

  /**
   * Whether the file on disk is still the one Manu last read or wrote.
   *
   * Cheap enough to call before showing an editor, and the basis of the
   * conflict state the interface surfaces.
   */
  fileIsCurrent(path: string): Promise<boolean> {
    return this.guarded.isCurrent(normalizeProjectPath(path));
  }

  /**
   * Take the version on disk as current, discarding what Manu was holding.
   *
   * Writes nothing. This is "reload the external version" — the safe half of
   * resolving a conflict.
   */
  acceptExternalChange(path: string): Promise<string | null> {
    return this.guarded.adopt(normalizeProjectPath(path));
  }

  /**
   * Overwrite a file whose disk version changed, deliberately.
   *
   * Separate from {@link writeProjectFile} so a destructive overwrite can only
   * happen where somebody asked for one by name. The external content goes into
   * the change set first, so it is recoverable from History afterwards.
   */
  async overwriteProjectFile(path: string, content: string): Promise<void> {
    const safePath = normalizeProjectPath(path);
    await this.guarded.adopt(safePath);
    await this.writeProjectFile(safePath, content);
  }

  async writeProjectFile(path: string, content: string): Promise<void> {
    const safePath = normalizeProjectPath(path);
    await this.recordChange(
      { actor: "human", operation: "edit_file", summary: `Edit ${safePath}` },
      async () => {
        await this.store.writeFile(safePath, content);
        await this.search.onFileWritten(safePath);
        await this.touch();
      },
    );
  }

  async createDirectory(path: string): Promise<void> {
    return this.store.createDirectory(normalizeProjectPath(path));
  }

  async fileExists(path: string): Promise<boolean> {
    return this.store.exists(normalizeProjectPath(path));
  }

  // ── Entity creation ────────────────────────────────────────────────────────

  async addChapter(input: {
    title: string;
    order?: number;
    status?: ChapterStatus;
  }): Promise<Chapter> {
    const id = this.ids.next("chapter");
    const order = input.order ?? (await this.listChapters()).length;
    const chapter: Chapter = {
      id,
      title: input.title,
      order,
      filePath: chapterFilePath(id),
      status: input.status ?? "outline",
    };
    await this.persistEntity("chapter", chapter, chapter.title, chapter.filePath, {
      operation: "add_chapter",
      change: "created",
    });
    return chapter;
  }

  async addScene(input: {
    title: string;
    chapterId?: ChapterId;
    pov?: CharacterId;
    locationId?: LocationId;
    characterIds?: readonly CharacterId[];
    plotThreadIds?: readonly PlotThreadId[];
    objectIds?: readonly ObjectId[];
    factIds?: readonly FactId[];
    purpose?: readonly string[];
    status?: SceneStatus;
    /** Where the scene sits in story-world time — not where it sits in the book. */
    storyTime?: StoryTime | string;
    duration?: StoryDuration;
  }): Promise<Scene> {
    const id = this.ids.next("scene");
    const storyTime = normaliseStoryTime(input.storyTime);
    const scene: Scene = {
      id,
      title: input.title,
      ...(storyTime !== undefined ? { storyTime } : {}),
      ...(input.duration !== undefined ? { duration: input.duration } : {}),
      ...(input.chapterId !== undefined ? { chapterId: input.chapterId } : {}),
      ...(input.pov !== undefined ? { pov: input.pov } : {}),
      ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
      characterIds: input.characterIds ?? [],
      plotThreadIds: input.plotThreadIds ?? [],
      objectIds: input.objectIds ?? [],
      factIds: input.factIds ?? [],
      purpose: input.purpose ?? [],
      status: input.status ?? "planned",
    };
    await this.persistEntity("scene", scene, scene.title, undefined, {
      operation: "add_scene",
      change: "created",
    });
    return scene;
  }

  async addCharacter(input: {
    name: string;
    aliases?: readonly string[];
    description?: string;
    role?: string;
    goals?: readonly string[];
    notes?: string;
    status?: CharacterStatus;
  }): Promise<Character> {
    const id = this.ids.next("character");
    const character: Character = {
      id,
      name: input.name,
      aliases: input.aliases ?? [],
      description: input.description ?? "",
      role: input.role ?? "",
      goals: input.goals ?? [],
      notes: input.notes ?? "",
      status: input.status ?? "active",
      filePath: characterFilePath(id),
    };
    await this.persistEntity("character", character, character.name, character.filePath, {
      operation: "add_character",
      change: "created",
    });
    return character;
  }

  async addLocation(input: {
    name: string;
    aliases?: readonly string[];
    description?: string;
    parentLocationId?: LocationId;
    notes?: string;
  }): Promise<Location> {
    const id = this.ids.next("location");
    const location: Location = {
      id,
      name: input.name,
      aliases: input.aliases ?? [],
      description: input.description ?? "",
      ...(input.parentLocationId !== undefined ? { parentLocationId: input.parentLocationId } : {}),
      notes: input.notes ?? "",
      filePath: locationFilePath(id),
    };
    await this.persistEntity("location", location, location.name, location.filePath, {
      operation: "add_location",
      change: "created",
    });
    return location;
  }

  async addObject(input: {
    name: string;
    aliases?: readonly string[];
    description?: string;
    status?: ObjectStatus;
  }): Promise<StoryObject> {
    const id = this.ids.next("object");
    const object: StoryObject = {
      id,
      name: input.name,
      aliases: input.aliases ?? [],
      description: input.description ?? "",
      status: input.status ?? "exists",
      filePath: objectFilePath(id),
    };
    await this.persistEntity("object", object, object.name, object.filePath, {
      operation: "add_object",
      change: "created",
    });
    return object;
  }

  async addPlotThread(input: {
    name: string;
    description?: string;
    status?: PlotThreadStatus;
    introducedSceneId?: SceneId;
    resolvedSceneId?: SceneId;
    relatedSceneIds?: readonly SceneId[];
  }): Promise<PlotThread> {
    const id = this.ids.next("plot_thread");
    const thread: PlotThread = {
      id,
      name: input.name,
      description: input.description ?? "",
      status: input.status ?? "planned",
      ...(input.introducedSceneId !== undefined
        ? { introducedSceneId: input.introducedSceneId }
        : {}),
      ...(input.resolvedSceneId !== undefined ? { resolvedSceneId: input.resolvedSceneId } : {}),
      relatedSceneIds: input.relatedSceneIds ?? [],
    };
    await this.persistEntity("plot_thread", thread, thread.name, undefined, {
      operation: "add_plot_thread",
      change: "created",
    });
    return thread;
  }

  async addFact(input: {
    statement: string;
    status?: FactStatus;
    /** Whether the proposition is true in the story world. Defaults to true. */
    objectiveTruth?: boolean;
    source?: string;
    notes?: string;
  }): Promise<Fact> {
    const id = this.ids.next("fact");
    const fact: Fact = {
      id,
      statement: input.statement,
      status: input.status ?? "canonical",
      objectiveTruth: input.objectiveTruth ?? true,
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };
    await this.persistEntity("fact", fact, fact.statement, undefined, {
      operation: "add_fact",
      change: "created",
    });
    return fact;
  }

  async addWorldRule(input: {
    name: string;
    description?: string;
    severity?: WorldRuleSeverity;
    scope?: string;
  }): Promise<WorldRule> {
    const id = this.ids.next("world_rule");
    const rule: WorldRule = {
      id,
      name: input.name,
      description: input.description ?? "",
      severity: input.severity ?? "soft",
      scope: input.scope ?? "global",
    };
    await this.persistEntity("world_rule", rule, rule.name, undefined, {
      operation: "add_world_rule",
      change: "created",
    });
    return rule;
  }

  async addEvent(input: {
    name: string;
    description?: string;
    /** Accepts a structured story time, or free-form text to be interpreted. */
    storyTime?: StoryTime | string;
    duration?: StoryDuration;
    sceneId?: SceneId;
    locationId?: LocationId;
    characterIds?: readonly CharacterId[];
    plotThreadIds?: readonly PlotThreadId[];
  }): Promise<StoryEvent> {
    const id = this.ids.next("event");
    const storyTime = normaliseStoryTime(input.storyTime);
    const event: StoryEvent = {
      id,
      name: input.name,
      description: input.description ?? "",
      ...(storyTime !== undefined ? { storyTime } : {}),
      ...(input.duration !== undefined ? { duration: input.duration } : {}),
      ...(input.sceneId !== undefined ? { sceneId: input.sceneId } : {}),
      ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
      characterIds: input.characterIds ?? [],
      plotThreadIds: input.plotThreadIds ?? [],
    };
    await this.persistEntity("event", event, event.name, undefined, {
      operation: "add_event",
      change: "created",
    });
    return event;
  }

  async addRelationship(input: {
    characterAId: CharacterId;
    characterBId: CharacterId;
    type: string;
    /** Starting status. How it evolves is recorded as state transitions. */
    status?: string;
    description?: string;
  }): Promise<Relationship> {
    const id = this.ids.next("relationship");
    const rel: Relationship = {
      id,
      characterAId: input.characterAId,
      characterBId: input.characterBId,
      type: input.type,
      status: input.status ?? "",
      description: input.description ?? "",
    };
    await this.persistEntity("relationship", rel, rel.type, undefined, {
      operation: "add_relationship",
      change: "created",
    });
    return rel;
  }

  /**
   * Register a promise the story makes.
   *
   * A setup connects scenes that nothing in the prose connects, so it is
   * recorded rather than inferred. All three cardinalities work: one planting to
   * one payoff, several plantings to one, or one planting paid off repeatedly
   * (docs/NARRATIVE_THREADS.md).
   */
  async addSetup(input: {
    description: string;
    setupSceneIds?: readonly SceneId[];
    payoffSceneIds?: readonly SceneId[];
    payoffDescription?: string;
    subtlety?: Subtlety;
    intendedInterpretation?: string;
    /** Author-only. Never reaches a reader-facing context. */
    trueMeaning?: string;
    targetThreadId?: PlotThreadId;
    targetRevealId?: FactId;
    notes?: string;
  }): Promise<Setup> {
    const id = this.ids.next("setup");
    const setup: Setup = {
      id,
      description: input.description,
      setupSceneIds: input.setupSceneIds ?? [],
      payoffSceneIds: input.payoffSceneIds ?? [],
      ...(input.payoffDescription !== undefined
        ? { payoffDescription: input.payoffDescription }
        : {}),
      subtlety: input.subtlety ?? "subtle",
      ...(input.intendedInterpretation !== undefined
        ? { intendedInterpretation: input.intendedInterpretation }
        : {}),
      ...(input.trueMeaning !== undefined ? { trueMeaning: input.trueMeaning } : {}),
      ...(input.targetThreadId !== undefined ? { targetThreadId: input.targetThreadId } : {}),
      ...(input.targetRevealId !== undefined ? { targetRevealId: input.targetRevealId } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };
    await this.persistEntity("setup", setup, setup.description, undefined, {
      operation: "add_setup",
      change: "created",
    });
    return setup;
  }

  /**
   * Record a choice a character makes.
   *
   * Optional and deliberate: a story does not need every decision written
   * down, it needs the ones later decisions rest on
   * (docs/STORY_REFACTOR.md — causality).
   */
  async addDecision(input: {
    description: string;
    characterId: CharacterId;
    sceneId?: SceneId;
    reason?: string;
    notes?: string;
  }): Promise<Decision> {
    const id = this.ids.next("decision");
    const decision: Decision = {
      id,
      description: input.description,
      characterId: input.characterId,
      ...(input.sceneId !== undefined ? { sceneId: input.sceneId } : {}),
      ...(input.reason !== undefined ? { reason: input.reason } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    };
    await this.persistEntity("decision", decision, decision.description, undefined, {
      operation: "add_decision",
      change: "created",
    });
    return decision;
  }

  // ── Entity reads ───────────────────────────────────────────────────────────

  listChapters = (): Promise<Chapter[]> => this.listOf<Chapter>("chapter");
  listScenes = (): Promise<Scene[]> => this.listOf<Scene>("scene");
  listCharacters = (): Promise<Character[]> => this.listOf<Character>("character");
  listLocations = (): Promise<Location[]> => this.listOf<Location>("location");
  listObjects = (): Promise<StoryObject[]> => this.listOf<StoryObject>("object");
  listPlotThreads = (): Promise<PlotThread[]> => this.listOf<PlotThread>("plot_thread");
  listFacts = (): Promise<Fact[]> => this.listOf<Fact>("fact");
  listWorldRules = (): Promise<WorldRule[]> => this.listOf<WorldRule>("world_rule");
  listEvents = (): Promise<StoryEvent[]> => this.listOf<StoryEvent>("event");
  listRelationships = (): Promise<Relationship[]> => this.listOf<Relationship>("relationship");
  listSetups = (): Promise<Setup[]> => this.listOf<Setup>("setup");
  listDecisions = (): Promise<Decision[]> => this.listOf<Decision>("decision");

  private async listOf<T>(kind: GraphKind): Promise<T[]> {
    return (await this.graph.store(kind).list()) as unknown as T[];
  }

  /** Fetch any entity by id, inferring its kind from the id prefix. */
  async getEntity<T = Record<string, unknown>>(id: string): Promise<T | null> {
    const kind = kindOf(id);
    if (kind === null) return null;
    return (await this.graph.store(kind).get(id)) as unknown as T | null;
  }

  /** A flat listing of all entities (id, kind, display name) for browsing. */
  async listEntitySummaries(): Promise<Array<{ id: string; kind: GraphKind; name: string }>> {
    const rows = await this.graph.listAll();
    return rows.map(({ kind, entity }) => ({
      id: entity.id as string,
      kind,
      name: displayName(kind, entity),
    }));
  }

  // ── Agent tasks & activity ──────────────────────────────────────────────────

  /**
   * Persistent agent task and activity storage (`.writer/agents/`). Reading the
   * project is not a story mutation, so these writes bypass the change-set
   * journal and never appear in the manuscript's revision history.
   */
  get agents(): AgentStore {
    return this.agentStore;
  }

  // ── Story state ─────────────────────────────────────────────────────────────

  /** Every recorded transition, confirmed or otherwise. */
  listStateTransitions(): Promise<StateTransition[]> {
    return this.transitions.list();
  }

  /**
   * The story-state timeline for this project: scene order plus every
   * transition, ready to answer state questions at any scene boundary
   * (docs/STORY_STATE.md).
   */
  async getStoryTimeline(): Promise<StoryTimeline> {
    const [scenes, chapters, transitions] = await Promise.all([
      this.listScenes(),
      this.listChapters(),
      this.transitions.list(),
    ]);
    return new StoryTimeline(
      orderScenes(scenes, chapters).map((scene) => scene.id as string),
      transitions,
    );
  }

  /**
   * Record state transitions. Every draft is shape-validated and its references
   * checked against the project, so neither an author nor a model can record a
   * transition about an entity that does not exist.
   */
  async addStateTransitions(
    drafts: readonly TransitionDraft[],
    options: {
      source?: StateTransition["source"];
      confirmationStatus?: StateTransition["confirmationStatus"];
      modelId?: string;
      taskId?: string;
      summary?: string;
    } = {},
  ): Promise<StateTransition[]> {
    const now = this.clock();
    const status = options.confirmationStatus ?? "confirmed";
    const prepared: Array<Omit<StateTransition, "id">> = [];

    for (const draft of drafts) {
      validateTransition(draft);
      await this.requireEntities(draft);
      prepared.push({
        sceneId: draft.sceneId,
        kind: draft.kind,
        subjectId: draft.subjectId,
        value: draft.value,
        ...(draft.certainty !== undefined ? { certainty: draft.certainty } : {}),
        ...(draft.knowledgeState !== undefined ? { knowledgeState: draft.knowledgeState } : {}),
        ...(draft.sourceType !== undefined ? { sourceType: draft.sourceType } : {}),
        ...(draft.sourceEntityId !== undefined ? { sourceEntityId: draft.sourceEntityId } : {}),
        ...(draft.movement !== undefined ? { movement: draft.movement } : {}),
        ...(draft.dimension !== undefined ? { dimension: draft.dimension } : {}),
        ...(draft.level !== undefined ? { level: draft.level } : {}),
        ...(draft.magnitude !== undefined ? { magnitude: draft.magnitude } : {}),
        ...(draft.note !== undefined ? { note: draft.note } : {}),
        source: options.source ?? "author",
        confirmationStatus: status,
        ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
        createdAt: now,
        ...(status === "confirmed" ? { confirmedAt: now } : {}),
      });
    }

    let stored: StateTransition[] = [];
    await this.recordChange(
      {
        actor: options.source === "agent" ? "agent" : "human",
        operation: status === "proposed" ? "propose_state" : "record_state",
        summary:
          options.summary ??
          `${status === "proposed" ? "Propose" : "Record"} ${String(prepared.length)} state transition(s)`,
        ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
        ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
      },
      async () => {
        stored = await this.transitions.append(prepared);
        await this.touch();
      },
    );
    return stored;
  }

  /** Correct a transition. Re-validated, so a correction cannot break the rules. */
  async updateStateTransition(
    id: string,
    patch: Partial<TransitionDraft>,
  ): Promise<StateTransition> {
    const existing = await this.transitions.get(id);
    if (existing === null) {
      throw new RepositoryError("entity_not_found", `No state transition with id ${id}.`);
    }
    const merged: TransitionDraft = {
      sceneId: patch.sceneId ?? existing.sceneId,
      kind: patch.kind ?? existing.kind,
      subjectId: patch.subjectId ?? existing.subjectId,
      value: patch.value ?? existing.value,
      ...((patch.certainty ?? existing.certainty) !== undefined
        ? { certainty: patch.certainty ?? existing.certainty }
        : {}),
      ...((patch.howLearned ?? existing.howLearned) !== undefined
        ? { howLearned: patch.howLearned ?? existing.howLearned }
        : {}),
    };
    validateTransition(merged);
    await this.requireEntities(merged);

    let updated: StateTransition | null = null;
    await this.recordChange(
      { actor: "human", operation: "update_state", summary: `Correct state transition ${id}` },
      async () => {
        updated = await this.transitions.update(id, {
          ...merged,
          ...(patch.note !== undefined ? { note: patch.note } : {}),
        });
        await this.touch();
      },
    );
    if (updated === null) {
      throw new RepositoryError("entity_not_found", `No state transition with id ${id}.`);
    }
    return updated;
  }

  /** Confirm or reject a proposed transition. Only confirmation makes it canon. */
  async setTransitionStatus(
    id: string,
    status: StateTransition["confirmationStatus"],
  ): Promise<StateTransition> {
    const now = this.clock();
    let updated: StateTransition | null = null;
    await this.recordChange(
      {
        actor: "human",
        operation: `${status}_state`,
        summary: `Mark state transition ${id} ${status}`,
      },
      async () => {
        updated = await this.transitions.update(id, {
          confirmationStatus: status,
          ...(status === "confirmed" ? { confirmedAt: now } : {}),
        });
        await this.touch();
      },
    );
    if (updated === null) {
      throw new RepositoryError("entity_not_found", `No state transition with id ${id}.`);
    }
    return updated;
  }

  async deleteStateTransition(id: string): Promise<void> {
    await this.recordChange(
      { actor: "human", operation: "delete_state", summary: `Delete state transition ${id}` },
      async () => {
        if (!(await this.transitions.remove(id))) {
          throw new RepositoryError("entity_not_found", `No state transition with id ${id}.`);
        }
        await this.touch();
      },
    );
  }

  /** Every ID a transition names must exist in the project. */
  private async requireEntities(draft: TransitionDraft): Promise<void> {
    const ids = [draft.sceneId, draft.subjectId, draft.value, draft.sourceEntityId ?? ""].filter(
      (id) => id !== "" && entityKindOf(id) !== null,
    );
    for (const id of ids) {
      if ((await this.getEntity(id)) === null) {
        throw new RepositoryError(
          "entity_not_found",
          `State transition references "${id}", which does not exist in this project.`,
        );
      }
    }
  }

  /**
   * Everyone's position on one proposition at a boundary — the knowledge graph
   * for a fact (docs/STORY_STATE.md).
   */
  async getFactKnowledgeGraph(
    factId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): Promise<FactKnowledgeGraph> {
    const [timeline, fact] = await Promise.all([
      this.getStoryTimeline(),
      this.getEntity<Fact>(factId),
    ]);
    if (fact === null) {
      throw new RepositoryError("entity_not_found", `No fact with id ${factId}.`);
    }
    return factKnowledgeGraph(timeline, fact, asOf, {
      characterIds: (await this.listCharacters()).map((c) => c.id as string),
      view,
    });
  }

  // ── Relationships over time ─────────────────────────────────────────────────

  /**
   * A relationship as it stood at a story moment.
   *
   * "Elias and Mara are allies" is not an answer; this is. Identity comes from
   * the entity, everything mutable is replayed from transitions up to the
   * boundary, so an earlier scene never sees a later scene's state
   * (docs/STORY_STATE.md).
   */
  async getRelationshipAt(
    relationshipId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): Promise<RelationshipState> {
    const [timeline, rel] = await Promise.all([
      this.getStoryTimeline(),
      this.getEntity<Relationship>(relationshipId),
    ]);
    if (rel === null) {
      throw new RepositoryError("entity_not_found", `No relationship with id ${relationshipId}.`);
    }
    return timeline.relationshipStateAt(rel, asOf, view);
  }

  getRelationshipBeforeScene(
    relationshipId: string,
    sceneId: string,
    view: TimelineView = {},
  ): Promise<RelationshipState> {
    return this.getRelationshipAt(relationshipId, { sceneId, position: "before" }, view);
  }

  getRelationshipAfterScene(
    relationshipId: string,
    sceneId: string,
    view: TimelineView = {},
  ): Promise<RelationshipState> {
    return this.getRelationshipAt(relationshipId, { sceneId, position: "after" }, view);
  }

  /** Every recorded change to one relationship, in story order. */
  async getRelationshipHistory(
    relationshipId: string,
    view: TimelineView = {},
  ): Promise<RelationshipChange[]> {
    return (await this.getStoryTimeline()).relationshipHistory(relationshipId, view);
  }

  /** Every relationship a character is part of, as it stood at a boundary. */
  async getRelationshipsForCharacter(
    characterId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): Promise<RelationshipState[]> {
    const [timeline, relationships] = await Promise.all([
      this.getStoryTimeline(),
      this.listRelationships(),
    ]);
    return relationships
      .filter((r) => r.characterAId === characterId || r.characterBId === characterId)
      .map((r) => timeline.relationshipStateAt(r, asOf, view));
  }

  /** Relationship changes recorded anywhere in a chapter. */
  async getRelationshipChangesInChapter(
    chapterId: string,
    view: TimelineView = {},
  ): Promise<RelationshipChange[]> {
    const [timeline, scenes] = await Promise.all([this.getStoryTimeline(), this.listScenes()]);
    return timeline.relationshipChangesInScenes(
      scenes.filter((s) => s.chapterId === chapterId).map((s) => s.id as string),
      view,
    );
  }

  // ── Story tests ─────────────────────────────────────────────────────────────

  /** Every story test, enabled or not. */
  /**
   * The Author Voice slice for one operation — the Context Compiler's source.
   * Only the writer's rules and confirmed tendencies; a proposed reading has
   * never been agreed to (docs/AUTHOR_VOICE.md).
   */
  authorVoice(options: {
    operation?: string;
    characterId?: string;
    povCharacterId?: string;
  }): Promise<{ rules: readonly VoiceRule[]; tendencies: readonly VoiceTendency[] }> {
    return this.voice.forOperation(options);
  }

  /**
   * A character's voice as it stands at a scene — the Context Compiler's
   * source when drafting their dialogue.
   */
  async characterVoice(options: {
    characterId: string;
    sceneId?: string;
    limit?: number;
  }): Promise<{
    attributes: VoiceAttributes;
    appliedShifts: readonly string[];
    examples: readonly string[];
  } | null> {
    const order = (await this.listScenes()).map((scene) => scene.id as string);
    const { profile, attributes, applied } = await this.characterVoices.voiceAtScene(
      options.characterId,
      order,
      options.sceneId,
    );
    if (profile === null) return null;
    const examples = await this.characterVoices.listExamples(options.characterId);
    return {
      attributes,
      appliedShifts: applied.map((shift) => shift.description),
      examples: representativeLines(examples, options.limit),
    };
  }

  listStoryTests(): Promise<StoryTest[]> {
    return this.tests.list();
  }

  getStoryTest(id: string): Promise<StoryTest | null> {
    return this.tests.get(id);
  }

  /**
   * Record a story test.
   *
   * Every entity the assertion names must exist: a test about a character the
   * project does not have asserts nothing, and would fail forever for the wrong
   * reason (docs/STORY_TESTS.md).
   */
  async addStoryTest(input: {
    name: string;
    assertion: Assertion;
    description?: string;
    scope?: TestScope;
    severity?: TestSeverity;
    enabled?: boolean;
  }): Promise<StoryTest> {
    const type = isDeterministicAssertion(input.assertion) ? "deterministic" : "semantic";
    for (const id of assertionEntities(input.assertion)) {
      if ((await this.getEntity(id)) === null) {
        throw new RepositoryError(
          "entity_not_found",
          `This test references "${id}", which does not exist in this project.`,
          { details: { id } },
        );
      }
    }

    const scope = input.scope ?? { kind: "always" };
    for (const anchor of scopeAnchors(scope)) {
      if ((await this.getEntity(anchor)) === null) {
        throw new RepositoryError(
          "entity_not_found",
          `This test's scope references "${anchor}", which does not exist in this project.`,
          { details: { id: anchor } },
        );
      }
    }

    let stored: StoryTest[] = [];
    await this.recordChange(
      { actor: "human", operation: "add_story_test", summary: `Add story test "${input.name}"` },
      async () => {
        stored = await this.tests.append([
          {
            name: input.name,
            description: input.description ?? "",
            type,
            scope,
            enabled: input.enabled ?? true,
            severity: input.severity ?? DEFAULT_TEST_SEVERITY,
            assertion: input.assertion,
            createdAt: this.clock(),
          },
        ]);
        await this.touch();
      },
    );
    return stored[0] as StoryTest;
  }

  /** Enable or disable a test. A disabled test is kept and reported as skipped. */
  async setStoryTestEnabled(id: string, enabled: boolean): Promise<StoryTest> {
    let updated: StoryTest | null = null;
    await this.recordChange(
      {
        actor: "human",
        operation: enabled ? "enable_story_test" : "disable_story_test",
        summary: `${enabled ? "Enable" : "Disable"} story test ${id}`,
      },
      async () => {
        updated = await this.tests.update(id, { enabled });
        await this.touch();
      },
    );
    if (updated === null) {
      throw new RepositoryError("entity_not_found", `No story test with id ${id}.`);
    }
    return updated;
  }

  async deleteStoryTest(id: string): Promise<void> {
    await this.recordChange(
      { actor: "human", operation: "delete_story_test", summary: `Delete story test ${id}` },
      async () => {
        if (!(await this.tests.remove(id))) {
          throw new RepositoryError("entity_not_found", `No story test with id ${id}.`);
        }
        await this.touch();
      },
    );
  }

  /**
   * Run the story tests without running a whole build.
   *
   * The build runs them too; this is for the test builder, where a writer wants
   * to see whether the assertion they just wrote holds before committing to it.
   */
  async runStoryTests(): Promise<TestRunSummary> {
    const [tests, timeline, scenes, chapters, relationships] = await Promise.all([
      this.tests.list(),
      this.getStoryTimeline(),
      this.listScenes(),
      this.listChapters(),
      this.listRelationships(),
    ]);
    return runStoryTests({ tests, timeline, scenes, chapters, relationships });
  }

  // ── The Story Build ─────────────────────────────────────────────────────────

  /**
   * Everything the compiler's rules read, gathered once.
   *
   * The repository assembles this because it is the only thing that owns all of
   * it; the compiler stays below it in the layering and depends on nothing here
   * (docs/STORY_COMPILER.md).
   */
  async getBuildContext(): Promise<Omit<BuildContext, "config">> {
    const [
      scenes,
      chapters,
      characters,
      locations,
      objects,
      threads,
      facts,
      worldRules,
      events,
      setups,
      relationships,
      storyTests,
      dependencies,
      decisions,
      transitions,
      temporalLinks,
      travelRules,
      integrity,
      metrics,
    ] = await Promise.all([
      this.listScenes(),
      this.listChapters(),
      this.listCharacters(),
      this.listLocations(),
      this.listObjects(),
      this.listPlotThreads(),
      this.listFacts(),
      this.listWorldRules(),
      this.listEvents(),
      this.listSetups(),
      this.listRelationships(),
      this.tests.list(),
      this.dependencies.list(),
      this.listDecisions(),
      this.transitions.list(),
      this.timeline.listLinks(),
      this.timeline.listTravelRules(),
      this.checkIntegrity(),
      this.getManuscriptMetrics(),
    ]);

    const enabled = await this.modules.enabled();
    const extensions = await this.extensions.listAll(enabled);
    const moduleData =
      this.moduleRuntime === null ? {} : await this.moduleRuntime.collect(enabled, this);

    return {
      modules: { enabled, extensions, data: moduleData },
      scenes,
      chapters,
      characters,
      locations,
      objects,
      threads,
      facts,
      worldRules,
      events,
      setups,
      relationships,
      storyTests,
      dependencies,
      decisions,
      transitions,
      temporalLinks,
      travelRules,
      timeline: new StoryTimeline(
        orderScenes(scenes, chapters).map((s) => s.id as string),
        transitions,
      ),
      chronology: new StoryChronology(timelineNodes({ scenes, chapters, events }), temporalLinks),
      metrics,
      danglingReferences: integrity.dangling.map((edge) => ({
        fromId: edge.fromId,
        fromKind: edge.fromKind,
        field: edge.field,
        toId: edge.toId,
      })),
    };
  }

  /**
   * Attach the genre framework, or take it away.
   *
   * Optional by design: with nothing attached the repository behaves exactly as
   * it did before modules existed. It is the app that decides to wire the two
   * together, which keeps the dependency running upward
   * (docs/GENRE_MODULES.md).
   */
  useModules(runtime: ModuleRuntime | null): void {
    this.moduleRuntime = runtime;
  }

  /**
   * Build the story: run every enabled rule over the project's structured state
   * and record the result.
   *
   * The build is deterministic and involves no model. Its findings come from the
   * subsystems that already own them — the entity graph, the timeline, the
   * chronology, the narrative checks — so there is one implementation of
   * continuity in this codebase, not two.
   */
  async buildStory(
    options: { config?: BuildConfig; only?: readonly BuildInputKind[]; persist?: boolean } = {},
  ): Promise<StoryBuild> {
    const [context, number] = await Promise.all([this.getBuildContext(), this.builds.nextNumber()]);

    // Core rules, plus whatever the enabled modules contribute. With no runtime
    // attached this is exactly CORE_RULES, which is what a project with no
    // modules on should get.
    const rules = [...CORE_RULES, ...(this.moduleRuntime?.rulesFor(context.modules.enabled) ?? [])];

    const build = await buildStory(rules, context, {
      number,
      now: this.clock,
      ...(options.config !== undefined ? { config: options.config } : {}),
      ...(options.only !== undefined ? { only: options.only } : {}),
    });

    return options.persist === false ? build : this.builds.append(build);
  }

  /** Build summaries, newest first. */
  listBuilds(limit?: number): Promise<BuildSummary[]> {
    return this.builds.list(limit);
  }

  getBuild(id: string): Promise<StoryBuild | null> {
    return this.builds.get(id);
  }

  getLatestBuild(): Promise<StoryBuild | null> {
    return this.builds.latest();
  }

  /**
   * What changed between a build and the one before it — new, resolved and
   * persistent diagnostics.
   */
  async compareToPreviousBuild(buildId: string): Promise<BuildComparison> {
    const build = await this.builds.get(buildId);
    if (build === null) {
      throw new RepositoryError("entity_not_found", `No build with id ${buildId}.`);
    }
    const history = await this.builds.list();
    const at = history.findIndex((b) => b.id === buildId);
    const previousSummary = at === -1 ? undefined : history[at + 1];
    const previous =
      previousSummary === undefined ? undefined : await this.builds.get(previousSummary.id);
    return compareBuilds(previous ?? undefined, build);
  }

  // ── Story Refactor ──────────────────────────────────────────────────────────

  /** The ID the next refactor run will carry. */
  nextRefactorId(): Promise<string> {
    return this.refactors.nextId();
  }

  /** Save or update a refactor's audit record. Idempotent by ID. */
  saveRefactorRun(run: {
    id: string;
    kind: string;
    status: string;
    instruction: string;
    createdAt: string;
    introduced: ReadonlyArray<{ severity: string }>;
  }): Promise<void> {
    return this.refactors.save(run);
  }

  listRefactorRuns(limit?: number): Promise<
    Array<{
      id: string;
      kind: string;
      status: string;
      instruction: string;
      createdAt: string;
      introducedErrors: number;
    }>
  > {
    return this.refactors.list(limit);
  }

  getRefactorRun<T>(id: string): Promise<T | null> {
    return this.refactors.get<T>(id);
  }

  // ── Causality and dependencies ──────────────────────────────────────────────

  listDependencies(): Promise<Dependency[]> {
    return this.dependencies.list();
  }

  getDependency(id: string): Promise<Dependency | null> {
    return this.dependencies.get(id);
  }

  /**
   * Register a cause-and-effect link.
   *
   * Both endpoints must exist and must be kinds that can participate — a
   * dependency naming a location or a deleted scene is a claim about nothing,
   * and one recorded now would silently poison every blast radius later.
   *
   * A human's link is `confirmed`; a model's arrives `proposed` and stays out
   * of the graph until someone accepts it (AGENTS.md — "Canon vs Inference").
   */
  async addDependencies(
    drafts: ReadonlyArray<{
      kind: DependencyKind;
      fromId: string;
      toId: string;
      description?: string;
      evidence?: string;
    }>,
    options: {
      source?: DependencySource;
      status?: DependencyStatus;
      modelId?: string;
      summary?: string;
    } = {},
  ): Promise<Dependency[]> {
    const source = options.source ?? "human";
    const status = options.status ?? (source === "human" ? "confirmed" : "proposed");
    const existing = await this.graph.existingIds();

    for (const draft of drafts) {
      for (const endpoint of [draft.fromId, draft.toId]) {
        if (!isDependencyNode(endpoint)) {
          throw new RepositoryError(
            "invalid_reference",
            `${endpoint} cannot take part in a dependency. Dependencies link ${DEPENDENCY_NODE_KINDS.join(", ")}.`,
            { details: { endpoint } },
          );
        }
        if (!existing.has(endpoint)) {
          throw new RepositoryError(
            "invalid_reference",
            `${endpoint} does not exist in this project.`,
            { details: { endpoint } },
          );
        }
      }
      if (draft.fromId === draft.toId) {
        throw new RepositoryError(
          "invalid_reference",
          `A dependency cannot link ${draft.fromId} to itself.`,
          { details: { endpoint: draft.fromId } },
        );
      }
    }

    const now = this.clock();
    const prepared = drafts.map((draft) => ({
      kind: draft.kind,
      fromId: draft.fromId,
      toId: draft.toId,
      ...(draft.description !== undefined ? { description: draft.description } : {}),
      ...(draft.evidence !== undefined ? { evidence: draft.evidence } : {}),
      status,
      source,
      ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
      createdAt: now,
    }));

    let stored: Dependency[] = [];
    await this.recordChange(
      {
        actor: source === "agent" ? "agent" : "human",
        operation: "add_dependencies",
        summary:
          options.summary ??
          `${status === "proposed" ? "Propose" : "Register"} ${String(drafts.length)} dependency(ies)`,
        ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
      },
      async () => {
        stored = await this.dependencies.append(prepared);
        await this.touch();
      },
    );
    return stored;
  }

  /** Accept or reject a proposal, or correct a link the writer already made. */
  async updateDependency(
    id: string,
    patch: {
      kind?: DependencyKind;
      description?: string;
      status?: DependencyStatus;
    },
  ): Promise<Dependency> {
    const current = await this.dependencies.get(id);
    if (current === null) {
      throw new RepositoryError("entity_not_found", `No dependency with id ${id}.`);
    }
    let next: Dependency = current;
    await this.recordChange(
      {
        actor: "human",
        operation: "update_dependency",
        summary: `Update dependency ${id}`,
      },
      async () => {
        next = (await this.dependencies.update(id, patch)) as Dependency;
        await this.touch();
      },
    );
    return next;
  }

  async deleteDependency(id: string): Promise<void> {
    if ((await this.dependencies.get(id)) === null) {
      throw new RepositoryError("entity_not_found", `No dependency with id ${id}.`);
    }
    await this.recordChange(
      { actor: "human", operation: "delete_dependency", summary: `Delete dependency ${id}` },
      async () => {
        await this.dependencies.remove([id]);
        await this.touch();
      },
    );
  }

  /**
   * The causality graph.
   *
   * Confirmed edges only, unless the caller is reviewing proposals — planning a
   * refactor against a model's guess would be worse than planning against
   * nothing (docs/STORY_REFACTOR.md).
   */
  async getCausalityGraph(options: { includeProposed?: boolean } = {}): Promise<CausalityGraph> {
    return new CausalityGraph(await this.dependencies.list(), options);
  }

  /** What this entity rests on — one step upstream. */
  async getDependenciesOf(entityId: string, options: TraversalOptions = {}) {
    return (await this.getCausalityGraph()).getDependencies(entityId, options);
  }

  /** What rests on this entity — one step downstream. */
  async getDependentsOf(entityId: string, options: TraversalOptions = {}) {
    return (await this.getCausalityGraph()).getDependents(entityId, options);
  }

  async getTransitiveDependents(
    entityId: string,
    options: TraversalOptions = {},
  ): Promise<string[]> {
    return (await this.getCausalityGraph()).getTransitiveDependents(entityId, options);
  }

  async getDependencyPath(
    fromId: string,
    toId: string,
    options: TraversalOptions = {},
  ): Promise<DependencyPath | null> {
    return (await this.getCausalityGraph()).getDependencyPath(fromId, toId, options);
  }

  /**
   * What a change to this entity may reach.
   *
   * The acceptance question of the whole subsystem: *if I remove this scene,
   * what later story elements depend on it?* — answered from persistent story
   * architecture rather than by asking a model to guess.
   */
  async calculateBlastRadius(
    entityId: string,
    options: TraversalOptions = {},
  ): Promise<BlastRadius> {
    return (await this.getCausalityGraph()).calculateBlastRadius(entityId, options);
  }

  /** Deterministic checks over the registered graph. */
  async checkDependencyGraph(): Promise<DependencyFinding[]> {
    const [dependencies, existingIds, scenes, chapters, events, decisions] = await Promise.all([
      this.dependencies.list(),
      this.graph.existingIds(),
      this.listScenes(),
      this.listChapters(),
      this.listEvents(),
      this.listDecisions(),
    ]);

    // Non-scene nodes are placed by the scene they happen in, so an ordering
    // check can compare a fact or a decision against a scene at all.
    const sceneOf = new Map<string, string>();
    for (const event of events) {
      if (event.sceneId !== undefined) sceneOf.set(event.id as string, event.sceneId as string);
    }
    for (const decision of decisions) {
      if (decision.sceneId !== undefined) {
        sceneOf.set(decision.id as string, decision.sceneId as string);
      }
    }

    return checkDependencies({
      dependencies,
      existingIds,
      sceneOrder: orderScenes(scenes, chapters).map((s) => s.id as string),
      sceneOf,
    });
  }

  // ── Story Debugger ──────────────────────────────────────────────────────────

  /**
   * Investigate a narrative problem: scope, evidence, and traces through the
   * systems that own the data.
   *
   * Deterministic and model-free. The interpretation of what comes back is a
   * separate, clearly-labelled step (`DiagnosisAnalyst` in `@jellytind/editing`),
   * which is why a project with no model configured can still debug
   * (docs/STORY_DEBUGGER.md).
   */
  traceStoryProblem(request: DebugRequestInput | DebugRequest): Promise<DebugTrace> {
    return traceProblem(request, this);
  }

  /** Parse a `/debug …` line against this project's entities. */
  async parseDebugCommand(line: string): Promise<ParsedCommand> {
    return parseDebugCommand(line, await this.listEntitySummaries());
  }

  /**
   * Turn a trace into a stored report.
   *
   * The diagnosis and interventions are passed in rather than produced here:
   * this layer knows nothing about models, and a report without them is a
   * complete report.
   */
  async saveDebugReport(
    trace: DebugTrace,
    extras: {
      durationMs: number;
      diagnosis?: Diagnosis;
      interventions?: readonly Intervention[];
      modelId?: string;
    },
  ): Promise<DebugReport> {
    const report: DebugReport = {
      ...trace,
      id: await this.debugReports.nextId(),
      createdAt: this.clock(),
      durationMs: extras.durationMs,
      interventions: extras.interventions ?? [],
      entities: tracedEntities(trace.evidence, trace.scope),
      ...(extras.diagnosis !== undefined ? { diagnosis: extras.diagnosis } : {}),
      ...(extras.modelId !== undefined ? { modelId: extras.modelId } : {}),
    };
    await this.debugReports.save(report);
    return report;
  }

  /** Debug report summaries, newest first. */
  listDebugReports(limit?: number): Promise<DebugReportSummary[]> {
    return this.debugReports.list(limit);
  }

  getDebugReport(id: string): Promise<DebugReport | null> {
    return this.debugReports.get(id);
  }

  // ── Plot threads, setups and payoffs ────────────────────────────────────────

  /**
   * Manuscript shape for dormancy measurement.
   *
   * Words live in chapter files, not scene files, so a chapter's count is
   * attributed to its **first** scene and the rest of its scenes get zero. Every
   * total across a span is therefore exact, while no per-scene number is
   * invented — a distinction that matters, because a fabricated word count would
   * look exactly like a real one (docs/NARRATIVE_THREADS.md).
   */
  async getManuscriptMetrics(): Promise<ManuscriptMetrics> {
    const [scenes, chapters] = await Promise.all([this.listScenes(), this.listChapters()]);
    const ordered = orderScenes(scenes, chapters);

    const chapterBySceneId = new Map<string, string>();
    for (const scene of ordered) {
      if (scene.chapterId !== undefined) {
        chapterBySceneId.set(scene.id as string, scene.chapterId as string);
      }
    }

    const wordsBySceneId = new Map<string, number>(ordered.map((s) => [s.id as string, 0]));
    for (const chapter of chapters) {
      const first = ordered.find((s) => s.chapterId === chapter.id);
      if (first === undefined) continue;
      const raw = await this.readProjectFile(chapter.filePath);
      wordsBySceneId.set(first.id as string, countWords(raw ?? ""));
    }

    return { chapterBySceneId, wordsBySceneId };
  }

  /** A thread's state at a boundary, reconstructed from its lifecycle. */
  async getThreadState(
    threadId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): Promise<ThreadState> {
    const [timeline, threads] = await Promise.all([
      this.getStoryTimeline(),
      this.listPlotThreads(),
    ]);
    const thread = threads.find((t) => t.id === threadId);
    if (thread === undefined) {
      throw new RepositoryError("entity_not_found", `No plot thread with id ${threadId}.`);
    }
    return timeline.threadStateAt(
      { id: threadId, name: thread.name, status: thread.status },
      asOf,
      view,
    );
  }

  /** Every recorded step in a thread's life, in story order. */
  async getThreadHistory(threadId: string, view: TimelineView = {}): Promise<ThreadStep[]> {
    const [timeline, threads] = await Promise.all([
      this.getStoryTimeline(),
      this.listPlotThreads(),
    ]);
    const thread = threads.find((t) => t.id === threadId);
    return timeline.threadHistory(threadId, thread?.status ?? "planned", view);
  }

  /** How long a thread has been off the page. Measurements, never a verdict. */
  async getThreadDormancy(
    threadId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): Promise<ThreadDormancy> {
    const [timeline, metrics] = await Promise.all([
      this.getStoryTimeline(),
      this.getManuscriptMetrics(),
    ]);
    return timeline.threadDormancy(threadId, asOf, metrics, view);
  }

  /** Threads carrying the story forward at a scene — introduced, active or escalating. */
  async getActiveThreadsAtScene(sceneId: string, view: TimelineView = {}): Promise<ThreadState[]> {
    return (await this.threadStatesAt(sceneId, view)).filter((s) => isRunning(s.status));
  }

  /** Threads the story still owes but is not currently working on. */
  async getDormantThreadsAtScene(sceneId: string, view: TimelineView = {}): Promise<ThreadState[]> {
    return (await this.threadStatesAt(sceneId, view)).filter((s) => s.status === "dormant");
  }

  /**
   * Threads first introduced within a set of chapters.
   *
   * Acts are not entities yet, so an act is named by the chapters that make it
   * up. When acts become first-class this keeps the same shape.
   */
  async getThreadsIntroducedInAct(
    chapterIds: readonly string[],
    view: TimelineView = {},
  ): Promise<ThreadState[]> {
    const [scenes, states] = await Promise.all([
      this.listScenes(),
      this.threadStatesAt(undefined, view),
    ]);
    const inAct = new Set(
      scenes
        .filter((s) => s.chapterId !== undefined && chapterIds.includes(s.chapterId as string))
        .map((s) => s.id as string),
    );
    return states.filter(
      (state) => state.introducedSceneId !== undefined && inAct.has(state.introducedSceneId),
    );
  }

  /** Threads the story has not finished with — including ones never introduced. */
  async getUnresolvedThreads(view: TimelineView = {}): Promise<ThreadState[]> {
    return (await this.threadStatesAt(undefined, view)).filter((s) => isOpen(s.status));
  }

  /** Every thread's state at a scene, or at the end of the book when unspecified. */
  private async threadStatesAt(
    sceneId: string | undefined,
    view: TimelineView,
  ): Promise<ThreadState[]> {
    const [timeline, threads] = await Promise.all([
      this.getStoryTimeline(),
      this.listPlotThreads(),
    ]);
    const boundary = sceneId ?? timeline.sceneOrder.at(-1);
    if (boundary === undefined) return [];
    const asOf = { sceneId: boundary, position: "after" } as const;
    return threads.map((thread) =>
      timeline.threadStateAt(
        { id: thread.id as string, name: thread.name, status: thread.status },
        asOf,
        view,
      ),
    );
  }

  /** Setups a scene plants, and setups it keeps. */
  async getSetupsForScene(sceneId: string): Promise<{ planted: Setup[]; paidOff: Setup[] }> {
    return setupsForScene(await this.listSetups(), sceneId);
  }

  /** Promises made before a scene and not yet kept — what the reader is holding. */
  async getOpenSetupsBeforeScene(sceneId: string): Promise<Setup[]> {
    const [setups, timeline] = await Promise.all([this.listSetups(), this.getStoryTimeline()]);
    return openSetupsBefore(setups, timeline, sceneId);
  }

  /**
   * Deterministic checks on the project's narrative promises.
   *
   * `dormantAfterScenes` is deliberately not defaulted: the right number for a
   * thriller is wrong for a family saga, so dormancy is reported only when a
   * caller names a threshold.
   */
  async checkNarrative(
    options: { dormantAfterScenes?: number; view?: TimelineView } = {},
  ): Promise<NarrativeFinding[]> {
    const [timeline, scenes, threads, setups, metrics] = await Promise.all([
      this.getStoryTimeline(),
      this.listScenes(),
      this.listPlotThreads(),
      this.listSetups(),
      this.getManuscriptMetrics(),
    ]);
    return checkNarrative({
      timeline,
      scenes,
      threads,
      setups,
      metrics,
      ...(options.dormantAfterScenes !== undefined
        ? { dormantAfterScenes: options.dormantAfterScenes }
        : {}),
      ...(options.view !== undefined ? { view: options.view } : {}),
    });
  }

  // ── Object continuity ───────────────────────────────────────────────────────

  /** A character's state at a boundary: where they are, and whether they are there. */
  async getCharacterState(
    characterId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): Promise<CharacterState> {
    return (await this.getStoryTimeline()).characterStateAt(characterId, asOf, view);
  }

  /** An object's full state at a boundary: owner, holder, place, condition. */
  async getObjectState(
    objectId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): Promise<ObjectState> {
    return (await this.getStoryTimeline()).objectStateAt(objectId, asOf, view);
  }

  /** Every recorded step in an object's life, in story order. */
  async getObjectHistory(objectId: string, view: TimelineView = {}): Promise<ObjectChange[]> {
    return (await this.getStoryTimeline()).objectHistory(objectId, view);
  }

  /** An object's changes of hands and of place, as transfers. */
  async getObjectTransfers(objectId: string, view: TimelineView = {}): Promise<ObjectTransfer[]> {
    return (await this.getStoryTimeline()).objectTransfers(objectId, view);
  }

  /**
   * Where an object effectively is, following whoever is carrying it.
   *
   * A held object is wherever its holder is; only a put-down object stays where
   * it was left (docs/OBJECTS_LOCATIONS.md).
   */
  async getObjectLocation(
    objectId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): Promise<string | undefined> {
    return (await this.getStoryTimeline()).objectLocationAt(objectId, asOf, view);
  }

  /**
   * Record an object changing hands or place.
   *
   * A convenience over the transitions it writes, not a second store: transfers
   * are *derived* from state, so there is only ever one version of where a thing
   * is. Supplying `from` fields is optional and, when given, is checked against
   * the state entering the scene — a caller asserting the key came from Mara
   * when the timeline says it was in a drawer is stating something the project
   * contradicts, and is told so rather than having it silently recorded.
   */
  async recordObjectTransfer(input: {
    objectId: string;
    sceneId: string;
    fromCharacterId?: string;
    toCharacterId?: string;
    fromLocationId?: string;
    toLocationId?: string;
    reason?: string;
    source?: StateTransition["source"];
    confirmationStatus?: StateTransition["confirmationStatus"];
    modelId?: string;
  }): Promise<StateTransition[]> {
    if (input.toCharacterId === undefined && input.toLocationId === undefined) {
      throw new RepositoryError(
        "invalid_reference",
        "A transfer needs somewhere or someone to go to.",
        { details: { objectId: input.objectId } },
      );
    }

    const timeline = await this.getStoryTimeline();
    const before = timeline.objectStateAt(input.objectId, {
      sceneId: input.sceneId,
      position: "before",
    });

    const disagreement =
      input.fromCharacterId !== undefined && input.fromCharacterId !== before.holderId
        ? `holder entering ${input.sceneId} is ${before.holderId ?? "nobody"}, not ${input.fromCharacterId}`
        : input.fromLocationId !== undefined && input.fromLocationId !== before.locationId
          ? `location entering ${input.sceneId} is ${before.locationId ?? "unrecorded"}, not ${input.fromLocationId}`
          : undefined;
    if (disagreement !== undefined) {
      throw new RepositoryError(
        "invalid_reference",
        `This transfer disagrees with the recorded state of ${input.objectId}: ${disagreement}. Omit the "from" to record it against the state as it stands.`,
        { details: { objectId: input.objectId, sceneId: input.sceneId } },
      );
    }

    const drafts: TransitionDraft[] = [];
    if (input.toCharacterId !== undefined) {
      drafts.push({
        sceneId: input.sceneId,
        kind: "object_holder",
        subjectId: input.objectId,
        value: input.toCharacterId,
        ...(input.reason !== undefined ? { note: input.reason } : {}),
      });
    }
    if (input.toLocationId !== undefined) {
      drafts.push({
        sceneId: input.sceneId,
        kind: "object_location",
        subjectId: input.objectId,
        value: input.toLocationId,
        ...(input.reason !== undefined ? { note: input.reason } : {}),
      });
    }

    return this.addStateTransitions(drafts, {
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.confirmationStatus !== undefined
        ? { confirmationStatus: input.confirmationStatus }
        : {}),
      ...(input.modelId !== undefined ? { modelId: input.modelId } : {}),
      summary: `Transfer ${input.objectId} at ${input.sceneId}`,
    });
  }

  /**
   * Deterministic physical-continuity checks across the project — objects that
   * cannot be where they are, and characters who cannot be either.
   */
  async checkContinuity(view: TimelineView = {}): Promise<ContinuityViolation[]> {
    const [timeline, scenes, locations] = await Promise.all([
      this.getStoryTimeline(),
      this.listScenes(),
      this.listLocations(),
    ]);
    return checkContinuity({ timeline, scenes, locations, view });
  }

  /** A location and everything containing it, outermost first. */
  async getLocationPath(locationId: string): Promise<string[]> {
    return locationPath(indexLocations(await this.listLocations()), locationId).reverse();
  }

  /** Every location inside this one, at any depth. */
  async getContainedLocations(locationId: string): Promise<string[]> {
    return locationDescendants(indexLocations(await this.listLocations()), locationId);
  }

  /**
   * Scenes set at a location **or anywhere inside it**.
   *
   * The containment-aware sibling of `getScenesByLocation`: asking for scenes at
   * Blackthorn Manor should find the one set in the Hidden Vault.
   */
  async getScenesWithinLocation(locationId: string): Promise<Scene[]> {
    const [scenes, locations] = await Promise.all([this.listScenes(), this.listLocations()]);
    const index = indexLocations(locations);
    return scenes.filter(
      (scene) =>
        scene.locationId !== undefined && isWithin(index, scene.locationId as string, locationId),
    );
  }

  /** Positions the story world contradicts, at a boundary. */
  async getFalseBeliefs(asOf: StateBoundary, view: TimelineView = {}) {
    const [timeline, facts] = await Promise.all([this.getStoryTimeline(), this.listFacts()]);
    return falseBeliefsAt(timeline, new Map(facts.map((f) => [f.id as string, f])), asOf, { view });
  }

  /**
   * Deterministic information-state checks across the project — the reusable
   * foundation the Story Compiler builds on.
   */
  async checkKnowledge(view: TimelineView = {}): Promise<KnowledgeViolation[]> {
    const [timeline, scenes, facts] = await Promise.all([
      this.getStoryTimeline(),
      this.listScenes(),
      this.listFacts(),
    ]);
    return checkKnowledgeViolations({
      timeline,
      scenes,
      facts: new Map(facts.map((f) => [f.id as string, f])),
      view,
    });
  }

  // ── Story chronology ────────────────────────────────────────────────────────

  /** Every authored temporal relation, confirmed or otherwise. */
  listTemporalLinks(): Promise<TemporalLink[]> {
    return this.timeline.listLinks();
  }

  /** Every declared travel time. Empty by default, and that is the safe default. */
  listTravelRules(): Promise<TravelRule[]> {
    return this.timeline.listTravelRules();
  }

  /**
   * The story-world chronology: scenes and events ordered as they happen rather
   * than as they are presented (docs/TIMELINE.md).
   */
  async getStoryChronology(view: TimelineView = {}): Promise<StoryChronology> {
    const [scenes, chapters, events, links] = await Promise.all([
      this.listScenes(),
      this.listChapters(),
      this.listEvents(),
      this.timeline.listLinks(),
    ]);
    return new StoryChronology(timelineNodes({ scenes, chapters, events }), links, { view });
  }

  /**
   * Record temporal relations.
   *
   * Both ends must exist as a scene or event: a chronology that references
   * entities the project does not have is not a chronology, it is a guess.
   */
  async addTemporalLinks(
    drafts: ReadonlyArray<{
      fromId: string;
      toId: string;
      relation: TemporalRelation;
      gap?: StoryDuration;
      note?: string;
    }>,
    options: {
      source?: TemporalLink["source"];
      confirmationStatus?: TemporalLink["confirmationStatus"];
      modelId?: string;
      summary?: string;
    } = {},
  ): Promise<TemporalLink[]> {
    const now = this.clock();
    const prepared: Array<Omit<TemporalLink, "id">> = [];

    for (const draft of drafts) {
      if (draft.fromId === draft.toId) {
        throw new RepositoryError(
          "invalid_reference",
          "A temporal relation must connect two different moments.",
          { details: { fromId: draft.fromId } },
        );
      }
      await this.requireTimelineNode(draft.fromId);
      await this.requireTimelineNode(draft.toId);
      prepared.push({
        fromId: draft.fromId,
        toId: draft.toId,
        relation: draft.relation,
        ...(draft.gap !== undefined ? { gap: draft.gap } : {}),
        ...(draft.note !== undefined ? { note: draft.note } : {}),
        source: options.source ?? "author",
        confirmationStatus: options.confirmationStatus ?? "confirmed",
        ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
        createdAt: now,
      });
    }

    let stored: TemporalLink[] = [];
    await this.recordChange(
      {
        actor: options.source === "agent" ? "agent" : "human",
        operation: "add_temporal_links",
        summary: options.summary ?? `Record ${String(prepared.length)} temporal relation(s)`,
        ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
      },
      async () => {
        stored = await this.timeline.appendLinks(prepared);
        await this.touch();
      },
    );
    return stored;
  }

  /** Confirm or reject a proposed relation. Only confirmation makes it canon. */
  async setTemporalLinkStatus(
    id: string,
    status: TemporalLink["confirmationStatus"],
  ): Promise<TemporalLink> {
    let updated: TemporalLink | null = null;
    await this.recordChange(
      {
        actor: "human",
        operation: `${status}_temporal_link`,
        summary: `Mark temporal relation ${id} ${status}`,
      },
      async () => {
        updated = await this.timeline.updateLink(id, { confirmationStatus: status });
        await this.touch();
      },
    );
    if (updated === null) {
      throw new RepositoryError("entity_not_found", `No temporal relation with id ${id}.`);
    }
    return updated;
  }

  async deleteTemporalLink(id: string): Promise<void> {
    await this.recordChange(
      {
        actor: "human",
        operation: "delete_temporal_link",
        summary: `Delete temporal relation ${id}`,
      },
      async () => {
        if (!(await this.timeline.removeLink(id))) {
          throw new RepositoryError("entity_not_found", `No temporal relation with id ${id}.`);
        }
        await this.touch();
      },
    );
  }

  /**
   * Declare how long a journey takes.
   *
   * Nothing infers these. Until a writer states that Blackthorn to the city is
   * four hours, no travel contradiction is reportable between them — the story
   * may be set in any century, on any world.
   */
  async addTravelRules(
    drafts: ReadonlyArray<{
      fromLocationId: string;
      toLocationId: string;
      minimum: StoryDuration;
      bidirectional?: boolean;
      note?: string;
    }>,
  ): Promise<TravelRule[]> {
    for (const draft of drafts) {
      await this.requireEntityExists("location", draft.fromLocationId);
      await this.requireEntityExists("location", draft.toLocationId);
    }
    let stored: TravelRule[] = [];
    await this.recordChange(
      {
        actor: "human",
        operation: "add_travel_rules",
        summary: `Declare ${String(drafts.length)} travel time(s)`,
      },
      async () => {
        stored = await this.timeline.appendTravelRules(drafts);
        await this.touch();
      },
    );
    return stored;
  }

  async deleteTravelRule(id: string): Promise<void> {
    await this.recordChange(
      { actor: "human", operation: "delete_travel_rule", summary: `Delete travel rule ${id}` },
      async () => {
        if (!(await this.timeline.removeTravelRule(id))) {
          throw new RepositoryError("entity_not_found", `No travel rule with id ${id}.`);
        }
        await this.touch();
      },
    );
  }

  /** One character's story, in the order they lived it rather than read it. */
  async getCharacterTimeline(
    characterId: string,
    view: TimelineView = {},
  ): Promise<CharacterTimelineEntry[]> {
    return (await this.getStoryChronology(view)).getCharacterTimeline(characterId);
  }

  /** Every event a character takes part in, in chronological order. */
  async getEventsForCharacter(
    characterId: string,
    view: TimelineView = {},
  ): Promise<TimelineNode[]> {
    return (await this.getStoryChronology(view)).getEventsForCharacter(characterId);
  }

  /**
   * Where a character was at a story moment.
   *
   * State is replayed in **chronological** order here, not manuscript order —
   * which is the only way the answer is right in a story with flashbacks.
   */
  async getCharacterLocationAtTime(
    characterId: string,
    at: TimelinePoint,
    view: TimelineView = {},
  ): Promise<string | undefined> {
    const [chronology, transitions] = await Promise.all([
      this.getStoryChronology(view),
      this.transitions.list(),
    ]);
    return chronology.getCharacterLocationAtTime(characterId, at, transitions, view);
  }

  /** Deterministic chronology checks across the project. */
  async checkTimeline(view: TimelineView = {}): Promise<TimelineViolation[]> {
    const [chronology, links, travel] = await Promise.all([
      this.getStoryChronology(view),
      this.timeline.listLinks(),
      this.timeline.listTravelRules(),
    ]);
    return checkTimeline({ chronology, links, travel });
  }

  /** Reject anything that is not a scene or an event. */
  private async requireTimelineNode(id: string): Promise<void> {
    const kind = entityKindOf(id);
    if (kind !== "scene" && kind !== "event") {
      throw new RepositoryError(
        "invalid_reference",
        `"${id}" cannot take part in a temporal relation: only scenes and events sit on the timeline.`,
        { details: { id } },
      );
    }
    await this.requireEntityExists(kind, id);
  }

  /** The entity must exist, and be of the kind its ID claims. */
  private async requireEntityExists(kind: string, id: string): Promise<void> {
    if (entityKindOf(id) !== kind || (await this.getEntity(id)) === null) {
      throw new RepositoryError("entity_not_found", `"${id}" is not a ${kind} in this project.`, {
        details: { id, kind },
      });
    }
  }

  // ── Search & retrieval ──────────────────────────────────────────────────────

  /** Project-wide lexical full-text search. Deterministic; no LLM. */
  searchText(query: SearchQuery): Promise<SearchHit[]> {
    return this.search.search(query);
  }

  /** Force a full rebuild of the search index (e.g. after bulk external edits). */
  rebuildSearchIndex(): Promise<void> {
    return this.search.rebuild();
  }

  // Structured graph queries — exact, deterministic answers with no LLM.

  async getScenesByCharacter(id: CharacterId): Promise<Scene[]> {
    return scenesByCharacter(await this.listScenes(), id);
  }
  async getScenesByPOV(id: CharacterId): Promise<Scene[]> {
    return scenesByPov(await this.listScenes(), id);
  }
  async getScenesByLocation(id: LocationId): Promise<Scene[]> {
    return scenesByLocation(await this.listScenes(), id);
  }
  async getScenesByPlotThread(id: PlotThreadId): Promise<Scene[]> {
    const [scenes, threads] = await Promise.all([this.listScenes(), this.listPlotThreads()]);
    const thread = threads.find((t) => t.id === id);
    const linked = thread
      ? [
          ...(thread.introducedSceneId ? [thread.introducedSceneId] : []),
          ...(thread.resolvedSceneId ? [thread.resolvedSceneId] : []),
          ...thread.relatedSceneIds,
        ]
      : [];
    return scenesByPlotThread(scenes, id, linked);
  }
  async getScenesBetweenChapters(start: ChapterId, end: ChapterId): Promise<Scene[]> {
    const [scenes, chapters] = await Promise.all([this.listScenes(), this.listChapters()]);
    return scenesBetweenChapters(scenes, chapters, start, end);
  }
  async getCharacterAppearances(
    id: CharacterId,
  ): Promise<{ scenes: Scene[]; events: StoryEvent[] }> {
    const [scenes, events] = await Promise.all([this.listScenes(), this.listEvents()]);
    return characterAppearances(scenes, events, id);
  }
  async getObjectAppearances(id: ObjectId): Promise<Scene[]> {
    return scenesByObject(await this.listScenes(), id);
  }
  async getPlotThreadAppearances(id: PlotThreadId): Promise<Scene[]> {
    return this.getScenesByPlotThread(id);
  }

  // ── Entity update / delete / integrity ──────────────────────────────────────

  /**
   * Merge `patch` into an existing entity (id and kind are immutable — renaming
   * never changes the ID). References in the patch are validated.
   */
  async updateEntity<T extends HasId>(id: string, patch: Partial<T>): Promise<T> {
    const kind = kindOf(id);
    if (kind === null) throw new RepositoryError("entity_not_found", `Unknown entity id: ${id}`);
    const store = this.graph.store(kind);
    const existing = await store.get(id);
    if (existing === null) {
      throw new RepositoryError("entity_not_found", `No ${kind} with id ${id}.`);
    }
    const next = { ...(existing as object), ...patch, id } as unknown as HasId;
    await this.persistEntity(
      kind,
      next,
      displayName(kind, next as unknown as Record<string, unknown>),
      undefined,
      { operation: "update_entity", change: "updated" },
    );
    return next as unknown as T;
  }

  /** Every reference in the project that points at `id`. */
  findReferences(id: string): Promise<ReferenceEdge[]> {
    return this.graph.findReferrers(id);
  }

  /** Report references that point at non-existent entities. */
  checkIntegrity(): Promise<IntegrityReport> {
    return this.graph.checkIntegrity();
  }

  /**
   * Delete an entity safely. In `prevent` mode (default) a delete that would
   * orphan references throws with the dependency list; in `unlink` mode the
   * references are removed first. Never leaves dangling references.
   */
  async deleteEntity(id: string, options: { mode?: DeleteMode } = {}): Promise<DeleteResult> {
    const kind = kindOf(id);
    if (kind === null) throw new RepositoryError("entity_not_found", `Unknown entity id: ${id}`);
    const store = this.graph.store(kind);
    if ((await store.get(id)) === null) {
      throw new RepositoryError("entity_not_found", `No ${kind} with id ${id}.`);
    }

    const mode = options.mode ?? "prevent";
    const referrers = await this.graph.findReferrers(id);
    let unlinked: string[] = [];

    // Story-state transitions are references too. Deleting a fact that a
    // character's belief points at would leave the timeline citing something
    // that no longer exists, so it is refused on the same terms.
    const citing = (await this.transitions.list()).filter((t) => citesEntity(t, id));
    if (citing.length > 0 && mode === "prevent") {
      throw new RepositoryError(
        "has_references",
        `${id} is referenced by ${String(citing.length)} story-state transition(s) (${citing
          .map((t) => t.id)
          .join(", ")}). Delete them first or delete with mode "unlink".`,
        { details: { transitions: citing.map((t) => t.id) } },
      );
    }

    // Temporal relations are references too: a chronology that orders something
    // the project no longer has is a broken chronology.
    const linked = (await this.timeline.listLinks()).filter(
      (l) => l.fromId === id || l.toId === id,
    );
    if (linked.length > 0 && mode === "prevent") {
      throw new RepositoryError(
        "has_references",
        `${id} is referenced by ${String(linked.length)} temporal relation(s) (${linked
          .map((l) => l.id)
          .join(", ")}). Delete them first or delete with mode "unlink".`,
        { details: { temporalLinks: linked.map((l) => l.id) } },
      );
    }

    // A story test naming a deleted entity would assert nothing and fail
    // forever for the wrong reason.
    const asserting = (await this.tests.list()).filter(
      (test) =>
        assertionEntities(test.assertion).includes(id) || scopeAnchors(test.scope).includes(id),
    );
    if (asserting.length > 0 && mode === "prevent") {
      throw new RepositoryError(
        "has_references",
        `${id} is referenced by ${String(asserting.length)} story test(s) (${asserting
          .map((t) => t.id as string)
          .join(", ")}). Delete them first or delete with mode "unlink".`,
        { details: { storyTests: asserting.map((t) => t.id as string) } },
      );
    }

    // Registered causality is the strongest reason of all to hesitate: these
    // are the links a writer told the project to warn them about.
    const depending = await this.dependencies.touching(id);
    if (depending.length > 0 && mode === "prevent") {
      const radius = await this.calculateBlastRadius(id);
      throw new RepositoryError(
        "has_references",
        `${id} takes part in ${String(depending.length)} registered dependency(ies), and ${String(radius.total)} story element(s) depend on it directly or transitively. Review them first or delete with mode "unlink".`,
        {
          details: {
            dependencies: depending.map((d) => d.id),
            blastRadius: radius.affected.map((a) => a.id),
          },
        },
      );
    }

    if (referrers.length > 0 && mode === "prevent") {
      throw new RepositoryError(
        "has_references",
        `${id} is referenced by ${referrers.length} entit${referrers.length === 1 ? "y" : "ies"} (${referrers
          .map((r) => r.fromId)
          .join(", ")}). Unlink them first or delete with mode "unlink".`,
        { details: { referrers } },
      );
    }

    const name = displayName(kind, (await store.get(id)) as unknown as Record<string, unknown>);
    const entitiesChanged: EntityChange[] = [{ id, kind, change: "deleted" }];

    await this.recordChange(
      {
        actor: "human",
        operation: "delete_entity",
        summary: `Delete ${kind.replace(/_/g, " ")} “${name}”`,
        entitiesChanged,
      },
      async () => {
        for (const transition of citing) {
          await this.transitions.remove(transition.id);
        }
        await this.timeline.removeLinksFor(id);
        for (const test of asserting) await this.tests.remove(test.id as string);
        await this.dependencies.remove(depending.map((d) => d.id));
        if (referrers.length > 0) {
          unlinked = await this.graph.unlinkReferences(id);
          for (const otherId of unlinked) {
            await this.reindexAfterUnlink(otherId);
            const otherKind = kindOf(otherId);
            if (otherKind !== null) {
              const stillExists = (await this.graph.store(otherKind).get(otherId)) !== null;
              entitiesChanged.push({
                id: otherId,
                kind: otherKind,
                change: stillExists ? "updated" : "deleted",
              });
            }
          }
        }
        await store.remove(id);
        await this.deindexEntity(id);
        this.search.onEntityRemoved(kind, id);
        await this.touch();
      },
    );
    return { deletedId: id, unlinked };
  }

  // ── History, checkpoints & transactions ─────────────────────────────────────

  /** Revision history, newest first. */
  listChangeSets(): Promise<ChangeSetSummary[]> {
    return this.history.listChangeSets();
  }

  /** A full change set including per-file before/after content. */
  getChangeSet(id: string): Promise<ChangeSet | null> {
    return this.history.getChangeSet(id);
  }

  listCheckpoints(): Promise<Checkpoint[]> {
    return this.history.listCheckpoints();
  }

  /** Snapshot the whole project (excluding history) as a named, revertible point. */
  async createCheckpoint(label: string): Promise<Checkpoint> {
    const files: SnapshotFile[] = [];
    for (const path of await this.store.list()) {
      if (path.startsWith(HISTORY_PREFIX)) continue;
      const content = await this.store.readFile(path);
      if (content !== null) files.push({ path, content });
    }
    const changes = await this.history.listChangeSets();
    const atChangeSetId = changes[0]?.id;
    return this.history.saveCheckpoint(
      label.trim() || "Checkpoint",
      this.clock(),
      files,
      atChangeSetId,
    );
  }

  /**
   * Revert a single change set by re-applying its inverse (restore each file's
   * `before`). History is preserved: the original is marked `reverted` and the
   * revert is itself recorded as a new change set.
   */
  async revertChangeSet(id: string): Promise<ChangeSet> {
    const target = await this.history.getChangeSet(id);
    if (target === null) {
      throw new RepositoryError("entity_not_found", `No change set ${id}.`);
    }
    const change = await this.recordChange(
      {
        actor: "human",
        operation: "revert",
        summary: `Revert ${id}: ${target.summary}`,
        revertsChangeSetId: id,
        entitiesChanged: target.entitiesChanged.map((e) => ({
          ...e,
          change: inverseChange(e.change),
        })),
      },
      async () => {
        for (const fileChange of target.filesChanged) {
          if (fileChange.before === null) await this.store.delete(fileChange.path);
          else await this.store.writeFile(fileChange.path, fileChange.before);
        }
      },
    );
    await this.history.setStatus(id, "reverted");
    await this.reloadState();
    return change;
  }

  /** Revert the whole project to a checkpoint. Recorded as a new change set. */
  async revertToCheckpoint(id: string): Promise<ChangeSet> {
    const snapshot = await this.history.getCheckpointFiles(id);
    if (snapshot === null) {
      throw new RepositoryError("entity_not_found", `No checkpoint ${id}.`);
    }
    const snapshotMap = new Map(snapshot.map((f) => [f.path, f.content]));
    const checkpoint = (await this.history.listCheckpoints()).find((c) => c.id === id);
    const current = (await this.store.list()).filter((p) => !p.startsWith(HISTORY_PREFIX));

    const change = await this.recordChange(
      {
        actor: "human",
        operation: "revert_to_checkpoint",
        summary: `Revert to checkpoint “${checkpoint?.label ?? id}”`,
      },
      async () => {
        for (const path of current) {
          if (!snapshotMap.has(path)) await this.store.delete(path);
        }
        for (const [path, content] of snapshotMap) {
          if ((await this.store.readFile(path)) !== content) {
            await this.store.writeFile(path, content);
          }
        }
      },
    );
    await this.reloadState();
    return change;
  }

  /**
   * Begin a file-level staging transaction for a multi-step operation: stage
   * writes, `preview()` them, then `commit()` (records one change set) or
   * `discard()`. The primitive future AI workflows use to stay reversible.
   */
  // ── Chapter planning (Phase 32) ─────────────────────────────────────────────

  /**
   * Save a chapter plan through the journal.
   *
   * The store's own `save` writes the file; this wrapper is what makes the
   * write an ordinary change set — visible in History, diffable, revertible —
   * which is the whole of the plan-versioning story beyond the bounded
   * structured snapshots (§16). Reads go straight to `repo.plans`.
   */
  async saveChapterPlan(
    plan: Parameters<ChapterPlanStore["save"]>[0],
    options: { note?: string; actor?: "human" | "agent"; taskId?: string; modelId?: string } = {},
  ): Promise<ChapterPlan> {
    let stored!: ChapterPlan;
    await this.recordChange(
      {
        actor: options.actor ?? "human",
        operation: "edit_plan",
        summary: `Plan ${plan.chapterId}${options.note === undefined ? "" : ` — ${options.note}`}`,
        ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
        ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
      },
      async () => {
        stored = await this.plans.save(plan, {
          now: this.clock(),
          ...(options.note !== undefined ? { note: options.note } : {}),
        });
        await this.touch();
      },
    );
    return stored;
  }

  /**
   * Check whether a chapter plan contradicts the project before anything is
   * drafted from it (docs/PLANNING.md §6).
   *
   * Deterministic throughout: unknown references, POV absent from the scene,
   * forbidden knowledge the plan itself grants, payoffs with no setup, objects
   * and characters recorded elsewhere at the chapter's entry boundary, and
   * planned revelations whose source does not hold the information. Semantic
   * judgement about whether the plan is *good* is not this method's business.
   */
  async validateChapterPlan(plan: ChapterPlan): Promise<PlanFinding[]> {
    const findings: PlanFinding[] = [];
    const [characters, locations, threads, facts, setups, objects, scenes, chapters] =
      await Promise.all([
        this.listCharacters(),
        this.listLocations(),
        this.listPlotThreads(),
        this.listFacts(),
        this.listSetups(),
        this.listObjects(),
        this.listScenes(),
        this.listChapters(),
      ]);
    const known = {
      character: new Set(characters.map((c) => c.id as string)),
      location: new Set(locations.map((l) => l.id as string)),
      thread: new Set(threads.map((t) => t.id as string)),
      fact: new Set(facts.map((f) => f.id as string)),
      setup: new Set(setups.map((s) => s.id as string)),
      object: new Set(objects.map((o) => o.id as string)),
    };
    const setupById = new Map(setups.map((s) => [s.id as string, s]));

    if (plan.scenes.length === 0) {
      findings.push({
        severity: "warning",
        code: "empty_plan",
        message: "The plan has no scenes yet.",
      });
    }

    // The chapter's entry boundary: the last scene, in telling order, of any
    // chapter that comes before this one. State "entering the chapter" means
    // state after that scene; a first chapter has no boundary and the
    // state-dependent checks are skipped rather than guessed.
    const chapterOrder = new Map(chapters.map((c) => [c.id as string, c.order]));
    const myOrder = chapterOrder.get(plan.chapterId);
    let entrySceneId: string | null = null;
    if (myOrder !== undefined) {
      for (const scene of orderScenes(scenes, chapters)) {
        const order =
          scene.chapterId === undefined ? undefined : chapterOrder.get(scene.chapterId as string);
        if (order !== undefined && order < myOrder) entrySceneId = scene.id as string;
      }
    }
    const boundary =
      entrySceneId === null ? null : { sceneId: entrySceneId, position: "after" as const };

    const missing = (kind: keyof typeof known, id: string, sceneKey: string, what: string) => {
      if (!known[kind].has(id)) {
        findings.push({
          severity: "error",
          code: "unknown_reference",
          message: `${what} references ${id}, which does not exist in this project.`,
          sceneKey,
        });
        return true;
      }
      return false;
    };

    const plantedEarlier = new Set<string>();
    for (const planned of plan.scenes) {
      const where = `Planned scene "${planned.title}"`;
      if (planned.pov !== undefined) missing("character", planned.pov, planned.key, `${where} POV`);
      if (planned.locationId !== undefined)
        missing("location", planned.locationId, planned.key, `${where} location`);
      for (const id of planned.characterIds) missing("character", id, planned.key, where);
      for (const id of planned.objectIds) missing("object", id, planned.key, where);
      for (const id of planned.plotThreadIds) missing("thread", id, planned.key, where);
      for (const id of planned.requiredFactIds) missing("fact", id, planned.key, where);
      for (const id of planned.setupIds) missing("setup", id, planned.key, where);
      for (const id of planned.payoffSetupIds) missing("setup", id, planned.key, where);

      if (
        planned.pov !== undefined &&
        known.character.has(planned.pov) &&
        planned.characterIds.length > 0 &&
        !planned.characterIds.includes(planned.pov)
      ) {
        findings.push({
          severity: "warning",
          code: "pov_not_present",
          message: `${where}: the POV character ${planned.pov} is not among the scene's characters.`,
          sceneKey: planned.key,
        });
      }

      // The plan granting knowledge its own constraints forbid — the check that
      // makes "she must not yet understand what it opens" enforceable.
      for (const change of planned.knowledgeChanges) {
        if (missing("character", change.characterId, planned.key, `${where} knowledge change`))
          continue;
        if (missing("fact", change.factId, planned.key, `${where} knowledge change`)) continue;
        const forbidden = plan.forbiddenFacts.find(
          (f) =>
            f.factId === change.factId &&
            (f.characterId === undefined || f.characterId === change.characterId) &&
            change.to !== "unknown",
        );
        if (forbidden !== undefined) {
          findings.push({
            severity: "error",
            code: "forbidden_fact_granted",
            message: `${where} lets ${change.characterId} come to "${change.to}" ${change.factId}, which the plan itself forbids${forbidden.reason === undefined ? "" : ` (${forbidden.reason})`}.`,
            sceneKey: planned.key,
          });
        }

        // A planned revelation from a source who does not hold the information.
        if (
          change.sourceEntityId !== undefined &&
          change.sourceEntityId.startsWith("CHAR_") &&
          known.character.has(change.sourceEntityId) &&
          boundary !== null
        ) {
          const graph = await this.getFactKnowledgeGraph(change.factId, boundary);
          const holder = graph.holders.find((h) => h.characterId === change.sourceEntityId);
          if (
            holder === undefined ||
            holder.state === "unknown" ||
            holder.state === "disbelieved"
          ) {
            findings.push({
              severity: "error",
              code: "revelation_unavailable",
              message: `${where} has ${change.sourceEntityId} revealing ${change.factId} to ${change.characterId}, but entering this chapter ${change.sourceEntityId} does not hold it${holder === undefined ? "" : ` (state: ${holder.state})`}.`,
              sceneKey: planned.key,
              refs: { characterId: change.sourceEntityId, factId: change.factId },
            });
          }
        }
      }

      // A payoff whose setup was never planted — and is not planted earlier in
      // this same plan.
      for (const id of planned.payoffSetupIds) {
        const setup = setupById.get(id);
        if (setup === undefined) continue;
        if (setup.payoffSceneIds.length > 0) {
          findings.push({
            severity: "warning",
            code: "setup_already_paid",
            message: `${where} pays off ${id}, which is already paid off elsewhere.`,
            sceneKey: planned.key,
          });
        }
        if (setup.setupSceneIds.length === 0 && !plantedEarlier.has(id)) {
          findings.push({
            severity: "error",
            code: "payoff_without_setup",
            message: `${where} pays off ${id}, but nothing has planted it — not in the manuscript, and not earlier in this plan.`,
            sceneKey: planned.key,
            refs: { setupId: id },
          });
        }
      }
      for (const id of planned.setupIds) plantedEarlier.add(id);

      // Things recorded elsewhere at the entry boundary. Movement inside the
      // chapter is normal, so these are advisory, not refusals.
      if (
        boundary !== null &&
        planned.locationId !== undefined &&
        known.location.has(planned.locationId)
      ) {
        for (const id of planned.objectIds) {
          if (!known.object.has(id)) continue;
          const at = await this.getObjectLocation(id, boundary);
          if (at !== undefined && at !== planned.locationId) {
            findings.push({
              severity: "warning",
              code: "object_elsewhere",
              message: `${where} uses ${id} at ${planned.locationId}, but entering the chapter it is recorded at ${at}. Plan the move, or accept the jump.`,
              sceneKey: planned.key,
            });
          }
        }
        const people =
          planned.pov === undefined ? planned.characterIds : [planned.pov, ...planned.characterIds];
        for (const id of new Set(people)) {
          if (!known.character.has(id)) continue;
          const state = await this.getCharacterState(id, boundary);
          if (state.locationId !== undefined && state.locationId !== planned.locationId) {
            findings.push({
              severity: "info",
              code: "character_elsewhere",
              message: `${where}: ${id} was last recorded at ${state.locationId}; this scene is at ${planned.locationId}.`,
              sceneKey: planned.key,
            });
          }
        }
      }
    }
    return findings;
  }

  /**
   * Approve the current plan for a chapter, materialising its scenes.
   *
   * This is the moment a plan stops being a proposal: planned scenes without a
   * record get one (through the ordinary `addScene`, so IDs, journaling and
   * validation all apply), planned scenes with one are updated to match, and
   * the plan is stamped approved at a single pinned version the Chapter
   * Builder can hold on to. Nothing else in the project reads a draft plan.
   */
  async approveChapterPlan(chapterId: string): Promise<ChapterPlan> {
    const plan = await this.plans.get(chapterId);
    if (plan === null) {
      throw new RepositoryError("entity_not_found", `No plan exists for ${chapterId}.`);
    }
    const chapter = (await this.listChapters()).find((c) => (c.id as string) === chapterId);
    if (chapter === undefined) {
      throw new RepositoryError("entity_not_found", `No chapter exists with ID "${chapterId}".`);
    }

    const existing = new Map((await this.listScenes()).map((scene) => [scene.id as string, scene]));
    const materialised: PlannedScene[] = [];
    for (const planned of plan.scenes) {
      // Beats are the scene's purpose; a quick plan's objective stands in when
      // no beats were written. The builder reads purpose, so this is the exact
      // hand-off between the plan and Phase 31.
      const purpose =
        planned.beats.length > 0
          ? planned.beats
          : [planned.objective, planned.conflict, planned.exitState].filter(
              (line): line is string => line !== undefined && line.trim() !== "",
            );

      if (planned.sceneId !== undefined && existing.has(planned.sceneId)) {
        await this.updateEntity<Scene>(planned.sceneId, {
          title: planned.title,
          characterIds: planned.characterIds as Scene["characterIds"],
          plotThreadIds: planned.plotThreadIds as Scene["plotThreadIds"],
          objectIds: planned.objectIds as Scene["objectIds"],
          purpose,
          ...(planned.pov !== undefined ? { pov: planned.pov as Scene["pov"] } : {}),
          ...(planned.locationId !== undefined
            ? { locationId: planned.locationId as Scene["locationId"] }
            : {}),
        });
        materialised.push(planned);
      } else {
        const scene = await this.addScene({
          title: planned.title,
          chapterId: chapter.id,
          characterIds: planned.characterIds as Scene["characterIds"],
          plotThreadIds: planned.plotThreadIds as Scene["plotThreadIds"],
          objectIds: planned.objectIds as Scene["objectIds"],
          purpose,
          status: "planned",
          ...(planned.pov !== undefined ? { pov: planned.pov as Scene["pov"] } : {}),
          ...(planned.locationId !== undefined
            ? { locationId: planned.locationId as Scene["locationId"] }
            : {}),
        });
        materialised.push({ ...planned, sceneId: scene.id as string });
      }
    }
    let approved!: ChapterPlan;
    await this.recordChange(
      {
        actor: "human",
        operation: "approve_plan",
        summary: `Approve the plan for ${chapter.title}`,
      },
      async () => {
        approved = await this.plans.approve(chapterId, materialised, { now: this.clock() });
        await this.touch();
      },
    );
    return approved;
  }

  // ── Act plans (Phase 33) ────────────────────────────────────────────────────

  /**
   * Save an act plan through the journal — the same contract as
   * {@link saveChapterPlan}: the write is an ordinary change set, and the
   * store's bounded snapshots ride on top for structural comparison.
   */
  async saveActPlan(
    plan: Parameters<ActPlanStore["save"]>[0],
    options: { note?: string; actor?: "human" | "agent"; taskId?: string; modelId?: string } = {},
  ): Promise<ActPlan> {
    let stored!: ActPlan;
    await this.recordChange(
      {
        actor: options.actor ?? "human",
        operation: "edit_act_plan",
        summary: `Plan ${plan.title}${options.note === undefined ? "" : ` — ${options.note}`}`,
        ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
        ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
      },
      async () => {
        stored = await this.actPlans.save(plan, {
          now: this.clock(),
          ...(options.note !== undefined ? { note: options.note } : {}),
        });
        await this.touch();
      },
    );
    return stored;
  }

  /**
   * Approve the current act plan, pinning the version act builds hold on to.
   *
   * Unlike chapter-plan approval nothing is materialised: the act's chapters
   * already exist as entities. Approval refuses a plan naming chapters the
   * project does not have — an approved plan must be buildable as written.
   */
  async approveActPlan(actId: string): Promise<ActPlan> {
    const plan = await this.actPlans.get(actId);
    if (plan === null) {
      throw new RepositoryError("entity_not_found", `No act plan exists for ${actId}.`);
    }
    const known = new Set((await this.listChapters()).map((c) => c.id as string));
    const unknown = plan.chapters.filter((c) => !known.has(c.chapterId));
    if (unknown.length > 0) {
      throw new RepositoryError(
        "entity_not_found",
        `The plan for ${plan.title} names chapters this project does not contain: ${unknown
          .map((c) => c.chapterId)
          .join(", ")}.`,
      );
    }
    let approved!: ActPlan;
    await this.recordChange(
      {
        actor: "human",
        operation: "approve_act_plan",
        summary: `Approve the plan for ${plan.title}`,
      },
      async () => {
        approved = await this.actPlans.approve(actId, { now: this.clock() });
        await this.touch();
      },
    );
    return approved;
  }

  /**
   * Check an act plan against the project, deterministically
   * (docs/ACT_BUILDER.md). Whether the act is *good* is not checked here.
   */
  async validateActPlan(plan: ActPlan): Promise<ActPlanFinding[]> {
    const findings: ActPlanFinding[] = [];
    const [chapters, scenes, threads, characters, relationships, setups, facts, tests] =
      await Promise.all([
        this.listChapters(),
        this.listScenes(),
        this.listPlotThreads(),
        this.listCharacters(),
        this.listRelationships(),
        this.listSetups(),
        this.listFacts(),
        this.listStoryTests(),
      ]);

    if (plan.chapters.length === 0) {
      findings.push({
        severity: "warning",
        code: "empty_act",
        message: "The act has no chapters yet.",
      });
    }

    const chapterById = new Map(chapters.map((c) => [c.id as string, c]));
    const seen = new Set<string>();
    for (const member of plan.chapters) {
      if (!chapterById.has(member.chapterId)) {
        findings.push({
          severity: "error",
          code: "unknown_chapter",
          message: `The act names ${member.chapterId}, which does not exist in this project.`,
          chapterId: member.chapterId,
        });
        continue;
      }
      if (seen.has(member.chapterId)) {
        findings.push({
          severity: "error",
          code: "duplicate_chapter",
          message: `${member.chapterId} appears in the act more than once.`,
          chapterId: member.chapterId,
        });
      }
      seen.add(member.chapterId);
      if (!scenes.some((scene) => (scene.chapterId as string | undefined) === member.chapterId)) {
        findings.push({
          severity: "warning",
          code: "chapter_without_scenes",
          message: `${chapterById.get(member.chapterId)?.title ?? member.chapterId} has no scenes; a build will stop there until scenes exist or an approved plan creates them.`,
          chapterId: member.chapterId,
        });
      }
    }

    // Act order should follow manuscript order — a plan that builds Chapter 9
    // before Chapter 6 is probably a mistake, but it is the writer's to make.
    const orders = plan.chapters
      .map((member) => chapterById.get(member.chapterId)?.order)
      .filter((order): order is number => order !== undefined);
    for (let i = 1; i < orders.length; i += 1) {
      if ((orders[i] as number) < (orders[i - 1] as number)) {
        findings.push({
          severity: "warning",
          code: "chapter_out_of_order",
          message:
            "The act's chapters are not in manuscript order. The build follows the act's order.",
        });
        break;
      }
    }

    const referenced: { kind: string; ids: readonly string[]; known: Set<string> }[] = [
      {
        kind: "plot thread",
        ids: plan.plotThreadGoals.map((goal) => goal.threadId),
        known: new Set(threads.map((t) => t.id as string)),
      },
      {
        kind: "character",
        ids: plan.characterArcGoals.map((goal) => goal.characterId),
        known: new Set(characters.map((c) => c.id as string)),
      },
      {
        kind: "relationship",
        ids: plan.relationshipGoals.map((goal) => goal.relationshipId),
        known: new Set(relationships.map((r) => r.id as string)),
      },
      {
        kind: "setup",
        ids: [...plan.requiredSetupIds, ...plan.requiredPayoffIds],
        known: new Set(setups.map((s) => s.id as string)),
      },
      {
        kind: "fact",
        ids: [
          ...plan.forbiddenFacts.map((constraint) => constraint.factId),
          ...plan.characterArcGoals
            .map((goal) => goal.factId)
            .filter((id): id is string => id !== undefined),
        ],
        known: new Set(facts.map((f) => f.id as string)),
      },
      {
        kind: "story test",
        ids: plan.storyTestIds,
        known: new Set(tests.map((t) => t.id as string)),
      },
    ];
    for (const { kind, ids, known } of referenced) {
      for (const id of new Set(ids)) {
        if (!known.has(id)) {
          findings.push({
            severity: "error",
            code: "unknown_reference",
            message: `The act's goals reference ${kind} ${id}, which does not exist in this project.`,
          });
        }
      }
    }

    // A payoff the act requires, whose setup is neither planted in the
    // manuscript nor required to be planted by this same act.
    const setupById = new Map(setups.map((s) => [s.id as string, s]));
    for (const id of plan.requiredPayoffIds) {
      const setup = setupById.get(id);
      if (setup === undefined) continue;
      if (setup.setupSceneIds.length === 0 && !plan.requiredSetupIds.includes(id)) {
        findings.push({
          severity: "error",
          code: "payoff_without_setup",
          message: `The act requires ${id} to pay off, but nothing has planted it — not in the manuscript, and not among the act's required setups.`,
        });
      }
    }
    return findings;
  }

  /**
   * Where the act's goals stand, answered from recorded state alone (§3, §8).
   *
   * Deterministic wherever a goal carries a hook (a target status, a fact and
   * knowledge state, a tracked relationship dimension, a setup). A goal that is
   * only the author's intent comes back `not_evaluated` with whatever the
   * record can say as evidence — measurement, never judgement. No model is
   * involved anywhere in this method.
   */
  async evaluateActGoals(plan: ActPlan): Promise<ActGoalReport> {
    const [chapters, scenes, setups] = await Promise.all([
      this.listChapters(),
      this.listScenes(),
      this.listSetups(),
    ]);
    const actChapterIds = new Set(plan.chapters.map((member) => member.chapterId));
    const ordered = orderScenes(scenes, chapters);
    const actScenes = ordered.filter(
      (scene) => scene.chapterId !== undefined && actChapterIds.has(scene.chapterId as string),
    );
    const actSceneIds = new Set(actScenes.map((scene) => scene.id as string));

    // Boundaries: entering the act (after the last scene before its first
    // scene) and leaving it (after its last scene). Goals ask about the exit.
    const lastActScene = actScenes[actScenes.length - 1];
    const closing: StateBoundary | null =
      lastActScene === undefined ? null : { sceneId: lastActScene.id as string, position: "after" };
    const firstActScene = actScenes[0];
    const firstIndex =
      firstActScene === undefined
        ? -1
        : ordered.findIndex((scene) => scene.id === firstActScene.id);
    const before = firstIndex > 0 ? ordered[firstIndex - 1] : undefined;
    const entry: StateBoundary | null =
      before === undefined ? null : { sceneId: before.id as string, position: "after" };

    const results: ActGoalResult[] = [];

    for (const goal of plan.plotThreadGoals) {
      const touches = actScenes.filter((scene) =>
        (scene.plotThreadIds as readonly string[]).includes(goal.threadId),
      ).length;
      const evidenceParts = [`${String(touches)} act scene(s) touch the thread`];
      let status: ActGoalResult["status"] = "not_evaluated";
      let method: ActGoalResult["method"] = "semantic";
      if (goal.minAdvances !== undefined || goal.targetStatus !== undefined) {
        method = "deterministic";
        let ok = true;
        if (goal.minAdvances !== undefined) ok = touches >= goal.minAdvances;
        if (ok && goal.targetStatus !== undefined && closing !== null) {
          const state = await this.getThreadState(goal.threadId, closing);
          evidenceParts.push(`status at act end: ${state.status}`);
          ok = state.status === goal.targetStatus;
        } else if (goal.targetStatus !== undefined && closing === null) {
          ok = false;
          evidenceParts.push("no act scenes yet, so the target status cannot hold");
        }
        status = ok ? "satisfied" : "unsatisfied";
      }
      results.push({
        kind: "thread",
        refId: goal.threadId,
        statement: goal.intent,
        status,
        method,
        evidence: evidenceParts.join("; "),
      });
    }

    for (const goal of plan.characterArcGoals) {
      if (goal.factId !== undefined && goal.target !== undefined && closing !== null) {
        const graph = await this.getFactKnowledgeGraph(goal.factId, closing);
        const holder = graph.holders.find((h) => h.characterId === goal.characterId);
        const state = holder?.state ?? "unknown";
        results.push({
          kind: "arc",
          refId: goal.characterId,
          statement: goal.movement,
          status: state === goal.target ? "satisfied" : "unsatisfied",
          method: "deterministic",
          evidence: `${goal.characterId} holds ${goal.factId} as "${state}" at act end (target: "${goal.target}")`,
        });
      } else {
        results.push({
          kind: "arc",
          refId: goal.characterId,
          statement: goal.movement,
          status: "not_evaluated",
          method: "semantic",
          evidence:
            goal.factId === undefined
              ? "the author's intent; needs the writer's reading"
              : "no act scenes yet",
        });
      }
    }

    for (const goal of plan.relationshipGoals) {
      if (goal.dimension !== undefined && goal.direction !== undefined && closing !== null) {
        const at = await this.getRelationshipAt(goal.relationshipId, closing);
        const end = at.dimensions[goal.dimension as keyof typeof at.dimensions];
        const start =
          entry === null
            ? undefined
            : (await this.getRelationshipAt(goal.relationshipId, entry)).dimensions[
                goal.dimension as keyof typeof at.dimensions
              ];
        const moved = compareDimension(start, end);
        if (moved === null) {
          results.push({
            kind: "relationship",
            refId: goal.relationshipId,
            statement: goal.intent,
            status: "unsatisfied",
            method: "deterministic",
            evidence: `no recorded change to ${goal.dimension} across the act`,
          });
        } else {
          const ok = goal.direction === "falls" ? moved < 0 : moved > 0;
          results.push({
            kind: "relationship",
            refId: goal.relationshipId,
            statement: goal.intent,
            status: ok ? "satisfied" : "unsatisfied",
            method: "deterministic",
            evidence: `${goal.dimension} ${moved < 0 ? "fell" : moved > 0 ? "rose" : "held level"} across the act (${describeValue(start)} → ${describeValue(end)})`,
          });
        }
      } else {
        const history = (await this.getRelationshipHistory(goal.relationshipId)).filter((change) =>
          actSceneIds.has(change.sceneId),
        );
        results.push({
          kind: "relationship",
          refId: goal.relationshipId,
          statement: goal.intent,
          status: "not_evaluated",
          method: "semantic",
          evidence: `${String(history.length)} recorded change(s) within the act; the intent needs the writer's reading`,
        });
      }
    }

    const setupById = new Map(setups.map((s) => [s.id as string, s]));
    for (const id of plan.requiredSetupIds) {
      const setup = setupById.get(id);
      const planted =
        setup !== undefined &&
        setup.setupSceneIds.some((sceneId) => actSceneIds.has(sceneId as string));
      results.push({
        kind: "setup",
        refId: id,
        statement: `${id} is planted within the act`,
        status: planted ? "satisfied" : "unsatisfied",
        method: "deterministic",
        evidence:
          setup === undefined
            ? `${id} does not exist`
            : planted
              ? "planted in an act scene"
              : "no act scene plants it",
      });
    }
    for (const id of plan.requiredPayoffIds) {
      const setup = setupById.get(id);
      const paid =
        setup !== undefined &&
        setup.payoffSceneIds.some((sceneId) => actSceneIds.has(sceneId as string));
      results.push({
        kind: "payoff",
        refId: id,
        statement: `${id} pays off within the act`,
        status: paid ? "satisfied" : "unsatisfied",
        method: "deterministic",
        evidence:
          setup === undefined
            ? `${id} does not exist`
            : paid
              ? "paid off in an act scene"
              : "no act scene pays it off",
      });
    }

    for (const constraint of plan.forbiddenFacts) {
      if (closing === null) {
        results.push({
          kind: "forbidden_fact",
          refId: constraint.factId,
          statement: constraint.reason ?? `${constraint.factId} stays withheld through the act`,
          status: "not_evaluated",
          method: "deterministic",
          evidence: "no act scenes yet",
        });
        continue;
      }
      const graph = await this.getFactKnowledgeGraph(constraint.factId, closing);
      const offenders = graph.holders.filter(
        (holder) =>
          (constraint.characterId === undefined || holder.characterId === constraint.characterId) &&
          holder.state !== "unknown" &&
          holder.state !== "disbelieved",
      );
      results.push({
        kind: "forbidden_fact",
        refId: constraint.factId,
        statement: constraint.reason ?? `${constraint.factId} stays withheld through the act`,
        status: offenders.length === 0 ? "satisfied" : "unsatisfied",
        method: "deterministic",
        evidence:
          offenders.length === 0
            ? "nobody it protects holds the information at act end"
            : `held at act end by ${offenders.map((h) => `${h.characterId} (${h.state})`).join(", ")}`,
      });
    }

    return summariseGoalReport(
      results,
      this.clock(),
      closing === null ? undefined : closing.sceneId,
    );
  }

  // ── The book plan (Phase 34) ────────────────────────────────────────────────

  /** Save the book plan through the journal — the same contract as act plans. */
  async saveBookPlan(
    plan: Parameters<BookPlanStore["save"]>[0],
    options: { note?: string; actor?: "human" | "agent"; taskId?: string; modelId?: string } = {},
  ): Promise<BookPlan> {
    let stored!: BookPlan;
    await this.recordChange(
      {
        actor: options.actor ?? "human",
        operation: "edit_book_plan",
        summary: `Plan the book${options.note === undefined ? "" : ` — ${options.note}`}`,
        ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
        ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
      },
      async () => {
        stored = await this.bookPlan.save(plan, {
          now: this.clock(),
          ...(options.note !== undefined ? { note: options.note } : {}),
        });
        await this.touch();
      },
    );
    return stored;
  }

  /**
   * Approve the book plan. Refused while it names acts that do not exist —
   * an approved book plan must be buildable as written; the acts' own plans
   * may still be drafts, and the build gates on each in turn.
   */
  async approveBookPlan(): Promise<BookPlan> {
    const plan = await this.bookPlan.get();
    if (plan === null) {
      throw new RepositoryError("entity_not_found", "No book plan exists to approve.");
    }
    const known = new Set(await this.actPlans.list());
    const unknown = plan.acts.filter((act) => !known.has(act.actId));
    if (unknown.length > 0) {
      throw new RepositoryError(
        "entity_not_found",
        `The book plan names acts this project does not contain: ${unknown
          .map((act) => act.actId)
          .join(", ")}.`,
      );
    }
    let approved!: BookPlan;
    await this.recordChange(
      { actor: "human", operation: "approve_book_plan", summary: "Approve the book plan" },
      async () => {
        approved = await this.bookPlan.approve({ now: this.clock() });
        await this.touch();
      },
    );
    return approved;
  }

  /** Check the book plan against the project, deterministically. */
  async validateBookPlan(plan: BookPlan): Promise<BookPlanFinding[]> {
    const findings: BookPlanFinding[] = [];
    if (plan.acts.length === 0) {
      findings.push({
        severity: "warning",
        code: "empty_book",
        message: "The book has no acts yet.",
      });
    }

    const knownActs = new Set(await this.actPlans.list());
    const seen = new Set<string>();
    const chapterOwner = new Map<string, string>();
    for (const member of plan.acts) {
      if (!knownActs.has(member.actId)) {
        findings.push({
          severity: "error",
          code: "unknown_act",
          message: `The book names ${member.actId}, which has no act plan in this project.`,
          actId: member.actId,
        });
        continue;
      }
      if (seen.has(member.actId)) {
        findings.push({
          severity: "error",
          code: "duplicate_act",
          message: `${member.actId} appears in the book more than once.`,
          actId: member.actId,
        });
        continue;
      }
      seen.add(member.actId);
      const actPlan = await this.actPlans.get(member.actId);
      if (actPlan === null) continue;
      if (actPlan.status !== "approved") {
        findings.push({
          severity: "warning",
          code: "act_not_approved",
          message: `The plan for ${actPlan.title} is still a ${actPlan.status}; the build will stop there until it is approved.`,
          actId: member.actId,
        });
      }
      if (actPlan.chapters.length === 0) {
        findings.push({
          severity: "warning",
          code: "act_without_chapters",
          message: `${actPlan.title} has no chapters yet.`,
          actId: member.actId,
        });
      }
      for (const chapter of actPlan.chapters) {
        const owner = chapterOwner.get(chapter.chapterId);
        if (owner !== undefined && owner !== member.actId) {
          findings.push({
            severity: "error",
            code: "chapter_in_two_acts",
            message: `${chapter.chapterId} belongs to both ${owner} and ${member.actId}. A chapter is built once, in one act.`,
            actId: member.actId,
          });
        }
        chapterOwner.set(chapter.chapterId, member.actId);
      }
    }

    const [threads, characters, relationships, tests] = await Promise.all([
      this.listPlotThreads(),
      this.listCharacters(),
      this.listRelationships(),
      this.listStoryTests(),
    ]);
    const referenced: { kind: string; ids: readonly string[]; known: Set<string> }[] = [
      {
        kind: "plot thread",
        ids: plan.majorPlotThreads.map((goal) => goal.threadId),
        known: new Set(threads.map((t) => t.id as string)),
      },
      {
        kind: "character",
        ids: plan.characterArcGoals.map((goal) => goal.characterId),
        known: new Set(characters.map((c) => c.id as string)),
      },
      {
        kind: "relationship",
        ids: plan.relationshipArcGoals.map((goal) => goal.relationshipId),
        known: new Set(relationships.map((r) => r.id as string)),
      },
      {
        kind: "story test",
        ids: plan.storyTestIds,
        known: new Set(tests.map((t) => t.id as string)),
      },
    ];
    for (const { kind, ids, known } of referenced) {
      for (const id of new Set(ids)) {
        if (!known.has(id)) {
          findings.push({
            severity: "error",
            code: "unknown_reference",
            message: `The book's goals reference ${kind} ${id}, which does not exist in this project.`,
          });
        }
      }
    }
    return findings;
  }

  /**
   * Where the book's goals stand (§8), answered from recorded state at the end
   * of the book's last act — the same deterministic engine as act goals, run
   * over the chapters of every act the book names. The Story State system
   * stays the single authority (§7): this reads it and records nothing.
   */
  async evaluateBookGoals(plan: BookPlan): Promise<ActGoalReport> {
    const chapters: { chapterId: string }[] = [];
    for (const member of plan.acts) {
      const actPlan = await this.actPlans.get(member.actId);
      if (actPlan === null) continue;
      for (const chapter of actPlan.chapters) chapters.push({ chapterId: chapter.chapterId });
    }
    return this.evaluateActGoals({
      id: plan.id,
      actId: "BOOK",
      title: "the book",
      version: plan.version,
      status: plan.status,
      chapters,
      plotThreadGoals: plan.majorPlotThreads,
      characterArcGoals: plan.characterArcGoals,
      relationshipGoals: plan.relationshipArcGoals,
      requiredSetupIds: [],
      requiredPayoffIds: [],
      forbiddenFacts: [],
      constraints: [],
      notes: [],
      storyTestIds: plan.storyTestIds,
      source: plan.source,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      revisions: [],
    });
  }

  // ── Research (Phase 35) ─────────────────────────────────────────────────────

  /**
   * Add a research item — sourced real-world knowledge, kept structurally
   * apart from canon (§1). Links are validated; provenance is stored verbatim
   * and never stripped (§3). An item created by an agent always arrives
   * `unreviewed` — trust is the author's judgement, never a default (§4).
   */
  async addResearchItem(
    input: Omit<ResearchItem, "id" | "createdAt" | "updatedAt">,
    options: { actor?: "human" | "agent"; taskId?: string; modelId?: string } = {},
  ): Promise<ResearchItem> {
    await this.assertResearchLinks(input.linkedEntityIds, input.linkedSceneIds);
    const now = this.clock();
    const item: ResearchItem = {
      ...input,
      status: options.actor === "agent" ? "unreviewed" : input.status,
      id: await this.research.nextItemId(),
      createdAt: now,
      updatedAt: now,
    };
    await this.recordChange(
      {
        actor: options.actor ?? "human",
        operation: "add_research",
        summary: `Research: ${item.title}`,
        ...(options.taskId !== undefined ? { taskId: options.taskId } : {}),
        ...(options.modelId !== undefined ? { modelId: options.modelId } : {}),
      },
      async () => {
        await this.research.saveItem(item);
        await this.touch();
      },
    );
    return item;
  }

  /**
   * Update a research item. Provenance is immutable — how something was
   * obtained is a fact about the past, not an editable field (§3).
   */
  async updateResearchItem(
    id: string,
    patch: Partial<Omit<ResearchItem, "id" | "provenance" | "createdAt" | "updatedAt">>,
    options: { actor?: "human" | "agent" } = {},
  ): Promise<ResearchItem> {
    const held = await this.research.getItem(id);
    if (held === null) {
      throw new RepositoryError("entity_not_found", `No research item with id ${id}.`);
    }
    await this.assertResearchLinks(
      patch.linkedEntityIds ?? held.linkedEntityIds,
      patch.linkedSceneIds ?? held.linkedSceneIds,
    );
    const updated: ResearchItem = {
      ...held,
      ...patch,
      id: held.id,
      provenance: held.provenance,
      createdAt: held.createdAt,
      updatedAt: this.clock(),
    };
    await this.recordChange(
      {
        actor: options.actor ?? "human",
        operation: "edit_research",
        summary: `Research: ${updated.title}`,
      },
      async () => {
        await this.research.saveItem(updated);
        await this.touch();
      },
    );
    return updated;
  }

  /** Delete a research item. A writer's action — no agent path leads here (§25). */
  async deleteResearchItem(id: string): Promise<void> {
    const held = await this.research.getItem(id);
    if (held === null) {
      throw new RepositoryError("entity_not_found", `No research item with id ${id}.`);
    }
    await this.recordChange(
      { actor: "human", operation: "delete_research", summary: `Delete research: ${held.title}` },
      async () => {
        await this.research.removeItem(id);
        await this.touch();
      },
    );
  }

  listResearchItems(): Promise<ResearchItem[]> {
    return this.research.listItems();
  }

  getResearchItem(id: string): Promise<ResearchItem | null> {
    return this.research.getItem(id);
  }

  /**
   * Search the library (§23) — lexical over title, summary, content, notes and
   * facts, filtered by tag, status, type, source and linked entity. Distinct
   * from manuscript search: research is a different kind of truth.
   */
  async searchResearch(query: {
    text?: string;
    tag?: string;
    status?: ResearchItem["status"];
    type?: ResearchItem["type"];
    linkedId?: string;
    source?: string;
  }): Promise<ResearchItem[]> {
    const items = await this.research.listItems();
    const needle = query.text?.toLowerCase().trim();
    return items.filter((item) => {
      if (query.tag !== undefined && !item.tags.includes(query.tag)) return false;
      if (query.status !== undefined && item.status !== query.status) return false;
      if (query.type !== undefined && item.type !== query.type) return false;
      if (
        query.linkedId !== undefined &&
        !item.linkedEntityIds.includes(query.linkedId) &&
        !item.linkedSceneIds.includes(query.linkedId)
      ) {
        return false;
      }
      if (
        query.source !== undefined &&
        !`${item.sourceTitle ?? ""} ${item.sourceUrl ?? ""} ${item.sourceAuthor ?? ""}`
          .toLowerCase()
          .includes(query.source.toLowerCase())
      ) {
        return false;
      }
      if (needle !== undefined && needle !== "") {
        const haystack = [
          item.title,
          item.summary ?? "",
          item.content ?? "",
          item.notes ?? "",
          item.tags.join(" "),
          ...item.facts.map((fact) => fact.statement),
        ]
          .join("\n")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }

  // ── Research tasks (§17) ────────────────────────────────────────────────────

  async addResearchTask(input: { question: string; scope?: ResearchScope }): Promise<ResearchTask> {
    if (input.scope !== undefined) {
      const ids = [
        ...(input.scope.sceneId !== undefined ? [input.scope.sceneId] : []),
        ...(input.scope.chapterId !== undefined ? [input.scope.chapterId] : []),
        ...(input.scope.entityIds ?? []),
      ];
      for (const id of ids) {
        if ((await this.getEntity(id)) === null) {
          throw new RepositoryError(
            "entity_not_found",
            `The research task's scope references "${id}", which does not exist in this project.`,
          );
        }
      }
    }
    const now = this.clock();
    const task: ResearchTask = {
      id: await this.research.nextTaskId(),
      question: input.question,
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      status: "pending",
      findingItemIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.research.saveTask(task);
    return task;
  }

  async updateResearchTask(
    id: string,
    patch: Partial<Pick<ResearchTask, "status" | "findingItemIds" | "failureReason">>,
  ): Promise<ResearchTask> {
    const held = await this.research.getTask(id);
    if (held === null) {
      throw new RepositoryError("entity_not_found", `No research task with id ${id}.`);
    }
    const updated: ResearchTask = { ...held, ...patch, updatedAt: this.clock() };
    await this.research.saveTask(updated);
    return updated;
  }

  listResearchTasks(): Promise<ResearchTask[]> {
    return this.research.listTasks();
  }

  getResearchTask(id: string): Promise<ResearchTask | null> {
    return this.research.getTask(id);
  }

  /**
   * Every unresolved `[RESEARCH: …]` placeholder in the manuscript (§19, §21),
   * attributed to the scene whose span holds it. Deterministic; the research
   * skill and the builders read this, and nothing acts on it automatically.
   */
  /**
   * Everything the semantic compiler reads, assembled once (Phase 37).
   *
   * Prose arrives per scene — read from the chapter files through the scene
   * spans — so a scene-scoped semantic build genuinely reads one scene.
   * The voice profile is included whole; the rules themselves only honour
   * the writer's own rules and confirmed tendencies (§7).
   */
  async semanticContext(): Promise<SemanticBuildContext> {
    const [
      scenes,
      chapters,
      characters,
      relationships,
      setups,
      decisions,
      dependencies,
      transitions,
      voice,
      modules,
      simulationSummaries,
    ] = await Promise.all([
      this.listScenes(),
      this.listChapters(),
      this.listCharacters(),
      this.listRelationships(),
      this.listSetups(),
      this.listDecisions(),
      this.listDependencies(),
      this.listStateTransitions(),
      this.voice.load(),
      this.modules.enabled(),
      this.readerSims.list(6),
    ]);

    const prose: Record<string, string> = {};
    for (const chapter of chapters) {
      const file = (await this.readProjectFile(chapter.filePath)) ?? "";
      for (const span of listSceneSpans(file)) {
        prose[span.sceneId] = file.slice(span.start, span.end).trim();
      }
    }

    const readerSimulations = (
      await Promise.all(simulationSummaries.map((summary) => this.readerSims.get(summary.id)))
    ).filter((simulation): simulation is NonNullable<typeof simulation> => simulation !== null);

    return {
      scenes,
      chapters,
      characters,
      relationships,
      setups,
      decisions,
      dependencies,
      transitions,
      prose,
      voice,
      modules,
      readerSimulations,
    };
  }

  async findResearchGaps(): Promise<
    { chapterId: string; chapterTitle: string; sceneId?: string; question: string }[]
  > {
    const chapters = await this.listChapters();
    const out: { chapterId: string; chapterTitle: string; sceneId?: string; question: string }[] =
      [];
    for (const chapter of chapters) {
      const file = (await this.readProjectFile(chapter.filePath)) ?? "";
      const spans = listSceneSpans(file);
      for (const gap of findResearchPlaceholders(file)) {
        const span = spans.find((s) => gap.index >= s.start && gap.index < s.end);
        out.push({
          chapterId: chapter.id as string,
          chapterTitle: chapter.title,
          ...(span !== undefined ? { sceneId: span.sceneId } : {}),
          question: gap.question,
        });
      }
    }
    return out;
  }

  /**
   * "Use in Story" (§15): the one bridge from research to canon, and it is the
   * writer crossing it. Creates the entity through the ordinary paths — a Fact
   * (with the research source carried in its `source` field), a World Rule, or
   * a note appended to an existing entity — then records the promotion on the
   * research fact so the bridge is visible from both sides. Nothing else in
   * the system converts research into story truth.
   */
  async canoniseResearchFact(
    itemId: string,
    factIndex: number,
    target:
      | { kind: "fact"; objectiveTruth?: boolean }
      | { kind: "world_rule"; name: string; severity?: WorldRuleSeverity }
      | { kind: "entity_note"; entityId: string },
  ): Promise<{ item: ResearchItem; entityId: string }> {
    const item = await this.research.getItem(itemId);
    if (item === null) {
      throw new RepositoryError("entity_not_found", `No research item with id ${itemId}.`);
    }
    const fact = item.facts[factIndex];
    if (fact === undefined) {
      throw new RepositoryError(
        "entity_not_found",
        `${itemId} has no research fact at position ${String(factIndex)}.`,
      );
    }
    const source = `Research: ${item.title}${
      item.sourceTitle !== undefined ? ` — ${item.sourceTitle}` : ""
    }${item.sourceUrl !== undefined ? ` (${item.sourceUrl})` : ""} [${item.id}]`;

    let entityId: string;
    if (target.kind === "fact") {
      const created = await this.addFact({
        statement: fact.statement,
        objectiveTruth: target.objectiveTruth ?? true,
        source,
      });
      entityId = created.id as string;
    } else if (target.kind === "world_rule") {
      const created = await this.addWorldRule({
        name: target.name,
        description: `${fact.statement}\n\n${source}`,
        severity: target.severity ?? "soft",
      });
      entityId = created.id as string;
    } else {
      const entity = await this.getEntity(target.entityId);
      if (entity === null) {
        throw new RepositoryError(
          "entity_not_found",
          `No entity with id ${target.entityId} to attach the research to.`,
        );
      }
      const record = entity as unknown as { notes?: unknown };
      if (typeof record.notes !== "string") {
        throw new RepositoryError(
          "invalid_reference",
          `${target.entityId} has no notes field to carry the research detail.`,
        );
      }
      const appended = `${record.notes === "" ? "" : `${record.notes}\n\n`}${fact.statement}\n(${source})`;
      await this.updateEntity(target.entityId, { notes: appended } as never);
      entityId = target.entityId;
    }

    const updated: ResearchItem = {
      ...item,
      facts: item.facts.map((held, index) =>
        index === factIndex ? { ...held, canonisedAs: entityId } : held,
      ),
      linkedEntityIds: item.linkedEntityIds.includes(entityId)
        ? item.linkedEntityIds
        : [...item.linkedEntityIds, entityId],
      updatedAt: this.clock(),
    };
    await this.recordChange(
      {
        actor: "human",
        operation: "canonise_research",
        summary: `Use in story: "${fact.statement}" from ${item.title}`,
      },
      async () => {
        await this.research.saveItem(updated);
        await this.touch();
      },
    );
    return { item: updated, entityId };
  }

  private async assertResearchLinks(
    entityIds: readonly string[],
    sceneIds: readonly string[],
  ): Promise<void> {
    for (const id of [...entityIds, ...sceneIds]) {
      if ((await this.getEntity(id)) === null) {
        throw new RepositoryError(
          "entity_not_found",
          `This research links to "${id}", which does not exist in this project.`,
        );
      }
    }
  }

  beginTransaction(summary = "Staged changes", meta: TransactionMeta = {}): StagedTransaction {
    return new StagedTransaction(
      (path) => this.store.readFile(path),
      async (ops: StagedFileOp[], entities: EntityChange[], sum: string, at?: TransactionMeta) => {
        const final = { ...meta, ...at };
        const change = await this.recordChange(
          {
            actor: final.actor ?? "agent",
            operation: final.operation ?? "transaction",
            summary: sum,
            entitiesChanged: entities,
            ...(final.taskId !== undefined ? { taskId: final.taskId } : {}),
            ...(final.modelId !== undefined ? { modelId: final.modelId } : {}),
            ...(final.ai !== undefined ? { ai: final.ai } : {}),
          },
          async () => {
            for (const op of ops) {
              if (op.content === null) await this.store.delete(op.path);
              else await this.store.writeFile(op.path, op.content);
            }
          },
        );
        await this.reloadState();
        return change;
      },
      summary,
    );
  }

  /**
   * Build and test the project **as it would be** if a transaction committed,
   * without committing it.
   *
   * The whole project is copied into memory, the staged writes applied on top,
   * and a second repository opened over the copy. Nothing on disk moves.
   *
   * This is what lets "validate, then commit only after approval" be literally
   * true rather than "commit, validate, revert if it went badly". A writer
   * being shown diagnostics for a change that has already happened is being
   * shown a fait accompli (docs/STORY_REFACTOR.md).
   */
  async validateStaged(tx: StagedTransaction): Promise<{
    build: StoryBuild;
    tests: TestRunSummary;
  }> {
    const seed: Record<string, string> = {};
    for (const path of await this.store.list()) {
      const content = await this.store.readFile(path);
      if (content !== null) seed[path] = content;
    }
    for (const change of await tx.preview()) {
      if (change.after === null) delete seed[change.path];
      else seed[change.path] = change.after;
    }

    const shadow = await StoryRepository.openProject({ store: new InMemoryProjectStore(seed) });
    const [build, tests] = await Promise.all([
      shadow.buildStory({ persist: false }),
      shadow.runStoryTests(),
    ]);
    return { build, tests };
  }

  /**
   * Stage an entity update as a file write, without performing it.
   *
   * Reads through the transaction, so several patches to entities sharing one
   * JSON collection compose instead of overwriting each other. Codec knowledge
   * stays here, where the storage layout lives.
   */
  async stageEntityUpdate<T extends HasId>(
    tx: StagedTransaction,
    id: string,
    patch: Partial<T>,
  ): Promise<void> {
    const kind = kindOf(id);
    if (kind === null) throw new RepositoryError("entity_not_found", `Unknown entity id: ${id}`);
    const staged = await this.graph.stageUpdate(kind, id, patch, (path) => tx.readFile(path));
    if (staged === null) {
      throw new RepositoryError("entity_not_found", `No ${kind} with id ${id}.`);
    }
    tx.writeFile(staged.path, staged.content).note({ id, kind, change: "updated" });
  }

  /** Re-read in-memory state (manifest, id counters, search) after a revert. */
  private async reloadState(): Promise<void> {
    const raw = await this.store.readFile(PATHS.manifest);
    if (raw !== null) {
      const parsed = validateManifest(raw);
      if (parsed.ok) this.manifest = parsed.value;
    }
    this.ids = await loadIdGenerator(this.store);
    await this.search.rebuild();
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** Run `body` as one recorded change set; roll back file writes on failure. */
  private async recordChange(
    meta: {
      actor: Actor;
      operation: string;
      summary: string;
      entitiesChanged?: readonly EntityChange[];
      revertsChangeSetId?: string;
      taskId?: string;
      modelId?: string;
      ai?: AiProvenance;
    },
    body: () => Promise<void>,
  ): Promise<ChangeSet> {
    this.store.beginRecording();
    try {
      await body();
    } catch (error) {
      await this.store.rollbackRecording();
      throw error;
    }
    const filesChanged = this.store.endRecording();
    return this.history.append({
      timestamp: this.clock(),
      actor: meta.actor,
      operation: meta.operation,
      filesChanged,
      entitiesChanged: meta.entitiesChanged ?? [],
      summary: meta.summary,
      status: "committed",
      ...(meta.revertsChangeSetId !== undefined
        ? { revertsChangeSetId: meta.revertsChangeSetId }
        : {}),
      ...(meta.taskId !== undefined ? { taskId: meta.taskId } : {}),
      ...(meta.modelId !== undefined ? { modelId: meta.modelId } : {}),
      ...(meta.ai !== undefined ? { ai: meta.ai } : {}),
    });
  }

  private async persistEntity(
    kind: GraphKind,
    entity: HasId,
    name: string,
    filePath: string | undefined,
    op: { operation: string; change: "created" | "updated"; actor?: Actor },
  ): Promise<void> {
    await this.validateReferences(kind, entity); // read-only; outside the change set
    await this.recordChange(
      {
        actor: op.actor ?? "human",
        operation: op.operation,
        summary: `${op.change === "created" ? "Create" : "Update"} ${kind.replace(/_/g, " ")} “${name}”`,
        entitiesChanged: [{ id: entity.id, kind, change: op.change }],
      },
      async () => {
        await this.graph.store(kind).put(entity);
        await this.recordEntity({
          id: entity.id,
          kind,
          name,
          ...(filePath !== undefined ? { filePath } : {}),
        });
        await this.search.onEntityChanged(kind, entity.id);
        await this.persistIdState();
        await this.touch();
      },
    );
  }

  /** Ensure every outgoing reference targets an existing entity (no dangling refs). */
  private async validateReferences(kind: GraphKind, entity: HasId): Promise<void> {
    const edges = outgoingEdges(kind, entity as unknown as Record<string, unknown>);
    if (edges.length === 0) return;
    const existing = await this.graph.existingIds();
    for (const edge of edges) {
      if (edge.toId === entity.id) {
        throw new RepositoryError("invalid_reference", `${entity.id} cannot reference itself.`);
      }
      if (!existing.has(edge.toId)) {
        throw new RepositoryError(
          "invalid_reference",
          `${entity.id}.${edge.field} references ${edge.toId}, which does not exist.`,
          { details: { edge } },
        );
      }
    }
  }

  private async recordEntity(
    entity: Omit<CatalogEntity, "createdAt" | "updatedAt"> & { createdAt?: string },
  ): Promise<void> {
    const now = this.clock();
    const catalog = await readCatalog(this.store);
    const prior = catalog.find((e) => e.id === entity.id);
    const record: CatalogEntity = {
      ...entity,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
    const next = [...catalog.filter((e) => e.id !== entity.id), record].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    await writeCatalog(this.store, next);
  }

  private async reindexAfterUnlink(id: string): Promise<void> {
    const kind = kindOf(id);
    if (kind === null) return;
    const entity = await this.graph.store(kind).get(id);
    if (entity === null) {
      await this.deindexEntity(id);
      this.search.onEntityRemoved(kind, id);
      return;
    }
    await this.recordEntity({
      id,
      kind,
      name: displayName(kind, entity as unknown as Record<string, unknown>),
    });
    await this.search.onEntityChanged(kind, id);
  }

  private async deindexEntity(id: string): Promise<void> {
    const catalog = await readCatalog(this.store);
    await writeCatalog(
      this.store,
      catalog.filter((e) => e.id !== id),
    );
  }

  private async persistIdState(): Promise<void> {
    await this.store.writeFile(
      PATHS.idSequences,
      `${JSON.stringify(this.ids.snapshot(), null, 2)}\n`,
    );
  }

  private async touch(): Promise<void> {
    this.manifest = { ...this.manifest, updatedAt: this.clock() };
    await this.store.writeFile(PATHS.manifest, serialize(this.manifest));
  }
}

function serialize(manifest: ProjectManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function kindOf(id: string): GraphKind | null {
  const kind = entityKindOf(id);
  if (kind === null || kind === "project") return null;
  return kind as GraphKind;
}

/** A human-friendly label for any entity record, per kind. */
function displayName(kind: GraphKind, entity: Record<string, unknown>): string {
  switch (kind) {
    case "chapter":
    case "scene":
      return String(entity.title ?? entity.id);
    case "fact":
      return String(entity.statement ?? entity.id);
    case "relationship":
      return String(entity.type ?? entity.id);
    default:
      return String(entity.name ?? entity.id);
  }
}

async function loadIdGenerator(store: ProjectStore): Promise<SequentialIdGenerator> {
  const raw = await store.readFile(PATHS.idSequences);
  if (raw !== null) {
    try {
      const snapshot = normalizeSequenceSnapshot(JSON.parse(raw));
      return new SequentialIdGenerator(snapshot);
    } catch {
      // fall through to reconstruction
    }
  }
  // Reconstruct from every existing entity id so new IDs never collide.
  const ids = [...(await new EntityGraph(store).existingIds())];
  return SequentialIdGenerator.fromExistingIds(ids);
}

/**
 * Compare a relationship dimension across two boundaries: negative = fell,
 * positive = rose, zero = level, `null` = nothing comparable was recorded.
 * Magnitudes compare with magnitudes and levels with levels — the level bands
 * are deliberately lossy, so the two forms are never mixed in one comparison.
 */
function compareDimension(
  start: DimensionValue | undefined,
  end: DimensionValue | undefined,
): number | null {
  if (end === undefined) return null;
  if (start?.magnitude !== undefined && end.magnitude !== undefined) {
    return Math.sign(end.magnitude - start.magnitude);
  }
  if (start?.level !== undefined && end.level !== undefined) {
    return Math.sign(
      QUALITATIVE_LEVELS.indexOf(end.level) - QUALITATIVE_LEVELS.indexOf(start.level),
    );
  }
  return null;
}

function describeValue(value: DimensionValue | undefined): string {
  if (value === undefined) return "—";
  if (value.magnitude !== undefined) return String(value.magnitude);
  return value.level ?? "—";
}

export { SCHEMA_VERSION, APP_FORMAT_VERSION };
