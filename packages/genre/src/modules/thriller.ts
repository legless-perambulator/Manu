import { orderScenes } from "@jellytind/domain";
import type { GenreModule } from "../types";
import {
  about,
  choice,
  field,
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
 * The Thriller module — pressure, made checkable.
 *
 * A thriller runs on things the project can actually hold: a threat that is
 * present or is not, a deadline that falls at a scene or never falls, who knows
 * what and when. The last of those is the knowledge model, which Manu already
 * has (docs/KNOWLEDGE.md) — so information asymmetry here is a record *about*
 * facts the project already tracks, not a second knowledge system
 * (docs/GENRE_MODULES.md).
 */

const MODULE = "thriller" as const;

const threat = kind(MODULE, {
  id: "threat",
  label: "Threat",
  plural: "Threats",
  description: "What is going to happen if nobody stops it.",
  attachesTo: ["character", "location", "plot_thread"],
  fields: [
    longText("consequence", "What happens if it lands", { required: true }),
    text("source", "Who or what is behind it"),
    choice("scale", "Scale", ["personal", "local", "national", "global"]),
    choice("visibility", "Known to", ["nobody", "the reader only", "the protagonist", "everyone"]),
  ],
});

const deadline = kind(MODULE, {
  id: "deadline",
  label: "Deadline",
  plural: "Deadlines",
  description: "The clock. When it runs out, and what happens then.",
  attachesTo: ["plot_thread", "character"],
  fields: [
    longText("consequence", "What happens when it expires", { required: true }),
    field({
      key: "expires_at",
      label: "Expires at",
      type: "entity",
      entityKind: "scene",
      description: "The scene where the clock runs out — or is beaten.",
    }),
    text("stated_at", "First stated"),
    choice("outcome", "Outcome", ["met", "missed", "extended", "undecided"]),
  ],
});

const pursuit = kind(MODULE, {
  id: "pursuit",
  label: "Pursuit",
  plural: "Pursuits",
  description: "Who is chasing whom, and how close they are.",
  attachesTo: ["character"],
  fields: [
    text("pursuer", "Pursuer", { required: true }),
    text("quarry", "Quarry", { required: true }),
    choice("proximity", "How close", ["distant", "closing", "immediate"]),
    longText("what_gives_them_away", "What gives the quarry away"),
  ],
});

const operation = kind(MODULE, {
  id: "operation",
  label: "Operation",
  plural: "Operational timeline",
  description:
    "A planned sequence with steps and times — the plan as the characters hold it, which is not the same as what happens.",
  attachesTo: ["plot_thread"],
  fields: [
    list("steps", "Steps", { required: true }),
    text("window", "Window"),
    text("run_by", "Run by"),
    longText("what_goes_wrong", "What goes wrong"),
  ],
});

const resource = kind(MODULE, {
  id: "resource",
  label: "Resource",
  plural: "Resources",
  description: "What they have to work with, and what happens as it runs out.",
  attachesTo: ["character", "object"],
  fields: [
    choice("kind", "Kind", ["money", "time", "people", "access", "equipment", "leverage"]),
    text("held_by", "Held by"),
    longText("depletion", "How it runs out"),
  ],
});

const asymmetry = kind(MODULE, {
  id: "information_asymmetry",
  label: "Asymmetry",
  plural: "Information asymmetry",
  description:
    "A gap between what one side knows and another does. Names the fact the project already tracks.",
  fields: [
    field({
      key: "fact",
      label: "The fact",
      type: "entity",
      entityKind: "fact",
      required: true,
      description: "Who actually holds it is answered by the knowledge model, not by this record.",
    }),
    text("advantage_to", "Advantage to"),
    longText("what_it_buys", "What the advantage buys them"),
    field({
      key: "closes_at",
      label: "Closes at",
      type: "entity",
      entityKind: "scene",
      description: "Where the gap shuts.",
    }),
  ],
});

/**
 * A clock that never runs out.
 *
 * Deterministic and worth catching: a deadline with no expiry scene is one the
 * book has stopped keeping, and a reader feels that long before the writer
 * notices it.
 */
const deadlineWithoutExpiry = moduleRule({
  id: "thriller_deadline_never_falls",
  name: "Deadline never falls",
  category: "plot_threads",
  description: "A deadline names the scene where the clock runs out.",
  inputs: ["scenes"],
  run(context) {
    const known = new Set(context.scenes.map((scene) => scene.id as string));
    return recordsOf(context, MODULE, "deadline")
      .filter(
        (record) =>
          valueOf(record, "outcome") !== "extended" && !known.has(valueOf(record, "expires_at")),
      )
      .map((record) =>
        about(record, {
          severity: "warning",
          message: `The deadline "${record.name}" never falls: no scene is recorded where it expires.`,
          evidence: `expires_at: ${valueOf(record, "expires_at") === "" ? "not recorded" : valueOf(record, "expires_at")}; outcome: ${valueOf(record, "outcome") || "undecided"}`,
          suggestedAction: "Name the scene where the clock runs out, or where they beat it.",
          key: "no_expiry",
        }),
      );
  },
});

/** An advantage that is never used, or one that closes before it is stated. */
const asymmetryNeverUsed = moduleRule({
  id: "thriller_asymmetry_unused",
  name: "Asymmetry closed before it pays",
  category: "knowledge",
  description: "An information advantage buys somebody something before it closes.",
  inputs: ["scenes"],
  run(context) {
    const order = new Map(
      orderScenes(context.scenes, context.chapters).map((scene, at) => [
        scene.id as string,
        at + 1,
      ]),
    );
    return recordsOf(context, MODULE, "information_asymmetry")
      .filter(
        (record) =>
          valueOf(record, "what_it_buys") === "" && order.has(valueOf(record, "closes_at")),
      )
      .map((record) =>
        about(record, {
          severity: "info",
          message: `"${record.name}" closes at scene ${String(order.get(valueOf(record, "closes_at")) ?? 0)}, and nothing is recorded that the advantage bought.`,
          sceneId: valueOf(record, "closes_at"),
          evidence: `fact: ${valueOf(record, "fact")}; what_it_buys is empty`,
          suggestedAction:
            "Record what knowing it first let them do — or the gap is bookkeeping rather than tension.",
          key: "unused",
        }),
      );
  },
});

export const THRILLER_MODULE: GenreModule = {
  id: "thriller",
  name: "Thriller",
  summary: "Threat, clock, pursuit and who knows what — recorded so the pressure can be checked.",
  description:
    "Threats, deadlines, pursuits, operational timelines, resources and information asymmetry. Asymmetry names facts the knowledge model already tracks rather than duplicating it, and the build reports a clock that never runs out.",

  extensionKinds: [threat, deadline, pursuit, operation, resource, asymmetry],
  views: [],
  rules: [deadlineWithoutExpiry, asymmetryNeverUsed],

  testTemplates: [
    template({
      id: "thriller_pressure_never_drops",
      name: "Pressure should not go slack",
      rationale:
        "Whether a chapter releases tension is a reading, and one a simulated reader gives well.",
      statement:
        "No stretch of chapters should pass without the threat or the clock making itself felt.",
    }),
    template({
      id: "thriller_competence",
      name: "The antagonist should be as competent as the plot needs",
      rationale: "The commonest thriller failure is an opponent who stops being good at their job.",
      statement:
        "The antagonist should not make a mistake the story has established they would not make.",
      severity: "error",
    }),
  ],

  commands: [],

  metadata: [
    {
      key: "clock_scale",
      label: "Time frame",
      type: "choice",
      choices: ["hours", "days", "weeks", "months"],
      description: "How long the whole book covers. Informational.",
    },
  ],

  agents: ["story_architect", "developmental_editor"],
  // No skill of its own yet: the core passes serve this genre unchanged.
  skills: [],
  recipes: [],
};
