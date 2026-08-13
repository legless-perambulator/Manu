import { formatEntityId } from "@jellytind/domain";
import type {
  Clue,
  ClueId,
  Deduction,
  DeductionId,
  Mystery,
  MysteryId,
  Suspect,
} from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const DIR = "mystery";
const PATHS = {
  mysteries: `${DIR}/mysteries.json`,
  clues: `${DIR}/clues.json`,
  deductions: `${DIR}/deductions.json`,
  suspects: `${DIR}/suspects.json`,
} as const;

/**
 * The mystery's information architecture, on disk.
 *
 * Stored in the project proper rather than under `.writer/`, because this is
 * **canon**: who did it, what each clue really means and which reasoning the
 * reader is expected to do are as authored as any character record. They travel
 * with the book, they belong in the writer's revision history, and they are the
 * thing this phase exists to make reconstructible without the prose
 * (docs/MYSTERY_ENGINE.md).
 *
 * Suspects are not entities. A suspect is a **role a character plays inside one
 * mystery** — the same person may be a suspect in one and a witness in another
 * — so the record is keyed by the pair, and deleting the mystery takes its
 * suspects with it while the character stands untouched.
 */
export class MysteryStore {
  constructor(private readonly store: ProjectStore) {}

  private async read<T>(path: string): Promise<T[]> {
    const raw = await this.store.readFile(path);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }

  private async write(path: string, items: readonly unknown[]): Promise<void> {
    await this.store.createDirectory(DIR);
    await this.store.writeFile(path, `${JSON.stringify(items, null, 2)}\n`);
  }

  // ── Mysteries ─────────────────────────────────────────────────────────────

  listMysteries(): Promise<Mystery[]> {
    return this.read<Mystery>(PATHS.mysteries);
  }

  async getMystery(id: string): Promise<Mystery | null> {
    return (await this.listMysteries()).find((entry) => (entry.id as string) === id) ?? null;
  }

  async addMystery(input: {
    name: string;
    question: string;
    solution?: string;
    culpritIds?: readonly Mystery["culpritIds"][number][];
    revealSceneId?: Mystery["revealSceneId"];
    intendedSolvableFromSceneId?: Mystery["intendedSolvableFromSceneId"];
    status?: Mystery["status"];
    notes?: string;
  }): Promise<Mystery> {
    const all = await this.listMysteries();
    const mystery: Mystery = {
      id: nextId(all, "mystery") as MysteryId,
      name: input.name,
      question: input.question,
      ...(input.solution === undefined ? {} : { solution: input.solution }),
      culpritIds: input.culpritIds ?? [],
      ...(input.revealSceneId === undefined ? {} : { revealSceneId: input.revealSceneId }),
      ...(input.intendedSolvableFromSceneId === undefined
        ? {}
        : { intendedSolvableFromSceneId: input.intendedSolvableFromSceneId }),
      status: input.status ?? "planned",
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    };
    await this.write(PATHS.mysteries, [...all, mystery]);
    return mystery;
  }

  async updateMystery(id: string, patch: Partial<Omit<Mystery, "id">>): Promise<Mystery | null> {
    const all = await this.listMysteries();
    let updated: Mystery | null = null;
    const next = all.map((entry) => {
      if ((entry.id as string) !== id) return entry;
      updated = { ...entry, ...patch, id: entry.id };
      return updated;
    });
    if (updated !== null) await this.write(PATHS.mysteries, next);
    return updated;
  }

  // ── Clues ─────────────────────────────────────────────────────────────────

  async listClues(mysteryId?: string): Promise<Clue[]> {
    const all = await this.read<Clue>(PATHS.clues);
    return mysteryId === undefined
      ? all
      : all.filter((clue) => (clue.mysteryId as string) === mysteryId);
  }

  async getClue(id: string): Promise<Clue | null> {
    return (await this.listClues()).find((clue) => (clue.id as string) === id) ?? null;
  }

