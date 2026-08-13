import { MYSTERY_CAVEAT } from "@jellytind/domain";
import type {
  AlibiFinding,
  FairnessFinding,
  FairnessReport,
  FairnessVerdict,
  ObviousnessFinding,
  ReaderSimulation,
  Solvability,
} from "@jellytind/domain";
import { firstSuspected } from "@jellytind/reader-sim";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  loadArchitecture,
  resolveChain,
  solutionStep,
  type MysteryArchitecture,
} from "./architecture";

/**
 * _Can a careful reader fairly reach the intended solution before the reveal?_
 *
 * The question a mystery lives or dies by, and — once the clue system is
 * populated — a question about records rather than taste. A premise the reader
 * was never shown is not a hard mystery; it is a different kind of book, and
 * the audit says which one this is.
 *
 * Everything here is deterministic. No model is consulted, and none is needed:
 * the author has already said what the reader must conclude and from what
 * (docs/MYSTERY_ENGINE.md).
 */
export async function auditFairness(
  repo: StoryRepository,
  mysteryId: string,
): Promise<FairnessReport> {
  const architecture = await loadArchitecture(repo, mysteryId);
  const facts = await repo.listFacts();
  const { steps, cycles } = resolveChain(architecture, facts);
  const findings: FairnessFinding[] = [];
  const notChecked: string[] = [];

  const revealAt =
    architecture.mystery.revealSceneId === undefined
      ? null
      : architecture.positionOf(architecture.mystery.revealSceneId as string);
  if (revealAt === null) {
    notChecked.push("no reveal scene is recorded, so nothing could be checked against it");
  }

  for (const id of cycles) {
    findings.push({
      problem: "missing_premise",
      statement: `The reasoning circles: ${architecture.label(id)} is a premise of itself, directly or through another step.`,
      derivation: "deterministic",
      clueIds: [id],
    });
  }

  const solution = solutionStep(steps);
  if (solution === null) {
    notChecked.push(
      "no deduction is marked as the solution, so there is no chain to check for fairness",
    );
  }

  // ── Every premise the solution rests on ───────────────────────────────────
  const required = solution === null ? [] : premisesOf(solution.deductionId, steps);
  for (const premise of required) {
    if (premise.kind === "missing") {
      findings.push({
        problem: "missing_premise",
        statement: `The reasoning rests on ${premise.id}, which is not in the project.`,
        derivation: "deterministic",
        clueIds: [premise.id],
      });
      continue;
    }
    if (premise.availableAt === null) {
      findings.push({
        problem: "hidden_essential",
        statement: `The reader is never shown "${premise.label}", and the solution depends on it.`,
        detail:
          premise.kind === "fact"
            ? "No clue exposes this proposition to the reader. A fact the story knows is not a fact the reader has."
            : "This premise has no reader exposure recorded.",
        derivation: "deterministic",
        clueIds: [premise.id],
      });
      continue;
    }
    if (revealAt !== null && premise.availableAt.position >= revealAt) {
      findings.push({
        problem: "late_premise",
        statement: `"${premise.label}" only reaches the reader at scene ${String(premise.availableAt.position)}, at or after the reveal.`,
        derivation: "deterministic",
        clueIds: [premise.id],
        sceneIds: [premise.availableAt.sceneId],
      });
    }
  }

  // ── Buried everywhere is fair on paper and not in practice ────────────────
  const requiredClues = required
    .filter((premise) => premise.kind === "clue")
    .map((premise) => architecture.clueById(premise.id))
    .filter((clue): clue is NonNullable<typeof clue> => clue !== undefined);
  if (requiredClues.length > 0 && requiredClues.every((clue) => clue.visibility === "buried")) {
    findings.push({
      problem: "technically_fair",
      statement: `Every clue the solution needs is marked buried (${String(requiredClues.length)} of them).`,
      detail:
        "The reader was shown everything and shown none of it plainly. That is a choice — but it is worth making on purpose.",
      derivation: "deterministic",
      clueIds: requiredClues.map((clue) => clue.id as string),
    });
  }

  // ── Red herrings the story never explains ─────────────────────────────────
  for (const clue of architecture.clues) {
    if (clue.kind !== "red_herring") continue;
    if (clue.resolution !== undefined && clue.resolution.trim() !== "") continue;
    findings.push({
      problem: "unresolved_herring",
      statement: `The red herring "${clue.description}" is never explained.`,
      detail:
        "A herring the story does not account for reads as a loose end rather than a misdirection.",
      derivation: "deterministic",
      clueIds: [clue.id as string],
      ...(clue.firstAppearance === undefined ? {} : { sceneIds: [clue.firstAppearance as string] }),
    });
  }

  // ── Clues planted and never cashed ────────────────────────────────────────
  for (const clue of architecture.clues) {
    if (clue.kind === "red_herring" || clue.status === "abandoned") continue;
    if (clue.payoffSceneId !== undefined) continue;
    const usedAsPremise = architecture.deductions.some((deduction) =>
      deduction.premises.includes(clue.id as string),
    );
    if (usedAsPremise) continue;
    findings.push({
      problem: "unpaid_clue",
      statement: `"${clue.description}" is planted, and nothing uses it — no payoff scene and no deduction.`,
      derivation: "deterministic",
      clueIds: [clue.id as string],
    });
  }

  // ── What the reader actually has by the reveal ────────────────────────────
  const readerHasByReveal = architecture.clues
    .map((clue) => ({ clue, at: architecture.exposureOf(clue.id as string) }))
    .filter((entry) => entry.at !== null && (revealAt === null || entry.at.position < revealAt))
    .sort((a, b) => (a.at?.position ?? 0) - (b.at?.position ?? 0))
    .map((entry) => entry.clue.id as string);

  if (architecture.clues.length === 0) {
    notChecked.push("no clues are recorded for this mystery");
  }

  return {
    mysteryId,
    mysteryName: architecture.mystery.name,
    chain: steps.map((step) => step.deductionId),
    findings,
    readerHasByReveal,
    verdict: verdictFrom(findings, solution !== null, architecture),
    basis: `${String(architecture.clues.length)} clue(s), ${String(architecture.deductions.length)} deduction(s), ${String(architecture.suspects.length)} suspect(s)${
      revealAt === null ? "" : `, reveal at scene ${String(revealAt)}`
    }.`,
    notChecked,
  };
}

