import { describeFairness } from "@jellytind/domain";
import type { SkillFinding } from "@jellytind/domain";
import {
  auditFairness,
  checkAlibis,
  detectObviousness,
  earliestSolvable,
  loadArchitecture,
  renderChain,
  resolveChain,
} from "@jellytind/mystery";
import type { SkillOperation } from "../types";
import { finding, nothingToDo, operation } from "./shared";

/**
 * The `/fairness-audit` workflow.
 *
 * _Can a careful reader fairly reach the intended solution before the reveal?_
 * — asked as a sequence of structured queries rather than as one large prompt.
 * Every step here reads the clue system the author populated; none of them
 * reads the prose, and none of them asks a model what it thinks of the book
 * (docs/MYSTERY_ENGINE.md).
 *
 * The one step that consumes model output — accidental obviousness — consumes
 * *simulated readers*, and labels its findings as such.
 */

const MYSTERY_INPUT = "mysteryId";

interface LoadedMystery {
  readonly mysteryId: string;
  readonly name: string;
  readonly question: string;
  readonly clues: number;
  readonly deductions: number;
  readonly suspects: number;
  readonly exposures: ReadonlyArray<{
    readonly clueId: string;
    readonly description: string;
    readonly kind: string;
    readonly visibility: string;
    readonly sceneId: string | null;
    readonly position: number | null;
  }>;
}

export const loadMystery = operation({
  id: "load_mystery",
  title: "Load the clue system",
  kind: "deterministic",
  requiresInput: [MYSTERY_INPUT],
  produces: "mystery",
  requiredTools: ["get_mystery"],
  async run(context) {
    const mysteryId = context.inputs[MYSTERY_INPUT] ?? "";
    const architecture = await loadArchitecture(context.repo, mysteryId);

    const exposures = architecture.clues.map((clue) => {
      const at = architecture.exposureOf(clue.id as string);
      return {
        clueId: clue.id as string,
        description: clue.description,
        kind: clue.kind,
        visibility: clue.visibility,
        sceneId: at?.sceneId ?? null,
        position: at?.position ?? null,
      };
    });

    const unplaced = exposures.filter((entry) => entry.position === null);
    const data: LoadedMystery = {
      mysteryId,
      name: architecture.mystery.name,
      question: architecture.mystery.question,
      clues: architecture.clues.length,
      deductions: architecture.deductions.length,
      suspects: architecture.suspects.length,
      exposures,
    };

    return {
      summary: `${architecture.mystery.name}: ${String(architecture.clues.length)} clue(s), ${String(architecture.deductions.length)} deduction(s), ${String(architecture.suspects.length)} suspect(s)`,
      data,
      measurements: [
        {
          label: "Clues reaching the reader",
          value: exposures.length - unplaced.length,
          unit: "clues",
          basis: "recorded reader exposure",
        },
      ],
      findings: unplaced.map((entry, index) =>
        finding(context, index, {
          kind: "gap",
          statement: `"${entry.description}" has no scene where the reader is shown it.`,
          basis: "clue record",
          entities: [entry.clueId],
        }),
      ),
    };
  },
});

interface ResolvedChain {
  readonly steps: ReadonlyArray<{
    readonly deductionId: string;
    readonly statement: string;
    readonly reachableAtPosition: number | null;
    readonly isSolution: boolean;
    readonly rendered: string;
  }>;
  readonly cycles: readonly string[];
}

