import type {
  Chapter,
  Character,
  Location,
  PlotThread,
  Project,
  Relationship,
  Scene,
  CharacterId,
  LocationId,
  PlotThreadId,
} from "@jellytind/domain";
import type { SearchHit, SearchQuery } from "@jellytind/search";
import type { AgentActivityEvent } from "./activity";

/**
 * The shape of a build this package needs.
 *
 * Declared structurally rather than imported: `@jellytind/story-compiler` is a
 * sibling, not a dependency, and the runtime only ever reads these fields.
 */
/** The shape of a story test this package reads. */
export interface StoryTestLike {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly enabled: boolean;
  readonly severity: string;
}

/** The shape of a test run this package reads. */
export interface TestRunLike {
  readonly deterministic: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
  };
  readonly semantic: { readonly total: number; readonly notEvaluated: number };
  readonly results: ReadonlyArray<{
    readonly testId: string;
    readonly name: string;
    readonly type: string;
    readonly status: string;
    readonly statement: string;
    readonly failures: ReadonlyArray<{
      readonly sceneId: string;
      readonly expected: string;
      readonly actual: string;
      readonly evidence: string;
    }>;
    readonly reason?: string;
  }>;
}

export interface StoryBuildLike {
  readonly id: string;
  readonly status: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly diagnostics: ReadonlyArray<{
    readonly id: string;
    readonly ruleId: string;
    readonly severity: string;
    readonly message: string;
    readonly entities: readonly string[];
    readonly sceneId?: string;
    readonly evidence: string;
  }>;
}

/**
 * The debugger's request and result shapes, structurally.
 *
 * `@jellytind/story-debugger` is a sibling, not a dependency. The request is
 * left loose because the modes and their fields belong to that package; the
 * tool validates what it can and lets the debugger reject the rest with a
 * message written for the person who asked.
 */
export interface DebugRequestLike {
  readonly mode: string;
  readonly problem?: string;
  readonly [field: string]: unknown;
}

export interface DebugTraceLike {
  readonly mode: string;
  readonly problem: string;
  readonly scope: {
    readonly summary: string;
    readonly systems: readonly string[];
    readonly notInspected: readonly string[];
    readonly sceneIds: readonly string[];
    readonly entityIds: readonly string[];
  };
  readonly evidence: ReadonlyArray<{
    readonly id: string;
    readonly system: string;
    readonly statement: string;
    readonly detail?: string;
    readonly sceneId?: string;
    readonly entities: readonly string[];
  }>;
  readonly measurements: ReadonlyArray<{
    readonly label: string;
    readonly value: number;
    readonly unit: string;
    readonly basis: string;
  }>;
}

/**
 * A refactor request and its analysis, structurally.
 *
 * `@jellytind/story-refactor` sits above the runtime, so the shapes are
 * declared rather than imported. The request is loose: the kinds and their
 * fields belong to that package, which validates them and returns a message
 * written for whoever asked.
 */
export interface RefactorRequestLike {
  readonly kind: string;
  readonly [field: string]: unknown;
}

export interface RefactorAnalysisLike {
  readonly summary: string;
  readonly affected: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly name: string;
    readonly why: string;
    readonly direct: boolean;
  }>;
  readonly counts: Readonly<Record<string, number>>;
  readonly manuscriptReferences: ReadonlyArray<{
    readonly path: string;
    readonly term: string;
    readonly occurrences: number;
    readonly excerpt: string;
  }>;
  readonly risks: ReadonlyArray<{
    readonly level: string;
    readonly summary: string;
    readonly detail: string;
    readonly entities: readonly string[];
    readonly source: string;
  }>;
  readonly highRisk: readonly string[];
}

export interface DebugReportSummaryLike {
  readonly id: string;
  readonly mode: string;
  readonly problem: string;
  readonly createdAt: string;
  readonly evidenceCount: number;
  readonly diagnosed: boolean;
}