function premisesOf(
  deductionId: string,
  steps: ReturnType<typeof resolveChain>["steps"],
): ReturnType<typeof resolveChain>["steps"][number]["premises"][number][] {
  const byId = new Map(steps.map((step) => [step.deductionId, step]));
  const seen = new Set<string>();
  const out: ReturnType<typeof resolveChain>["steps"][number]["premises"][number][] = [];

  const walk = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const step = byId.get(id);
    if (step === undefined) return;
    for (const premise of step.premises) {
      if (premise.kind === "deduction") walk(premise.id);
      else out.push(premise);
    }
  };
  walk(deductionId);
  return out;
}

function verdictFrom(
  findings: readonly FairnessFinding[],
  hasSolution: boolean,
  architecture: MysteryArchitecture,
): FairnessVerdict {
  if (!hasSolution || architecture.clues.length === 0) return "insufficient_data";
  const kinds = new Set(findings.map((finding) => finding.problem));
  if (kinds.has("hidden_essential") || kinds.has("missing_premise") || kinds.has("late_premise")) {
    return "unfair";
  }
  if (kinds.has("technically_fair") || kinds.has("unresolved_herring")) return "strained";
  return "fair";
}

/**
 * The earliest scene by which the solution becomes reachable.
 *
 * Deterministic in its arithmetic — it is the position of the last premise the
 * chain needs — but **labelled as analysis**, because the premise that
 * *technically* arrives in scene nine may not be one a reader could use until
 * they have a reason to look at it. What the number is good for is comparison:
 * against the author's intent, and against what simulated readers actually did
 * (docs/MYSTERY_ENGINE.md).
 */
export async function earliestSolvable(
  repo: StoryRepository,
  mysteryId: string,
): Promise<Solvability> {
  const architecture = await loadArchitecture(repo, mysteryId);
  const facts = await repo.listFacts();
  const { steps } = resolveChain(architecture, facts);
  const solution = solutionStep(steps);

  const intended = architecture.mystery.intendedSolvableFromSceneId;
  const intendedPosition =
    intended === undefined ? undefined : architecture.positionOf(intended as string);

  if (solution === null || solution.reachableAt === null) {
    return {
      mysteryId,
      earliestSceneId: null,
      earliestPosition: null,
      ...(intended === undefined ? {} : { intendedSceneId: intended as string }),
      caveat:
        solution === null
          ? `No deduction is marked as the solution, so there is nothing to reach. ${MYSTERY_CAVEAT}`
          : `The solution is never reachable: at least one premise never reaches the reader. ${MYSTERY_CAVEAT}`,
    };
  }

  // The premise that arrives last is the one holding solvability back.
  const premises = premisesOf(solution.deductionId, steps).filter(
    (premise) => premise.availableAt !== null,
  );
  const gating = premises.reduce(
    (latest, premise) =>
      latest === null || (premise.availableAt?.position ?? 0) > (latest.availableAt?.position ?? 0)
        ? premise
        : latest,
    null as (typeof premises)[number] | null,
  );

  return {
    mysteryId,
    earliestSceneId: solution.reachableAt.sceneId,
    earliestPosition: solution.reachableAt.position,
    ...(gating?.availableAt == null
      ? {}
      : {
          gatingPremise: {
            id: gating.id,
            sceneId: gating.availableAt.sceneId,
            label: gating.label,
          },
        }),
    ...(intended === undefined ? {} : { intendedSceneId: intended as string }),
    ...(intendedPosition === undefined || intendedPosition < 0
      ? {}
      : { scenesFromIntended: solution.reachableAt.position - intendedPosition }),
    caveat: `The scene by which every premise has reached the reader. ${MYSTERY_CAVEAT}`,
  };
}

