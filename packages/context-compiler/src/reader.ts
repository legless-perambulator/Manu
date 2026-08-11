import type {
  Chapter,
  Character,
  Location,
  PlotThread,
  Project,
  Relationship,
  Scene,
  WorldRule,
} from "@jellytind/domain";
import type { SearchHit, SearchQuery } from "@jellytind/search";

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
  listRelationships(): Promise<Relationship[]>;

  listProjectFiles(prefix?: string): Promise<string[]>;
  readProjectFile(path: string): Promise<string | null>;
  searchText(query: SearchQuery): Promise<SearchHit[]>;
}