export const resolveDeductionChain = operation({
  id: "resolve_deduction_chain",
  title: "Resolve the chain of reasoning",
  kind: "deterministic",
  requiresInput: [MYSTERY_INPUT],
  reads: ["mystery"],
  produces: "chain",
  requiredTools: ["get_mystery"],
  async run(context) {
    const mysteryId = context.inputs[MYSTERY_INPUT] ?? "";
    const architecture = await loadArchitecture(context.repo, mysteryId);
    if (architecture.deductions.length === 0) {
      return nothingToDo("No deductions are recorded, so there is no chain to resolve.");
    }

    const { steps, cycles } = resolveChain(architecture, await context.repo.listFacts());
    const data: ResolvedChain = {
      steps: steps.map((step) => ({
        deductionId: step.deductionId,
        statement: step.statement,
        reachableAtPosition: step.reachableAt?.position ?? null,
        isSolution: step.isSolution,
        rendered: renderChain(step),
      })),
      cycles,
    };

    const findings: SkillFinding[] = [
      ...cycles.map((id, index) =>
        finding(context, index, {
          kind: "conflict",
          statement: `The reasoning circles: ${architecture.label(id)} is a premise of itself.`,
          basis: "deduction records",
          entities: [id],
        }),
      ),
      ...steps
        .filter((step) => step.reachableAt === null)
        .map((step, index) =>
          finding(context, cycles.length + index, {
            kind: "gap",
            statement: `"${step.statement}" is never reachable — at least one premise never reaches the reader.`,
            detail: step.premises
              .filter((premise) => premise.availableAt === null)
              .map((premise) => premise.label)
              .join("; "),
            basis: "deduction records",
            entities: [step.deductionId],
          }),
        ),
    ];

    return {
      summary: `${String(steps.length)} step(s) of reasoning${cycles.length > 0 ? `, ${String(cycles.length)} of them circular` : ""}`,
      data,
      findings,
    };
  },
});

export const auditMysteryFairness = operation({
  id: "audit_fairness",
  title: "Ask whether the reader could have got there",
  kind: "deterministic",
  requiresInput: [MYSTERY_INPUT],
  reads: ["chain"],
  produces: "fairness",
  requiredTools: ["get_mystery"],
  async run(context) {
    const mysteryId = context.inputs[MYSTERY_INPUT] ?? "";
    const report = await auditFairness(context.repo, mysteryId);

    const findings = report.findings.map((entry, index) =>
      finding(context, index, {
        // A premise the reader never got is a contradiction between what the
        // book asks of them and what it gave them. The softer problems are
        // worth a look rather than a fix.
        kind:
          entry.problem === "hidden_essential" ||
          entry.problem === "missing_premise" ||
          entry.problem === "late_premise"
            ? "conflict"
            : "attention",
        statement: entry.statement,
        ...(entry.detail === undefined ? {} : { detail: entry.detail }),
        basis: `fairness audit · ${entry.problem}`,
        ...(entry.sceneIds === undefined ? {} : { sceneIds: entry.sceneIds }),
        ...(entry.clueIds === undefined ? {} : { entities: entry.clueIds }),
        source: entry.derivation,
      }),
    );

    return {
      summary: describeFairness(report.verdict),
      data: {
        verdict: report.verdict,
        findings: report.findings,
        readerHasByReveal: report.readerHasByReveal,
        basis: report.basis,
      },
      findings,
      ...(report.notChecked.length === 0 ? {} : { notMeasured: report.notChecked }),
    };
  },
});

export const estimateSolvability = operation({
  id: "estimate_solvability",
  title: "Estimate the earliest solvable point",
  kind: "deterministic",
  requiresInput: [MYSTERY_INPUT],
  reads: ["fairness"],
  produces: "solvability",
  requiredTools: ["get_mystery"],
  async run(context) {
    const mysteryId = context.inputs[MYSTERY_INPUT] ?? "";
    const solvability = await earliestSolvable(context.repo, mysteryId);

    if (solvability.earliestPosition === null) {
      return {
        summary: "The solution is never reachable from what the reader is shown",
        data: solvability,
        notMeasured: [solvability.caveat],
      };
    }

    const drift = solvability.scenesFromIntended;
    return {
      summary: `Reachable from scene ${String(solvability.earliestPosition)}${
        drift === undefined
          ? ""
          : drift === 0
            ? ", exactly where you intended"
            : drift > 0
              ? `, ${String(drift)} scene(s) later than you intended`
              : `, ${String(Math.abs(drift))} scene(s) earlier than you intended`
      }`,
      data: solvability,
      measurements: [
        {
          label: "Earliest solvable scene",
          value: solvability.earliestPosition,
          unit: "scene position",
          basis: solvability.caveat,
        },
      ],
      ...(solvability.gatingPremise === undefined
        ? {}
        : {
            findings: [
              finding(context, 0, {
                kind: "measurement",
                statement: `Solvability waits on "${solvability.gatingPremise.label}".`,
                basis: solvability.caveat,
                sceneIds: [solvability.gatingPremise.sceneId],
                entities: [solvability.gatingPremise.id],
              }),
            ],
          }),
    };
  },
});

