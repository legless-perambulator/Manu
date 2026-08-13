import { orderScenes } from "@jellytind/domain";
import type { Clue, Deduction, Mystery, Suspect } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import { MysteryError } from "./types";

/**
 * A mystery's information architecture, reconstructed from records.
 *
 * This is the acceptance criterion: once the clue system is populated, every
 * question about the mystery — when the reader had what, which reasoning rests
 * on which clue, when each suspect became suspectable — is answerable **without
 * reading a word of the prose**. The prose is where a reader meets it; the
 * architecture is where the writer can see it (docs/MYSTERY_ENGINE.md).
 */
export interface MysteryArchitecture {
  readonly mystery: Mystery;
  readonly clues: readonly Clue[];
  readonly deductions: readonly Deduction[];
  readonly suspects: readonly Suspect[];
  /** Scene IDs in manuscript order — the axis everything is placed on. */
  readonly sceneOrder: readonly string[];
  /** Where each scene sits, 1-based. */
  positionOf(sceneId: string): number;
  /** The scene a clue first reaches the reader, and where that is. */
  exposureOf(clueId: string): { sceneId: string; position: number } | null;
  clueById(id: string): Clue | undefined;
  deductionById(id: string): Deduction | undefined;
  label(id: string): string;
}

export async function loadArchitecture(
  repo: StoryRepository,
  mysteryId: string,
): Promise<MysteryArchitecture> {
  const [mystery, clues, deductions, suspects, scenes, chapters, facts, characters, locations] =
    await Promise.all([
      repo.mysteries.getMystery(mysteryId),
      repo.mysteries.listClues(mysteryId),
      repo.mysteries.listDeductions(mysteryId),
      repo.mysteries.listSuspects(mysteryId),
      repo.listScenes(),
      repo.listChapters(),
      repo.listFacts(),
      repo.listCharacters(),
      repo.listLocations(),
    ]);

  if (mystery === null) {
    throw new MysteryError("unknown_mystery", `No mystery with id ${mysteryId}.`, {
      details: { mysteryId },
    });
  }

  const ordered = orderScenes(scenes, chapters).map((scene) => scene.id as string);
  const index = new Map(ordered.map((id, at) => [id, at + 1]));
  const clueIndex = new Map(clues.map((clue) => [clue.id as string, clue]));
  const deductionIndex = new Map(deductions.map((entry) => [entry.id as string, entry]));

  const names = new Map<string, string>();
  for (const scene of scenes) names.set(scene.id as string, scene.title);
  for (const character of characters) names.set(character.id as string, character.name);
  // Locations, because an alibi is a claim about a place: "at LOC_0001" is not
  // a finding anybody can act on.
  for (const location of locations) names.set(location.id as string, location.name);
  for (const fact of facts) names.set(fact.id as string, fact.statement);
  for (const clue of clues) names.set(clue.id as string, clue.description);
  for (const entry of deductions) names.set(entry.id as string, entry.statement);

  return {
    mystery,
    clues,
    deductions,
    suspects,
    sceneOrder: ordered,
    positionOf: (sceneId) => index.get(sceneId) ?? -1,
    exposureOf: (clueId) => {
      const clue = clueIndex.get(clueId);
      if (clue === undefined) return null;
      // The earliest scene the reader is shown it, in manuscript order —
      // whichever order the author happened to list the exposures in.
      const placed = clue.readerExposure
        .map((sceneId) => ({
          sceneId: sceneId as string,
          position: index.get(sceneId as string) ?? -1,
        }))
        .filter((entry) => entry.position > 0)
        .sort((a, b) => a.position - b.position);
      return placed[0] ?? null;
    },
    clueById: (id) => clueIndex.get(id),
    deductionById: (id) => deductionIndex.get(id),
    label: (id) => names.get(id) ?? id,
  };
}

// ── Deduction chains ────────────────────────────────────────────────────────

export interface ChainStep {
  readonly deductionId: string;
  readonly statement: string;
  /** Premises, each resolved to what it is and when the reader gets it. */
  readonly premises: ReadonlyArray<{
    readonly id: string;
    readonly kind: "clue" | "fact" | "deduction" | "missing";
    readonly label: string;
    /** Where the reader first has it. Null when they never do. */
    readonly availableAt: { sceneId: string; position: number } | null;
  }>;
  /** The scene by which every premise of this step is in the reader's hands. */
  readonly reachableAt: { sceneId: string; position: number } | null;
  readonly difficulty: string;
  readonly isSolution: boolean;
}