  async addClue(input: {
    mysteryId: Clue["mysteryId"];
    description: string;
    kind?: Clue["kind"];
    source?: Clue["source"];
    firstAppearance?: Clue["firstAppearance"];
    readerExposure?: Clue["readerExposure"];
    visibility?: Clue["visibility"];
    characterDiscoveries?: Clue["characterDiscoveries"];
    trueMeaning?: string;
    apparentMeaning?: string;
    relatedFactIds?: Clue["relatedFactIds"];
    relatedSuspectIds?: Clue["relatedSuspectIds"];
    relatedObjectIds?: Clue["relatedObjectIds"];
    payoffSceneId?: Clue["payoffSceneId"];
    status?: Clue["status"];
    resolution?: string;
    resolvedSceneId?: Clue["resolvedSceneId"];
    notes?: string;
  }): Promise<Clue> {
    const all = await this.listClues();
    // A clue the reader meets in a scene has been exposed there, whether or not
    // the author listed it twice.
    const exposure = [...(input.readerExposure ?? [])];
    if (input.firstAppearance !== undefined && !exposure.includes(input.firstAppearance)) {
      exposure.unshift(input.firstAppearance);
    }

    const clue: Clue = {
      id: nextId(all, "clue") as ClueId,
      mysteryId: input.mysteryId,
      description: input.description,
      kind: input.kind ?? "clue",
      source: input.source ?? "observation",
      ...(input.firstAppearance === undefined ? {} : { firstAppearance: input.firstAppearance }),
      readerExposure: exposure,
      visibility: input.visibility ?? "shown",
      characterDiscoveries: input.characterDiscoveries ?? [],
      ...(input.trueMeaning === undefined ? {} : { trueMeaning: input.trueMeaning }),
      ...(input.apparentMeaning === undefined ? {} : { apparentMeaning: input.apparentMeaning }),
      relatedFactIds: input.relatedFactIds ?? [],
      relatedSuspectIds: input.relatedSuspectIds ?? [],
      relatedObjectIds: input.relatedObjectIds ?? [],
      ...(input.payoffSceneId === undefined ? {} : { payoffSceneId: input.payoffSceneId }),
      status: input.status ?? "planted",
      ...(input.resolution === undefined ? {} : { resolution: input.resolution }),
      ...(input.resolvedSceneId === undefined ? {} : { resolvedSceneId: input.resolvedSceneId }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    };
    await this.write(PATHS.clues, [...all, clue]);
    return clue;
  }

  async updateClue(
    id: string,
    patch: Partial<Omit<Clue, "id" | "mysteryId">>,
  ): Promise<Clue | null> {
    const all = await this.listClues();
    let updated: Clue | null = null;
    const next = all.map((entry) => {
      if ((entry.id as string) !== id) return entry;
      updated = { ...entry, ...patch, id: entry.id, mysteryId: entry.mysteryId };
      return updated;
    });
    if (updated !== null) await this.write(PATHS.clues, next);
    return updated;
  }

  async deleteClue(id: string): Promise<void> {
    const all = await this.listClues();
    await this.write(
      PATHS.clues,
      all.filter((clue) => (clue.id as string) !== id),
    );
  }

  // ── Deductions ────────────────────────────────────────────────────────────

  async listDeductions(mysteryId?: string): Promise<Deduction[]> {
    const all = await this.read<Deduction>(PATHS.deductions);
    return mysteryId === undefined
      ? all
      : all.filter((entry) => (entry.mysteryId as string) === mysteryId);
  }

  async addDeduction(input: {
    mysteryId: Deduction["mysteryId"];
    statement: string;
    premises: readonly string[];
    difficulty?: Deduction["difficulty"];
    yieldsFactId?: Deduction["yieldsFactId"];
    isSolution?: boolean;
    notes?: string;
  }): Promise<Deduction> {
    const all = await this.listDeductions();
    const deduction: Deduction = {
      id: nextId(all, "deduction") as DeductionId,
      mysteryId: input.mysteryId,
      statement: input.statement,
      premises: [...input.premises],
      difficulty: input.difficulty ?? "moderate",
      ...(input.yieldsFactId === undefined ? {} : { yieldsFactId: input.yieldsFactId }),
      ...(input.isSolution === true ? { isSolution: true } : {}),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
    };
    await this.write(PATHS.deductions, [...all, deduction]);
    return deduction;
  }

  async updateDeduction(
    id: string,
    patch: Partial<Omit<Deduction, "id" | "mysteryId">>,
  ): Promise<Deduction | null> {
    const all = await this.listDeductions();
    let updated: Deduction | null = null;
    const next = all.map((entry) => {
      if ((entry.id as string) !== id) return entry;
      updated = { ...entry, ...patch, id: entry.id, mysteryId: entry.mysteryId };
      return updated;
    });
    if (updated !== null) await this.write(PATHS.deductions, next);
    return updated;
  }

  async deleteDeduction(id: string): Promise<void> {
    const all = await this.listDeductions();
    await this.write(
      PATHS.deductions,
      all.filter((entry) => (entry.id as string) !== id),
    );
  }

  // ── Suspects ──────────────────────────────────────────────────────────────

  async listSuspects(mysteryId?: string): Promise<Suspect[]> {
    const all = await this.read<Suspect>(PATHS.suspects);
    return mysteryId === undefined
      ? all
      : all.filter((entry) => (entry.mysteryId as string) === mysteryId);
  }

  /** Mark a character as a suspect, or update what is recorded about them. */
  async setSuspect(input: Suspect): Promise<Suspect> {
    const all = await this.listSuspects();
    const at = all.findIndex(
      (entry) =>
        (entry.mysteryId as string) === (input.mysteryId as string) &&
        (entry.characterId as string) === (input.characterId as string),
    );
    const merged: Suspect = at === -1 ? input : { ...all[at], ...input };
    const next =
      at === -1 ? [...all, merged] : all.map((entry, index) => (index === at ? merged : entry));
    await this.write(PATHS.suspects, next);
    return merged;
  }

  async removeSuspect(mysteryId: string, characterId: string): Promise<void> {
    const all = await this.listSuspects();
    await this.write(
      PATHS.suspects,
      all.filter(
        (entry) =>
          !(
            (entry.mysteryId as string) === mysteryId &&
            (entry.characterId as string) === characterId
          ),
      ),
    );
  }
}

/** Next sequential id for a kind, from what is already stored. */
function nextId(
  existing: readonly { id: unknown }[],
  kind: "mystery" | "clue" | "deduction",
): string {
  const highest = existing.reduce((max, entry) => {
    const parts = String(entry.id).split("_");
    const n = Number.parseInt(parts[1] ?? "", 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return formatEntityId(kind, highest + 1);
}
