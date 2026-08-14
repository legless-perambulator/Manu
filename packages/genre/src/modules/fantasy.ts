import type { DiagnosticDraft } from "@jellytind/story-compiler";
import type { GenreModule } from "../types";
import {
  about,
  choice,
  kind,
  list,
  longText,
  moduleRule,
  recordsOf,
  template,
  text,
  valueOf,
} from "./shared";

/**
 * The Fantasy module — schema, and no more than schema.
 *
 * The brief is explicit that this is not the phase to build a worldbuilding
 * application, and the restraint is not reluctance. Ten well-shaped record
 * types that the timeline, the search index, the entity graph and the context
 * compiler can all already read are worth more than a bespoke map editor that
 * only one panel understands. When a fantasy writer wants a genealogy view or a
 * language tool, it is built on records that already exist rather than on a
 * schema invented at the same time (docs/GENRE_MODULES.md).
 *
 * Note what is *not* here: no second timeline, no second map, no parallel
 * knowledge model. Historical eras sit on the Timeline Engine's story time,
 * geography attaches to locations the project already has, and a species is a
 * record about characters who are ordinary characters.
 */

const MODULE = "fantasy" as const;

const culture = kind(MODULE, {
  id: "culture",
  label: "Culture",
  plural: "Cultures",
  description: "A people and how they live: what they value, how they mark status, what they fear.",
  attachesTo: ["location", "character"],
  fields: [
    longText("values", "What they value"),
    text("social_structure", "Social structure"),
    list("customs", "Customs"),
    list("taboos", "Taboos"),
    text("language", "Language"),
  ],
});

const species = kind(MODULE, {
  id: "species",
  label: "Species",
  plural: "Species",
  description: "A kind of person or creature, and what is true of them that is not true of others.",
  attachesTo: ["character"],
  fields: [
    longText("traits", "Distinguishing traits"),
    text("lifespan", "Lifespan"),
    list("abilities", "Abilities"),
    list("limits", "Limits"),
  ],
});

const faction = kind(MODULE, {
  id: "faction",
  label: "Faction",
  plural: "Factions",
  description: "An organised interest: who they are, what they want, and who stands in the way.",
  attachesTo: ["character", "location"],
  fields: [
    longText("goal", "What they want", { required: true }),
    text("leader", "Led by"),
    list("allies", "Allies"),
    list("enemies", "Enemies"),
    choice("reach", "Reach", ["local", "regional", "continental", "world"]),
  ],
});

const religion = kind(MODULE, {
  id: "religion",
  label: "Religion",
  plural: "Religions",
  description: "What is worshipped, by whom, and what it asks of them.",
  attachesTo: ["character", "location"],
  fields: [
    longText("beliefs", "Beliefs"),
    list("practices", "Practices"),
    text("clergy", "Clergy"),
    list("holy_places", "Holy places"),
  ],
});

const magicSystem = kind(MODULE, {
  id: "magic_system",
  label: "Magic system",
  plural: "Magic systems",
  description: "How the impossible works here — and, more importantly, what it costs.",
  fields: [
    longText("how_it_works", "How it works", { required: true }),
    longText("cost", "What it costs", {
      description: "What using it takes from the user. A system with no cost has no stakes.",
    }),
    list("limits", "Hard limits"),
    text("who_can_use_it", "Who can use it"),
    choice("visibility", "Known to the world", ["common", "rumoured", "hidden", "forbidden"]),
  ],
});

const artefact = kind(MODULE, {
  id: "artefact",
  label: "Artefact",
  plural: "Artefacts",
  description: "A thing of power. Attach it to the object the manuscript actually tracks.",
  attachesTo: ["object"],
  fields: [
    longText("power", "What it does", { required: true }),
    longText("cost", "What it costs"),
    text("origin", "Origin"),
    text("bearer", "Current bearer"),
  ],
});

const genealogy = kind(MODULE, {
  id: "genealogy",
  label: "Bloodline",
  plural: "Genealogies",
  description: "Descent: a house, a line, who came from whom.",
  attachesTo: ["character"],
  fields: [
    text("house", "House or line"),
    list("ancestors", "Ancestors"),
    list("descendants", "Descendants"),
    longText("inheritance", "What is inherited"),
  ],
});

const era = kind(MODULE, {
  id: "historical_era",
  label: "Era",
  plural: "Historical eras",
  description:
    "A named age of the world's history, sitting on the same story time as everything else.",
  fields: [
    text("began", "Began"),
    text("ended", "Ended"),
    longText("what_changed", "What changed"),
    list("key_events", "Key events"),
  ],
});