/**
 * Resolve the chain from clues to the solution.
 *
 * Depth-first with a visiting set, like the causality graph: a mystery whose
 * deductions reference each other in a circle is an authoring mistake, and it
 * must be **reported** rather than hanging the audit (docs/CAUSALITY.md).
 *
 * A step is reachable at the position of its **latest** premise: the reader
 * cannot make the deduction until they have all of it.
 */
export function resolveChain(
  architecture: MysteryArchitecture,
  facts: ReadonlyArray<{ id: unknown }>,
): { steps: readonly ChainStep[]; cycles: readonly string[] } {
  const factIds = new Set(facts.map((fact) => fact.id as string));
  const steps = new Map<string, ChainStep>();
  const visiting = new Set<string>();
  const cycles: string[] = [];

  const resolve = (deductionId: string): ChainStep | null => {
    const cached = steps.get(deductionId);
    if (cached !== undefined) return cached;
    if (visiting.has(deductionId)) {
      cycles.push(deductionId);
      return null;
    }
    const deduction = architecture.deductionById(deductionId);
    if (deduction === undefined) return null;
    visiting.add(deductionId);

    const premises: ChainStep["premises"] = deduction.premises.map((premiseId) => {
      if (premiseId.startsWith("CLUE_")) {
        const clue = architecture.clueById(premiseId);
        return clue === undefined
          ? { id: premiseId, kind: "missing" as const, label: premiseId, availableAt: null }
          : {
              id: premiseId,
              kind: "clue" as const,
              label: clue.description,
              availableAt: architecture.exposureOf(premiseId),
            };
      }
      if (premiseId.startsWith("DEDUCTION_")) {
        const nested = resolve(premiseId);
        return nested === null
          ? { id: premiseId, kind: "missing" as const, label: premiseId, availableAt: null }
          : {
              id: premiseId,
              kind: "deduction" as const,
              label: nested.statement,
              availableAt: nested.reachableAt,
            };
      }
      if (factIds.has(premiseId)) {
        // A fact is a premise the reader holds once the story has put it on the
        // page — which is a clue's job. A fact with no clue exposing it is
        // exactly the "hidden essential information" the audit looks for, so it
        // is left unavailable here rather than assumed.
        const exposing = architecture.clues.find((clue) =>
          clue.relatedFactIds.map(String).includes(premiseId),
        );
        return {
          id: premiseId,
          kind: "fact" as const,
          label: architecture.label(premiseId),
          availableAt:
            exposing === undefined ? null : architecture.exposureOf(exposing.id as string),
        };
      }
      return { id: premiseId, kind: "missing" as const, label: premiseId, availableAt: null };
    });

    // Reachable only when every premise has arrived — at the last of them.
    const positions = premises.map((premise) => premise.availableAt);
    const reachableAt = positions.some((entry) => entry === null)
      ? null
      : positions.reduce(
          (latest, entry) =>
            entry !== null && (latest === null || entry.position > latest.position)
              ? entry
              : latest,
          null as { sceneId: string; position: number } | null,
        );

    const step: ChainStep = {
      deductionId,
      statement: deduction.statement,
      premises,
      reachableAt,
      difficulty: deduction.difficulty,
      isSolution: deduction.isSolution === true,
    };
    visiting.delete(deductionId);
    steps.set(deductionId, step);
    return step;
  };

  for (const deduction of architecture.deductions) resolve(deduction.id as string);

  // In the order the reader must make them: premises before conclusions.
  const ordered = [...steps.values()].sort((a, b) => {
    const left = a.reachableAt?.position ?? Number.MAX_SAFE_INTEGER;
    const right = b.reachableAt?.position ?? Number.MAX_SAFE_INTEGER;
    return left - right || a.deductionId.localeCompare(b.deductionId);
  });

  return { steps: ordered, cycles: [...new Set(cycles)] };
}

/** The step that is the solution, when the author has marked one. */
export function solutionStep(steps: readonly ChainStep[]): ChainStep | null {
  return steps.find((step) => step.isSolution) ?? null;
}

/** Render the chain the way the specification draws it. */
export function renderChain(step: ChainStep): string {
  const lines = step.premises.map(
    (premise) =>
      `${premise.id} ${premise.label}${
        premise.availableAt === null
          ? "  [reader never gets this]"
          : `  [scene ${String(premise.availableAt.position)}]`
      }`,
  );
  return [
    ...lines.flatMap((line, index) => (index === 0 ? [line] : ["+", line])),
    "↓",
    `${step.deductionId} ${step.statement}`,
    ...(step.reachableAt === null
      ? ["(never reachable by the reader)"]
      : [`(reachable from scene ${String(step.reachableAt.position)})`]),
  ].join("\n");
}
