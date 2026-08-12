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
