import { GenreError, type ModuleId } from "./types";
import { hasModule } from "./registry";

/**
 * What New Project offers.
 *
 * A template is a **starting configuration**, and the distinction carries the
 * whole design. Choosing "Mystery" does not make a project a mystery project;
 * it switches the mystery module on. The next morning the writer can switch it
 * off and fantasy on, and nothing about the manuscript, the timeline or the
 * revision history notices. There is no project *type* anywhere in this
 * codebase to be stuck with (docs/GENRE_MODULES.md).
 *
 * "Blank Project" exists for the same reason: a writer who wants none of this
 * should be able to have none of it, and get the whole core anyway.
 */
export interface ProjectTemplate {
  readonly id: string;
  readonly name: string;
  /** One line about what choosing it does — in what it gives, not in jargon. */
  readonly summary: string;
  readonly modules: readonly ModuleId[];
  /** Chapters to scaffold, when the shape is part of the offer. */
  readonly chapters?: number;
}

export const TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: "novel",
    name: "Novel",
    summary: "The full core and no genre modules. Everything Manu does for any long fiction.",
    modules: [],
  },
  {
    id: "mystery",
    name: "Mystery",
    summary: "Adds the clue board, deduction chains and a fairness audit that runs on every build.",
    modules: ["mystery"],
  },
  {
    id: "fantasy",
    name: "Fantasy",
    summary:
      "Adds cultures, species, factions, religions, magic systems, artefacts, genealogies, eras, languages and geography.",
    modules: ["fantasy"],
  },
  {
    id: "romance",
    name: "Romance",
    summary: "Adds relationship beats over the relationship state Manu already tracks.",
    modules: ["romance"],
  },
  {
    id: "thriller",
    name: "Thriller",
    summary: "Adds threats, deadlines, pursuits, resources and information asymmetry.",
    modules: ["thriller"],
  },
  {
    id: "screenplay",
    name: "Screenplay",
    summary: "Adds scene headings — INT/EXT, location, time of day — and production notes.",
    modules: ["screenplay"],
  },
  {
    id: "short_story",
    name: "Short Story",
    summary:
      "The core, scaffolded as a single chapter. Nothing is missing; there is simply less of it.",
    modules: [],
    chapters: 1,
  },
  {
    id: "blank",
    name: "Blank Project",
    summary: "Nothing scaffolded and nothing switched on. Build it up as you go.",
    modules: [],
  },
];

const BY_ID = new Map(TEMPLATES.map((template) => [template.id, template]));

export function templateById(id: string): ProjectTemplate {
  const found = BY_ID.get(id);
  if (found === undefined) {
    throw new GenreError("unknown_template", `No project template called "${id}".`, {
      details: { template: id },
    });
  }
  return found;
}

// A template naming a module that does not exist would silently create a
// project with a setting nothing honours.
for (const template of TEMPLATES) {
  for (const moduleId of template.modules) {
    if (!hasModule(moduleId)) {
      throw new GenreError(
        "unknown_template",
        `Template "${template.id}" names the module "${moduleId}", which is not registered.`,
      );
    }
  }
}
