import type { ContextPackage, ContextSectionName } from "./types";

/**
 * Turn a compiled package into the text a model call receives.
 *
 * This is the last mile of the subsystem's purpose: an operation never
 * hand-assembles a prompt from project files, it compiles a package and renders
 * it. The rendering is a pure function of the package, so what the inspector
 * shows and what the model reads cannot drift apart.
 */

const HEADINGS: Readonly<Record<ContextSectionName, string>> = {
  task: "TASK",
  target: "TARGET",
  primaryText: "PRIMARY TEXT",
  adjacentScenes: "ADJACENT SCENES",
  characters: "CHARACTERS",
  locations: "LOCATIONS",
  plotThreads: "PLOT THREADS",
  storyState: "STORY STATE",
  styleRules: "STYLE",
  worldRules: "WORLD RULES",
  research: "RESEARCH (REAL-WORLD REFERENCE, NOT STORY CANON)",
  additionalRetrievedContext: "ADDITIONAL CONTEXT",
};

export interface PresentOptions {
  /**
   * Annotate each element with why it was included. On by default: the model
   * benefits from knowing an element is "the scene immediately before" rather
   * than guessing, and it keeps rendered context self-describing.
   */
  readonly includeProvenance?: boolean;
}

export function renderContextPackage(pkg: ContextPackage, options: PresentOptions = {}): string {
  const withProvenance = options.includeProvenance ?? true;
  const blocks: string[] = [];

  for (const section of pkg.sections) {
    const lines: string[] = [`## ${HEADINGS[section.name]}`];
    for (const item of section.items) {
      if (section.name !== "task" && withProvenance) {
        lines.push(`### ${item.id} — ${item.label} [${item.provenance.reason}]`);
      }
      lines.push(item.text);
    }
    blocks.push(lines.join("\n"));
  }

  const omitted = pkg.metadata.notes.filter((n) => n.disposition !== "summary");
  if (pkg.metadata.notes.length > 0) {
    // State what is missing inside the context itself, so the model is never
    // led to believe it received the whole picture.
    const summarised = pkg.metadata.notes.length - omitted.length;
    const parts = [
      summarised > 0 ? `${String(summarised)} element(s) included as summaries` : null,
      omitted.length > 0
        ? `${String(omitted.length)} element(s) omitted or reduced to a reference`
        : null,
    ].filter((p): p is string => p !== null);
    blocks.push(
      `## CONTEXT NOTES\nThis context was assembled under a token budget: ${parts.join(
        "; ",
      )}. Treat absent detail as unknown, not as absent from the project.`,
    );
  }

  return blocks.join("\n\n");
}
