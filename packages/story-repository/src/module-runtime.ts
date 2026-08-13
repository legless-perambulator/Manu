import type { ModuleBuildInput, StoryCompilerRule } from "@jellytind/story-compiler";

/**
 * What the repository needs from the genre framework, and nothing more.
 *
 * A narrow port declared by the consumer, like `ProjectAccess` and
 * `DebugReader` before it. The repository owns which modules are enabled and
 * what records they hold; it does **not** know what a module is for, which
 * rules one contributes, or that "mystery" and "fantasy" are words. Attaching a
 * runtime is what makes a build see module rules — leave it unattached and
 * everything still works, with the core rules alone (docs/GENRE_MODULES.md).
 *
 * The dependency runs the right way round: `@jellytind/genre` depends on the
 * repository, and the repository depends on this interface, which it wrote.
 */
export interface ModuleRuntime {
  /** The compiler rules the enabled modules contribute. */
  rulesFor(enabled: readonly string[]): readonly StoryCompilerRule[];
  /**
   * Each enabled module's own build input, keyed by module id.
   *
   * Given a reader rather than the repository itself so a module cannot write
   * to the project while a build is gathering its inputs.
   */
  collect(enabled: readonly string[], reader: unknown): Promise<ModuleBuildInput["data"]>;
}
