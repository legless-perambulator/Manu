import { auditFairness, earliestSolvable } from "@jellytind/mystery";
import type { FairnessReport, Solvability } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import type { DiagnosticDraft } from "@jellytind/story-compiler";
import type { GenreModule } from "../types";
import { moduleRule, template } from "./shared";

/**
 * The Mystery module — the first full one, and deliberately the odd one out.
 *
 * It declares **no extension kinds at all**. Clues, suspects and deductions are
 * not generic records dressed up as a genre; they are a subsystem with its own
 * store, its own engine and its own tests (Phase 29, docs/MYSTERY_ENGINE.md).
 * What this module does is switch that subsystem on: put the clue board in the
 * workspace, offer `/fairness-audit`, and turn the fairness audit into part of
 * the build.
 *
 * That is worth saying plainly, because it is the framework's real claim. A
 * module is not obliged to express itself as records in a bag. Where a genre
 * deserves a proper engine it gets one, and the module is the seam that decides
 * whether the writer sees it (docs/GENRE_MODULES.md).
 */

/** What the module hands the build. Its own shape, in its own slot. */
export interface MysteryBuildData {
  readonly reports: readonly FairnessReport[];
  readonly solvability: readonly Solvability[];
}

const fairness = moduleRule({
  id: "mystery_fairness",
  name: "Mystery fairness",
  category: "setup_payoff",
  description:
    "Every premise the solution rests on reaches the reader before the reveal, and every red herring is explained.",
  inputs: ["entities", "scenes"],
  run(context) {
    const data = context.modules.data["mystery"] as MysteryBuildData | undefined;
    if (data === undefined) return [];

    const out: DiagnosticDraft[] = [];
    for (const report of data.reports) {
      for (const finding of report.findings) {
        // The two that break the contract with the reader are errors. The rest
        // are worth a look and may well be deliberate — a buried clue is a
        // choice, and the build does not get to overrule it.
        const severity =
          finding.problem === "hidden_essential" ||
          finding.problem === "missing_premise" ||
          finding.problem === "late_premise"
            ? ("error" as const)
            : ("warning" as const);

        out.push({
          severity,
          message: `${report.mysteryName}: ${finding.statement}`,
          entities: [report.mysteryId, ...(finding.clueIds ?? [])],
          ...(finding.sceneIds?.[0] === undefined ? {} : { sceneId: finding.sceneIds[0] }),
          evidence: finding.detail ?? report.basis,
          suggestedAction:
            severity === "error"
              ? "Show the reader this before the reveal, or change what the solution rests on."
              : "Worth a look. This may be exactly what you intended.",
          key: finding.problem,
        });
      }
    }
    return out;
  },
});

export const MYSTERY_MODULE: GenreModule = {
  id: "mystery",
  name: "Mystery",
  summary: "Clues, suspects and the question of whether the reader could have got there first.",
  description:
    "Turns on the Mystery Engine: a clue board where reader exposure is tracked apart from what the characters find, deduction chains from clue to solution, alibis checked against the timeline, and a fairness audit that runs as part of every build.",

  // Nothing generic. This module's material has a subsystem of its own.
  extensionKinds: [],

  views: [
    {
      id: "mystery",
      label: "Mystery",
      purpose: "Clues, deductions, and whether the reader could have got there",
      group: "verify",
    },
  ],

  rules: [fairness],

  testTemplates: [
    template({
      id: "mystery_no_early_certainty",
      name: "The culprit should not be obvious before the reveal",
      rationale:
        "The fairness audit checks whether the reader *could* solve it. This is the other half: whether they do so far too easily.",
      statement:
        "A first-time reader should not be certain of the culprit before the intended solvable point.",
    }),
    template({
      id: "mystery_investigator_earns_it",
      name: "The investigator should earn the solution",
      rationale:
        "A detective who is simply told the answer is a different kind of scene from one who works it out, and only a reader can tell which this is.",
      statement:
        "The investigator should reach the solution through evidence the reader has also seen, not through a confession or a coincidence.",
    }),
  ],

  commands: [
    {
      command: "/fairness-audit",
      label: "Fairness audit",
      description: "Could a careful reader fairly reach the solution before the reveal?",
      runsSkill: "fairness_audit",
    },
  ],

  metadata: [
    {
      key: "mystery_form",
      label: "Form",
      type: "choice",
      choices: ["whodunnit", "howdunnit", "whydunnit", "inverted", "thriller-mystery"],
      description: "Which question the book is really asking. Informational.",
    },
  ],

  agents: ["continuity_editor", "story_architect"],
  skills: ["fairness_audit"],
  recipes: ["reader_sequential"],

  async collect(reader) {
    // The module reaches its own engine, and only its own. The core never
    // learns what a clue is.
    const repo = reader as StoryRepository;
    const mysteries = await repo.mysteries.listMysteries();
    const reports: FairnessReport[] = [];
    const solvability: Solvability[] = [];
    for (const mystery of mysteries) {
      const id = mystery.id as string;
      reports.push(await auditFairness(repo, id));
      solvability.push(await earliestSolvable(repo, id));
    }
    return { reports, solvability } satisfies MysteryBuildData;
  },
};
