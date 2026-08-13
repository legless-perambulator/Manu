import { orderScenes } from "@jellytind/domain";
import type { ExtensionRecord } from "@jellytind/domain";
import type { BuildContext, DiagnosticDraft } from "@jellytind/story-compiler";
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
  valueOf,
} from "./shared";

/**
 * The Romance module — beats on top of Relationship State.
 *
 * The relationship between two characters is already modelled: it has a status
 * that changes at recorded scenes, and the timeline can reconstruct it at any
 * point in the book (docs/RELATIONSHIP_STATE.md). A romance does not need a
 * second version of that. What it needs is a name for the *shape* the writer
 * intends — attraction, intimacy, conflict, separation, reconciliation — laid
 * over the state changes that are already there.
 *
 * So a beat attaches to a relationship and names a scene, and everything about
 * where the characters actually stand at that scene comes from the engine that
 * already knows (docs/GENRE_MODULES.md).
 */

const MODULE = "romance" as const;

export const BEAT_TYPES = [
  "attraction",
  "intimacy",
  "conflict",
  "separation",
  "reconciliation",
  "commitment",
] as const;

const beat = kind(MODULE, {
  id: "relationship_beat",
  label: "Beat",
  plural: "Relationship beats",
  description:
    "One movement in a relationship, laid over the relationship state the project already tracks.",
  attachesTo: ["relationship"],
  fields: [
    choice("beat", "Beat", [...BEAT_TYPES], { required: true }),
    field({
      key: "scene",
      label: "Scene",
      type: "entity",
      entityKind: "scene",
      required: true,
      description: "Where it happens. The beat is placed in the book by this, and only this.",
    }),
    choice("intensity", "Intensity", ["quiet", "marked", "decisive"], {
      description: "A band, in your terms. Not a score.",
    }),
    longText("what_changes", "What changes"),
    longText("what_it_costs", "What it costs them"),
  ],
});

const progression = kind(MODULE, {
  id: "attraction_arc",
  label: "Arc",
  plural: "Attraction arcs",
  description:
    "The shape you intend one relationship to take, stated so the beats can be read against it.",
  attachesTo: ["relationship"],
  fields: [
    choice("shape", "Shape", [
      "slow-burn",
      "instant",
      "enemies-to-lovers",
      "second-chance",
      "unrequited",
    ]),
    longText("obstacle", "What keeps them apart", { required: true }),
    longText("resolution", "How it resolves"),
  ],
});

/** Beats in manuscript order, with the ones that name no known scene dropped. */
function placedBeats(context: BuildContext): Array<{ record: ExtensionRecord; position: number }> {
  const order = new Map(
    orderScenes(context.scenes, context.chapters).map((scene, at) => [scene.id as string, at + 1]),
  );
  return recordsOf(context, MODULE, "relationship_beat")
    .map((record) => ({ record, position: order.get(valueOf(record, "scene")) ?? -1 }))
    .filter((entry) => entry.position > 0)
    .sort((a, b) => a.position - b.position);
}

/**
 * Reconciliation with nothing to reconcile.
 *
 * The most common structural mistake in a romance draft, and a genuinely
 * deterministic one: the beats are recorded, the scenes are ordered, and either
 * something came before this or it did not. It says nothing about whether the
 * scene is any good.
 */
const reconciliationWithoutSeparation = moduleRule({
  id: "romance_reconciliation_without_break",
  name: "Reconciliation without a break",
  category: "plot_threads",
  description: "A reconciliation beat follows a separation or a conflict in the same relationship.",
  inputs: ["scenes"],
  run(context) {
    const beats = placedBeats(context);
    const out: DiagnosticDraft[] = [];

    for (const entry of beats) {
      if (valueOf(entry.record, "beat") !== "reconciliation") continue;
      const relationships = entry.record.attachedTo.map(String);

      const broke = beats.some(
        (earlier) =>
          earlier.position < entry.position &&
          ["separation", "conflict"].includes(valueOf(earlier.record, "beat")) &&
          earlier.record.attachedTo.map(String).some((id) => relationships.includes(id)),
      );
      if (broke) continue;

      out.push(
        about(entry.record, {
          severity: "warning",
          message: `"${entry.record.name}" reconciles a relationship that the project never records breaking.`,
          sceneId: valueOf(entry.record, "scene"),
          evidence: `Beat at scene ${String(entry.position)}; no separation or conflict beat recorded earlier for this relationship.`,
          suggestedAction:
            "Record the break, or make this beat something other than a reconciliation.",
          key: "no_break",
        }),
      );
    }
    return out;
  },
});

/** An arc whose obstacle never appears as a conflict anywhere in the book. */
const obstacleWithoutConflict = moduleRule({
  id: "romance_obstacle_untested",
  name: "Obstacle never tested",
  category: "plot_threads",
  description: "The thing keeping them apart shows up as a beat at least once.",
  inputs: ["scenes"],
  run(context) {
    const beats = placedBeats(context);
    return recordsOf(context, MODULE, "attraction_arc")
      .filter((arc) => {
        const relationships = arc.attachedTo.map(String);
        return !beats.some(
          (entry) =>
            ["conflict", "separation"].includes(valueOf(entry.record, "beat")) &&
            entry.record.attachedTo.map(String).some((id) => relationships.includes(id)),
        );
      })
      .map((arc) =>
        about(arc, {
          severity: "info",
          message: `"${arc.name}" records an obstacle, and no beat ever tests it.`,
          evidence: `obstacle: ${valueOf(arc, "obstacle")}; no conflict or separation beat on this relationship`,
          suggestedAction: "Record the scene where the obstacle actually costs them something.",
          key: "untested",
        }),
      );
  },
});

export const ROMANCE_MODULE: GenreModule = {
  id: "romance",
  name: "Romance",
  summary: "The shape of a relationship, laid over the relationship state already being tracked.",
  description:
    "Beats — attraction, intimacy, conflict, separation, reconciliation, commitment — placed at scenes and attached to relationships. The build checks that a reconciliation has something to reconcile and that a stated obstacle is tested somewhere.",

  extensionKinds: [beat, progression],
  views: [],
  rules: [reconciliationWithoutSeparation, obstacleWithoutConflict],

  testTemplates: [
    template({
      id: "romance_pace",
      name: "The romance should keep the pace you intended",
      rationale:
        "Whether a slow burn is slow is a reading, not a measurement — but it is exactly the reading a reader simulation can give.",
      statement:
        "The relationship should progress at the pace recorded in its arc, without a chapter that skips a stage.",
    }),
    template({
      id: "romance_both_want_something",
      name: "Both of them should want something of their own",
      rationale:
        "The failure mode of a romance subplot is one character with an arc and one without.",
      statement:
        "Each person in the central relationship should want something that is not simply the other person.",
    }),
  ],

  commands: [],

  metadata: [
    {
      key: "heat",
      label: "Heat",
      type: "choice",
      choices: ["closed door", "warm", "explicit"],
      description: "Informational, and useful when a draft drifts from what you meant to write.",
    },
    {
      key: "hea",
      label: "Ending",
      type: "choice",
      choices: ["HEA", "HFN", "bittersweet", "tragic"],
    },
  ],

  agents: ["character_editor", "developmental_editor"],
  // No skill of its own yet: the core passes serve this genre unchanged.
  skills: [],
  recipes: [],
};