export interface DebugReportLike extends DebugTraceLike {
  readonly id: string;
  readonly createdAt: string;
  readonly diagnosis?: {
    readonly statement: string;
    readonly confidence: string;
    readonly uncertainty: readonly string[];
    readonly basis: readonly string[];
    readonly unsupported: readonly string[];
  };
  readonly interventions: ReadonlyArray<{
    readonly kind: string;
    readonly summary: string;
    readonly rationale: string;
  }>;
}

import type { AgentTask } from "./task";

/**
 * The read surface the Phase-7 tools need from a project.
 *
 * Declared here as a port rather than importing `@jellytind/story-repository`
 * so the dependency runs one way: the agent runtime states what it needs, and
 * the repository — which owns the project on disk — satisfies it. Tests can
 * satisfy it with a fixture, and nothing in the runtime can reach past this
 * interface into the filesystem.
 */
export interface ProjectAccess {
  readonly project: Project;

  listProjectFiles(prefix?: string): Promise<string[]>;
  readProjectFile(path: string): Promise<string | null>;
  searchText(query: SearchQuery): Promise<SearchHit[]>;

  getEntity<T = Record<string, unknown>>(id: string): Promise<T | null>;
  listEntitySummaries(): Promise<Array<{ id: string; kind: string; name: string }>>;

  listChapters(): Promise<Chapter[]>;
  listScenes(): Promise<Scene[]>;
  listCharacters(): Promise<Character[]>;
  listLocations(): Promise<Location[]>;
  listPlotThreads(): Promise<PlotThread[]>;
  listRelationships(): Promise<Relationship[]>;

  /**
   * The Story Build, when the project supports it.
   *
   * Optional on the port so the runtime never assumes a compiler is present: a
   * fixture project in a test satisfies `ProjectAccess` without one, and the
   * build tools simply are not registered (docs/STORY_COMPILER.md).
   */
  buildStory?(options?: {
    config?: { options?: { dormantAfterScenes?: number } };
  }): Promise<StoryBuildLike>;
  getBuild?(id: string): Promise<StoryBuildLike | null>;
  getLatestBuild?(): Promise<StoryBuildLike | null>;

  /** The writer's own assertions, and running them. */
  listStoryTests?(): Promise<StoryTestLike[]>;
  runStoryTests?(): Promise<TestRunLike>;

  /**
   * The Story Debugger's deterministic trace, and the reports it has produced.
   *
   * Only the trace is exposed. Interpreting evidence is what an agent is *for*
   * — routing it through a second model call would put an opinion between the
   * agent and the record (docs/STORY_DEBUGGER.md).
   */
  traceStoryProblem?(request: DebugRequestLike): Promise<DebugTraceLike>;

  /**
   * What a structural change would reach. **Analysis only** — there is
   * deliberately no port method that stages or applies one
   * (docs/STORY_REFACTOR.md).
   */
  analyseStoryRefactor?(request: RefactorRequestLike): Promise<RefactorAnalysisLike>;
  listDebugReports?(limit?: number): Promise<DebugReportSummaryLike[]>;
  getDebugReport?(id: string): Promise<DebugReportLike | null>;

  getScenesByCharacter(id: CharacterId): Promise<Scene[]>;
  getScenesByLocation(id: LocationId): Promise<Scene[]>;
  getScenesByPlotThread(id: PlotThreadId): Promise<Scene[]>;
}

/**
 * Persistence for tasks and activity. Implemented by the Story Repository under
 * `.writer/agents/`, so a task survives closing the app and is not lost with a
 * chat transcript.
 */
export interface AgentStore {
  listTasks(): Promise<AgentTask[]>;
  getTask(id: string): Promise<AgentTask | null>;
  /** Insert or replace a task. Returns the stored record. */
  saveTask(task: AgentTask): Promise<AgentTask>;
  /** Allocate the next task id, e.g. `TASK_0007`. */
  nextTaskId(): Promise<string>;

  appendActivity(event: Omit<AgentActivityEvent, "id">): Promise<AgentActivityEvent>;
  listActivity(taskId?: string): Promise<AgentActivityEvent[]>;
}
