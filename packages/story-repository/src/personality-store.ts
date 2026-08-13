import { WRITER_DIR } from "@jellytind/domain";
import type { PersonalityDimension, PersonalityTrait, TraitStatus } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const DIR = `${WRITER_DIR}/characters`;
const PATH = `${DIR}/personality.json`;

/**
 * Author-confirmed personality.
 *
 * A trait is what decides behaviour under pressure — *will not leave someone
 * behind*, *cannot stand being managed* — recorded in the author's own words.
 *
 * Traits carry a status because a model may **propose** one from the
 * manuscript, and a proposal is not a fact about the character until the author
 * agrees. Only confirmed traits reach a simulation: a model's reading of Mara,
 * fed back in as Mara's personality, would make every answer agree with the
 * model's own guess (docs/SIMULATIONS.md, docs/AUTHOR_VOICE.md).
 */
export class PersonalityStore {
  constructor(private readonly store: ProjectStore) {}

  private async read(): Promise<PersonalityTrait[]> {
    const raw = await this.store.readFile(PATH);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as PersonalityTrait[]) : [];
    } catch {
      return [];
    }
  }

  private async write(traits: readonly PersonalityTrait[]): Promise<void> {
    await this.store.createDirectory(DIR);
    await this.store.writeFile(PATH, `${JSON.stringify(traits, null, 2)}\n`);
  }

  /** Every trait for a character, whatever its status. */
  async list(characterId?: string): Promise<PersonalityTrait[]> {
    const all = await this.read();
    return characterId === undefined ? all : all.filter((t) => t.characterId === characterId);
  }

  /**
   * The traits a simulation may use: confirmed only.
   *
   * Never the proposed ones, and never the rejected ones — a rejected trait is
   * the author saying *that is not who she is*, which is a stronger statement
   * than never having recorded it.
   */
  async confirmed(characterId: string): Promise<PersonalityTrait[]> {
    return (await this.list(characterId)).filter((trait) => trait.status === "confirmed");
  }

  /** Record a trait. The author's own traits are confirmed by definition. */
  async add(input: {
    characterId: string;
    dimension: PersonalityDimension;
    statement: string;
    status?: TraitStatus;
    evidence?: string;
    now?: string;
  }): Promise<PersonalityTrait> {
    const all = await this.read();
    const at = new Date().toISOString();
    const highest = all.reduce((max, trait) => {
      const n = Number.parseInt(trait.id.replace("TRAIT_", ""), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);

    const trait: PersonalityTrait = {
      id: `TRAIT_${String(highest + 1).padStart(4, "0")}`,
      characterId: input.characterId,
      dimension: input.dimension,
      statement: input.statement,
      status: input.status ?? "confirmed",
      ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
      createdAt: input.now ?? at,
      updatedAt: input.now ?? at,
    };
    await this.write([...all, trait]);
    return trait;
  }

  /** Confirm, reject, or edit a trait — the author having the last word. */
  async setStatus(
    id: string,
    status: TraitStatus,
    statement?: string,
  ): Promise<PersonalityTrait[]> {
    const all = await this.read();
    const updated = all.map((trait) =>
      trait.id === id
        ? {
            ...trait,
            status,
            ...(statement === undefined ? {} : { statement }),
            updatedAt: new Date().toISOString(),
          }
        : trait,
    );
    await this.write(updated);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const all = await this.read();
    await this.write(all.filter((trait) => trait.id !== id));
  }
}
