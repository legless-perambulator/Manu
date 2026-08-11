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