/**
 * Simulated readers arriving at the culprit too early.
 *
 * The Reader Simulator already answers "when did this reader start suspecting
 * X?"; the Mystery Engine knows who X is and when the author meant them to be
 * suspected. Put together, that is accidental obviousness — and neither half
 * would be worth building alone (docs/SIMULATIONS.md).
 */
export async function detectObviousness(
  repo: StoryRepository,
  mysteryId: string,
  simulations: readonly ReaderSimulation[],
  options: { threshold?: "moderate" | "high" } = {},
): Promise<ObviousnessFinding[]> {
  const architecture = await loadArchitecture(repo, mysteryId);
  const chapters = await repo.listChapters();
  const chapterOrder = [...chapters].sort((a, b) => a.order - b.order).map((c) => c.id as string);

  const intendedPosition = intendedChapterPosition(architecture, chapterOrder);
  const out: ObviousnessFinding[] = [];

  for (const culpritId of architecture.mystery.culpritIds.map(String)) {
    for (const simulation of simulations) {
      const hit = firstSuspected(simulation, culpritId, options.threshold ?? "moderate");
      if (hit === null) continue;
      // Only early arrivals are findings. A reader suspecting the culprit after
      // the author intended is not a problem this looks for.
      if (intendedPosition !== null && hit.position >= intendedPosition) continue;

      out.push({
        mysteryId,
        culpritId,
        readerProfileId: simulation.profileId,
        readerProfileName: simulation.profileName,
        suspectedAtPosition: hit.position,
        suspectedAtChapterId: hit.chapterId,
        ...(intendedPosition === null ? {} : { intendedPosition }),
        ...(intendedPosition === null ? {} : { scenesEarly: intendedPosition - hit.position }),
        caveat: `${simulation.profileName} suspected them from chapter ${String(hit.position)}. ${MYSTERY_CAVEAT}`,
      });
    }
  }
  return out;
}

/** The chapter the intended solvable-from scene sits in, as a chapter position. */
function intendedChapterPosition(
  architecture: MysteryArchitecture,
  chapterOrder: readonly string[],
): number | null {
  const intended = architecture.mystery.intendedSolvableFromSceneId;
  if (intended === undefined) return null;
  const sceneAt = architecture.positionOf(intended as string);
  if (sceneAt < 0) return null;
  // Reader simulations are per chapter; the chain is per scene. Compare in
  // chapters, which is the coarser and therefore the honest unit.
  const share = sceneAt / Math.max(1, architecture.sceneOrder.length);
  return Math.max(1, Math.ceil(share * chapterOrder.length));
}

/**
 * Alibis the recorded timeline does not support.
 *
 * A registered contradiction, not a deduction: the suspect says they were at
 * the mill, and the project records them at the manor in the scene the alibi
 * covers. That is checkable, and it is exactly the kind of thing a writer loses
 * track of (docs/TIMELINE.md).
 */
export async function checkAlibis(
  repo: StoryRepository,
  mysteryId: string,
): Promise<AlibiFinding[]> {
  const architecture = await loadArchitecture(repo, mysteryId);
  const timeline = await repo.getStoryTimeline();
  const out: AlibiFinding[] = [];

  for (const suspect of architecture.suspects) {
    const characterId = suspect.characterId as string;
    const alibi = suspect.alibi;
    if (alibi === undefined) {
      out.push({
        mysteryId,
        characterId,
        statement: `No alibi is recorded for ${architecture.label(characterId)}.`,
        kind: "unchecked",
      });
      continue;
    }

    const sceneId = alibi.coversSceneId as string | undefined;
    if (sceneId === undefined) {
      out.push({
        mysteryId,
        characterId,
        statement: `${architecture.label(characterId)}'s alibi names no scene it covers, so the timeline could not check it.`,
        detail: alibi.claim,
        kind: "unchecked",
      });
      continue;
    }

    // Where the project puts them by the end of the scene the alibi covers:
    // an alibi is a claim about the whole scene, not about walking into it.
    const state = timeline.characterStateAt(characterId, { sceneId, position: "after" });
    if (alibi.locationId !== undefined && state.locationId !== undefined) {
      if (state.locationId !== alibi.locationId) {
        out.push({
          mysteryId,
          characterId,
          statement: `${architecture.label(characterId)} claims to have been at ${architecture.label(alibi.locationId)}, and the project records them at ${architecture.label(state.locationId)}.`,
          detail: alibi.claim,
          sceneIds: [sceneId],
          kind: "contradicted",
        });
        continue;
      }
    }

    if (alibi.corroboratedBy === undefined) {
      out.push({
        mysteryId,
        characterId,
        statement: `${architecture.label(characterId)}'s alibi has nobody to corroborate it.`,
        detail: alibi.claim,
        sceneIds: [sceneId],
        kind: "uncorroborated",
      });
    }
  }
  return out;
}