export const checkSuspectAlibis = operation({
  id: "check_alibis",
  title: "Check alibis against the timeline",
  kind: "deterministic",
  requiresInput: [MYSTERY_INPUT],
  reads: ["mystery"],
  produces: "alibis",
  requiredTools: ["get_mystery", "get_character_state"],
  async run(context) {
    const mysteryId = context.inputs[MYSTERY_INPUT] ?? "";
    const alibis = await checkAlibis(context.repo, mysteryId);
    if (alibis.length === 0) {
      return { summary: "Every recorded alibi is supported by the timeline", data: { alibis: [] } };
    }

    const contradicted = alibis.filter((entry) => entry.kind === "contradicted");
    const unchecked = alibis.filter((entry) => entry.kind === "unchecked");

    return {
      summary: `${String(contradicted.length)} contradicted, ${String(alibis.length - contradicted.length - unchecked.length)} uncorroborated, ${String(unchecked.length)} not checkable`,
      data: { alibis },
      findings: alibis
        // An alibi nothing could check is reported as unmeasured, not as clean.
        .filter((entry) => entry.kind !== "unchecked")
        .map((entry, index) =>
          finding(context, index, {
            kind: entry.kind === "contradicted" ? "conflict" : "attention",
            statement: entry.statement,
            ...(entry.detail === undefined ? {} : { detail: entry.detail }),
            basis: "suspect alibi against the recorded timeline",
            ...(entry.sceneIds === undefined ? {} : { sceneIds: entry.sceneIds }),
            entities: [entry.characterId],
          }),
        ),
      ...(unchecked.length === 0 ? {} : { notMeasured: unchecked.map((entry) => entry.statement) }),
    };
  },
});

export const detectAccidentalObviousness = operation({
  id: "detect_obviousness",
  title: "Check whether simulated readers get there early",
  kind: "deterministic",
  requiresInput: [MYSTERY_INPUT],
  reads: ["mystery"],
  produces: "obviousness",
  requiredTools: ["get_mystery", "list_reader_simulations"],
  async run(context) {
    const mysteryId = context.inputs[MYSTERY_INPUT] ?? "";
    const summaries = await context.repo.readerSims.list();
    const completed = summaries.filter((entry) => entry.status === "completed");
    if (completed.length === 0) {
      return nothingToDo(
        "No completed reader simulations are stored, so nothing could be compared against the author's intent.",
      );
    }

    const simulations = [];
    for (const summary of completed) {
      const simulation = await context.repo.readerSims.get(summary.id);
      if (simulation !== null) simulations.push(simulation);
    }

    const findings = await detectObviousness(context.repo, mysteryId, simulations);
    return {
      summary:
        findings.length === 0
          ? `No simulated reader reached the culprit early (${String(simulations.length)} reader(s) compared)`
          : `${String(findings.length)} simulated reader(s) reached the culprit earlier than intended`,
      data: { findings, readersCompared: simulations.length },
      findings: findings.map((entry, index) =>
        finding(context, index, {
          kind: "attention",
          statement: `${entry.readerProfileName} suspected the culprit from chapter ${String(entry.suspectedAtPosition)}${
            entry.scenesEarly === undefined
              ? ""
              : `, ${String(entry.scenesEarly)} chapter(s) earlier than intended`
          }.`,
          basis: entry.caveat,
          entities: [entry.culpritId],
          // Reader simulations are a model's reading, so anything built on
          // them is too, however arithmetic the comparison looks.
          source: "model",
        }),
      ),
    };
  },
});

export const MYSTERY_OPERATIONS: readonly SkillOperation[] = [
  loadMystery,
  resolveDeductionChain,
  auditMysteryFairness,
  estimateSolvability,
  checkSuspectAlibis,
  detectAccidentalObviousness,
];
