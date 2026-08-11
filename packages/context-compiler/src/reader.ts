import type {
  Chapter,
  Character,
  Fact,
  Location,
  PlotThread,
  Project,
  Relationship,
  Scene,
  WorldRule,
} from "@jellytind/domain";
import type { SearchHit, SearchQuery } from "@jellytind/search";
import type { StateTransition } from "@jellytind/story-state";

/**
 * The read surface the Context Compiler needs from a project.
 *
 * Declared here as a port rather than importing the Story Repository, so the
 * dependency runs one way and tests can compile against a fixture project. The
 * repository satisfies it structurally.
 *
 * It is deliberately a *different, smaller* interface from the agent runtime's
 * `ProjectAccess`: each consumer states exactly what it needs, so neither can
 * quietly grow the other's reach.
 */
export interface ProjectReader {
  readonly project: Project;

  listChapters(): Promise<Chapter[]>;
  listScenes(): Promise<Scene[]>;
  listCharacters(): Promise<Character[]>;
  listLocations(): Promise<Location[]>;
  listPlotThreads(): Promise<PlotThread[]>;
  listWorldRules(): Promise<WorldRule[]>;
  listFacts(): Promise<Fact[]>;
  listRelationships(): Promise<Relationship[]>;

  /**
   * Scene-anchored story-state transitions. Recipes reconstruct state at the
   * target's boundary rather than being handed a "current" snapshot
   * (docs/STORY_STATE.md).
   */
  listStateTransitions(): Promise<StateTransition[]>;

  listProjectFiles(prefix?: string): Promise<string[]>;
  readProjectFile(path: string): Promise<string | null>;
  searchText(query: SearchQuery): Promise<SearchHit[]>;
}
