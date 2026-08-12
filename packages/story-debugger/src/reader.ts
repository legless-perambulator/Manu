import type {
  Chapter,
  Character,
  Fact,
  Location,
  PlotThread,
  Relationship,
  Scene,
  Setup,
  StoryObject,
} from "@jellytind/domain";
import type { StoryBuild } from "@jellytind/story-compiler";
import type { StateTransition } from "@jellytind/story-state";

/**
 * The read surface the debugger needs from a project.
 *
 * A port rather than an import of the Story Repository, for the same reason the
 * Context Compiler declares `ProjectReader` and the agent runtime declares
 * `ProjectAccess`: each consumer states exactly what it needs, the dependency
 * runs one way, and a fixture can satisfy it with no filesystem. The repository
 * satisfies this structurally.
 *
 * Note what is *not* here: nothing that writes. The debugger diagnoses.
 */
export interface DebugReader {
  listChapters(): Promise<Chapter[]>;
  listScenes(): Promise<Scene[]>;
  listCharacters(): Promise<Character[]>;
  listLocations(): Promise<Location[]>;
  listObjects(): Promise<StoryObject[]>;
  listPlotThreads(): Promise<PlotThread[]>;
  listFacts(): Promise<Fact[]>;
  listRelationships(): Promise<Relationship[]>;
  listSetups(): Promise<Setup[]>;
  listStateTransitions(): Promise<StateTransition[]>;

  /** Chapter prose, for the excerpts a diagnosis is allowed to reason about. */
  readProjectFile(path: string): Promise<string | null>;

  /**
   * The most recent build, when there is one. Optional: a project that has
   * never been built is still debuggable — continuity debugging simply has
   * nothing to start from, and says so.
   */
  getLatestBuild?(): Promise<StoryBuild | null>;
  getBuild?(id: string): Promise<StoryBuild | null>;
}
