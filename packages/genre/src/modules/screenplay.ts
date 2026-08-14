import type { DiagnosticDraft } from "@jellytind/story-compiler";
import type { GenreModule } from "../types";
import {
  about,
  choice,
  field,
  kind,
  longText,
  moduleRule,
  recordsOf,
  template,
  text,
  valueOf,
} from "./shared";

/**
 * The Screenplay module — the domain extensions, and not the tooling.
 *
 * The brief says to prepare the domain and stop there, and stopping there is
 * the right call: a screenplay's *format* is a rendering problem — Fountain,
 * Final Draft, page-count estimation, dual dialogue — and none of it belongs in
 * the story model. What belongs in the story model is the handful of things a
 * screenplay knows that a novel does not: that a scene happens inside or
 * outside, at a time of day, in a named place, and runs about so long.
 *
 * Everything else is already here. A screenplay's scenes are scenes; its
 * characters are characters; its locations are locations. A heading attaches to
 * a scene rather than replacing it, which is what lets the build catch a
 * heading that has drifted from the scene it describes (docs/GENRE_MODULES.md).
 */

const MODULE = "screenplay" as const;

const heading = kind(MODULE, {
  id: "scene_heading",
  label: "Scene heading",
  plural: "Scene headings",
  description: "The slug line: inside or out, where, and when.",
  attachesTo: ["scene"],
  fields: [
    choice("int_ext", "INT/EXT", ["INT", "EXT", "INT/EXT", "I/E"], { required: true }),
    field({
      key: "location",
      label: "Location",
      type: "entity",
      entityKind: "location",
      required: true,
      description: "The project's own location. The slug is rendered from it, not typed twice.",
    }),
    choice("time_of_day", "Time of day", [
      "DAY",
      "NIGHT",
      "DAWN",
      "DUSK",
      "MORNING",
      "AFTERNOON",
      "EVENING",
      "CONTINUOUS",
      "LATER",
    ]),
    text("estimated_duration", "Estimated duration", {
      description: "In pages or minutes, in your own notation. Nothing computes from it yet.",
    }),
    longText("production_notes", "Production notes"),
  ],
});

const unit = kind(MODULE, {
  id: "production_unit",
  label: "Production note",
  plural: "Production notes",
  description: "A standing note about a location, a cast member or a piece of the shoot.",
  attachesTo: ["location", "character", "object"],
  fields: [
    choice("area", "Area", ["cast", "location", "wardrobe", "props", "vfx", "stunts", "sound"]),
    longText("note", "Note", { required: true }),
    choice("status", "Status", ["open", "resolved", "blocked"]),
  ],
});

/**
 * A slug line that has drifted from its scene.
 *
 * Exactly the failure this module exists to prevent, and it is deterministic:
 * the heading names a location, the scene records a location, and either they
 * agree or they do not. A writer who moves a scene and forgets the slug line
 * finds out here rather than in a table read.
 */
const headingContradictsScene = moduleRule({
  id: "screenplay_heading_mismatch",
  name: "Heading disagrees with its scene",
  category: "referential_integrity",
  description: "A scene heading names the same location the scene itself records.",
  inputs: ["scenes"],
  run(context) {
    const sceneById = new Map(context.scenes.map((scene) => [scene.id as string, scene]));
    const out: DiagnosticDraft[] = [];

    for (const record of recordsOf(context, MODULE, "scene_heading")) {
      const sceneId = record.attachedTo.map(String)[0];
      if (sceneId === undefined) continue;
      const scene = sceneById.get(sceneId);
      const declared = valueOf(record, "location");
      const actual = scene?.locationId as string | undefined;
      // A scene with no location recorded is an ordinary work in progress and
      // makes no claim for the heading to contradict.
      if (scene === undefined || actual === undefined || declared === "" || declared === actual) {
        continue;
      }

      out.push(
        about(record, {
          severity: "warning",
          message: `The heading for "${scene.title}" says ${declared}, and the scene is set at ${actual}.`,
          sceneId,
          evidence: `heading.location: ${declared}; scene.locationId: ${actual}`,
          suggestedAction:
            "Move the scene, or correct the slug line. One of the two is out of date.",
          key: "location_mismatch",
        }),
      );
    }
    return out;
  },
});

/** A scene with no heading at all — every screenplay scene needs one. */
const sceneWithoutHeading = moduleRule({
  id: "screenplay_scene_without_heading",
  name: "Scene without a heading",
  category: "referential_integrity",
  description: "Every scene carries a slug line.",
  inputs: ["scenes"],
  run(context) {
    const withHeading = new Set(
      recordsOf(context, MODULE, "scene_heading").flatMap((record) =>
        record.attachedTo.map(String),
      ),
    );
    // Only worth saying once the writer has started: a project with no headings
    // at all has not begun rather than gone wrong.
    if (withHeading.size === 0) return [];

    return context.scenes
      .filter((scene) => !withHeading.has(scene.id as string))
      .map((scene) => ({
        severity: "info" as const,
        message: `"${scene.title}" has no scene heading.`,
        entities: [scene.id as string],
        sceneId: scene.id as string,
        evidence: `${String(withHeading.size)} of ${String(context.scenes.length)} scenes have headings`,
        suggestedAction: "Add INT/EXT, the location and the time of day.",
        key: "no_heading",
      }));
  },
});

export const SCREENPLAY_MODULE: GenreModule = {
  id: "screenplay",
  name: "Screenplay",
  maturity: "structured",
  summary: "Scene headings and production notes, over the same scenes and characters.",
  description:
    "Domain extensions only: INT/EXT, location, time of day, estimated duration and production notes, attached to the project's own scenes. Formatting and production tooling are deliberately not here yet.",

  extensionKinds: [heading, unit],
  views: [],
  rules: [headingContradictsScene, sceneWithoutHeading],

  testTemplates: [
    template({
      id: "screenplay_show_dont_tell",
      name: "Nothing should be interior that cannot be filmed",
      rationale:
        "The one adaptation habit that survives every draft, and no rule can see it — but a reader can.",
      statement: "No scene should depend on a character's unspoken thoughts to be understood.",
      severity: "error",
    }),
    template({
      id: "screenplay_scene_length",
      name: "Scenes should earn their length",
      rationale: "Estimated durations are recorded but nothing computes from them yet.",
      statement: "No scene should run longer than what happens in it justifies.",
    }),
  ],

  commands: [],

  metadata: [
    {
      key: "format",
      label: "Format",
      type: "choice",
      choices: ["feature", "television", "short", "pilot"],
    },
    { key: "target_length", label: "Target length", type: "text", description: "In pages." },
  ],

  agents: ["scene_director", "dialogue_editor"],
  // No skill of its own yet: the core passes serve this genre unchanged.
  skills: [],
  recipes: ["scene_inspection"],
};