const language = kind(MODULE, {
  id: "language",
  label: "Language",
  plural: "Languages",
  description: "A tongue, who speaks it, and enough of it to stay consistent.",
  fields: [
    text("spoken_by", "Spoken by"),
    text("script", "Script"),
    list("phrases", "Phrases"),
    longText("notes", "Sound and feel"),
  ],
});

const geography = kind(MODULE, {
  id: "geography",
  label: "Region",
  plural: "Geography",
  description: "A region of the world. Attach it to the locations that sit inside it.",
  attachesTo: ["location"],
  fields: [
    text("terrain", "Terrain"),
    text("climate", "Climate"),
    list("borders", "Borders"),
    longText("travel", "Getting there"),
  ],
});

/**
 * A magic system with no cost.
 *
 * The one deterministic thing worth saying about a magic system, and it is not
 * a matter of taste: a system whose cost is unrecorded is one the writer has
 * not yet decided, and it will be decided in the middle of a scene that needs
 * it not to be. Reported as a warning, because recording it later is fine.
 */
const magicWithoutCost = moduleRule({
  id: "fantasy_magic_without_cost",
  name: "Magic without cost",
  category: "project_rules",
  description: "A magic system records what it does and what it takes.",
  run(context) {
    return recordsOf(context, MODULE, "magic_system")
      .filter((record) => valueOf(record, "cost") === "" && valueOf(record, "limits") === "")
      .map((record) =>
        about(record, {
          severity: "warning",
          message: `The magic system "${record.name}" records no cost and no limits.`,
          evidence: `${record.id as string}: how_it_works recorded, cost empty, limits empty`,
          suggestedAction:
            "Record what it takes from the user, or what it cannot do. Magic without either has no stakes.",
          key: "no_cost",
        }),
      );
  },
});

/** An artefact nobody can pick up: a record of power attached to no object. */
const artefactWithoutObject = moduleRule({
  id: "fantasy_artefact_without_object",
  name: "Artefact without an object",
  category: "referential_integrity",
  description: "An artefact is attached to the object the manuscript tracks.",
  run(context) {
    const out: DiagnosticDraft[] = [];
    for (const record of recordsOf(context, MODULE, "artefact")) {
      if (record.attachedTo.length > 0) continue;
      out.push(
        about(record, {
          severity: "info",
          message: `The artefact "${record.name}" is not attached to any object.`,
          evidence: `${record.id as string}: attachedTo is empty`,
          suggestedAction:
            "Attach it to the object, so its location and its bearer are tracked like anything else.",
          key: "unattached",
        }),
      );
    }
    return out;
  },
});

export const FANTASY_MODULE: GenreModule = {
  id: "fantasy",
  name: "Fantasy",
  maturity: "structured",
  summary: "Somewhere to put the world, wired to the story rather than beside it.",
  description:
    "Schema support for cultures, species, factions, religions, magic systems, artefacts, genealogies, historical eras, languages and geography. Records attach to the characters, locations and objects the manuscript already tracks — there is no second world model.",

  extensionKinds: [
    culture,
    species,
    faction,
    religion,
    magicSystem,
    artefact,
    genealogy,
    era,
    language,
    geography,
  ],

  views: [],
  rules: [magicWithoutCost, artefactWithoutObject],

  testTemplates: [
    template({
      id: "fantasy_magic_consistent",
      name: "Magic should obey its own rules",
      rationale:
        "The recorded limits are checkable by eye and not by machine: whether a scene quietly exceeds them is a reading.",
      statement:
        "No scene should let a magic system do something its recorded limits forbid, without the story acknowledging the cost.",
      severity: "error",
    }),
    template({
      id: "fantasy_exposition_load",
      name: "The world should arrive through the story",
      rationale: "The commonest failure of a well-built world is that it gets explained.",
      statement:
        "World material should reach the reader through scenes that need it, not through passages that stop to describe it.",
    }),
  ],

  commands: [],

  metadata: [
    {
      key: "world_name",
      label: "World",
      type: "text",
      description: "What the world is called, where that is not simply Earth.",
    },
    {
      key: "magic_prevalence",
      label: "Magic in daily life",
      type: "choice",
      choices: ["absent", "rare", "known", "everywhere"],
    },
  ],

  agents: ["story_architect", "continuity_editor"],
  // No skill of its own yet: the core passes serve this genre unchanged.
  skills: [],
  recipes: [],
};
