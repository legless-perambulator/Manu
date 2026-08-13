import { WRITER_DIR } from "@jellytind/domain";
import type {
  CharacterVoiceExample,
  CharacterVoiceProfile,
  CharacterVoiceShift,
  VoiceAttributes,
  VoiceExampleId,
  VoiceShiftId,
} from "@jellytind/domain";
import { voiceAt } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const DIR = `${WRITER_DIR}/voice`;
const PATHS = {
  profiles: `${DIR}/characters.json`,
  examples: `${DIR}/character_examples.json`,
  shifts: `${DIR}/character_shifts.json`,
} as const;

/**
 * Persistent character voices.
 *
 * Stored beside the author voice profile, in plain JSON. A voice is a record
 * about the work rather than a revision of it, so it is written straight to the
 * store — journalling "added an example line" would bury the manuscript's own
 * history (docs/CHARACTER_VOICE.md).
 */
export class CharacterVoiceStore {
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

  private nextId(existing: readonly { id: string }[], prefix: string): string {
    const highest = existing.reduce((max, item) => {
      const n = Number.parseInt(item.id.replace(`${prefix}_`, ""), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return `${prefix}_${String(highest + 1).padStart(4, "0")}`;
  }

  listProfiles(): Promise<CharacterVoiceProfile[]> {
    return this.read<CharacterVoiceProfile>(PATHS.profiles);
  }

  async getProfile(characterId: string): Promise<CharacterVoiceProfile | null> {
    return (await this.listProfiles()).find((p) => p.characterId === characterId) ?? null;
  }

  /**
   * Create or update a character's baseline voice.
   *
   * Attributes are merged, so a writer can fill in one field today and another
   * next month. Nothing forces a complete profile, and an unfilled attribute
   * stays genuinely absent rather than becoming a default nobody chose.
   */
  async setProfile(
    characterId: string,
    patch: {
      attributes?: VoiceAttributes;
      profanityTerms?: readonly string[];
      fillerTerms?: readonly string[];
      notes?: string;
    },
  ): Promise<CharacterVoiceProfile> {
    const profiles = await this.listProfiles();
    const existing = profiles.find((p) => p.characterId === characterId);
    const updated: CharacterVoiceProfile = {
      characterId,
      attributes: { ...existing?.attributes, ...patch.attributes },
      ...((patch.profanityTerms ?? existing?.profanityTerms)
        ? { profanityTerms: patch.profanityTerms ?? existing?.profanityTerms ?? [] }
        : {}),
      ...((patch.fillerTerms ?? existing?.fillerTerms)
        ? { fillerTerms: patch.fillerTerms ?? existing?.fillerTerms ?? [] }
        : {}),
      ...((patch.notes ?? existing?.notes) ? { notes: patch.notes ?? existing?.notes ?? "" } : {}),
      updatedAt: new Date().toISOString(),
    };
    await this.write(
      PATHS.profiles,
      existing === undefined
        ? [...profiles, updated]
        : profiles.map((p) => (p.characterId === characterId ? updated : p)),
    );
    return updated;
  }

  async listExamples(characterId?: string): Promise<CharacterVoiceExample[]> {
    const all = await this.read<CharacterVoiceExample>(PATHS.examples);
    return characterId === undefined ? all : all.filter((e) => e.characterId === characterId);
  }

  /** Attach a line the character says, with where it came from. */
  async addExample(input: {
    characterId: string;
    text: string;
    sceneId?: string;
    chapterId?: string;
    filePath?: string;
    note?: string;
    representative?: boolean;
  }): Promise<CharacterVoiceExample> {
    const examples = await this.read<CharacterVoiceExample>(PATHS.examples);
    const example: CharacterVoiceExample = {
      id: this.nextId(examples, "VEX") as VoiceExampleId,
      characterId: input.characterId,
      text: input.text,
      ...(input.sceneId !== undefined ? { sceneId: input.sceneId } : {}),
      ...(input.chapterId !== undefined ? { chapterId: input.chapterId } : {}),
      ...(input.filePath !== undefined ? { filePath: input.filePath } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      representative: input.representative ?? true,
      createdAt: new Date().toISOString(),
    };
    await this.write(PATHS.examples, [...examples, example]);
    return example;
  }

  async deleteExample(id: VoiceExampleId): Promise<void> {
    const examples = await this.read<CharacterVoiceExample>(PATHS.examples);
    await this.write(
      PATHS.examples,
      examples.filter((e) => e.id !== id),
    );
  }

  async listShifts(characterId?: string): Promise<CharacterVoiceShift[]> {
    const all = await this.read<CharacterVoiceShift>(PATHS.shifts);
    return characterId === undefined ? all : all.filter((s) => s.characterId === characterId);
  }

  /** Record that a voice changes from a given scene onward. */
  async addShift(input: {
    characterId: string;
    fromSceneId: string;
    description: string;
    attributes: VoiceAttributes;
  }): Promise<CharacterVoiceShift> {
    const shifts = await this.read<CharacterVoiceShift>(PATHS.shifts);
    const shift: CharacterVoiceShift = {
      id: this.nextId(shifts, "VSHIFT") as VoiceShiftId,
      characterId: input.characterId,
      fromSceneId: input.fromSceneId,
      description: input.description,
      attributes: input.attributes,
      createdAt: new Date().toISOString(),
    };
    await this.write(PATHS.shifts, [...shifts, shift]);
    return shift;
  }

  /**
   * The voice as it stands at a point in the book: baseline plus every shift
   * anchored at or before that scene. With no scene given, the voice as it ends.
   */
  async voiceAtScene(
    characterId: string,
    sceneOrder: readonly string[],
    sceneId?: string,
  ): Promise<{
    profile: CharacterVoiceProfile | null;
    attributes: VoiceAttributes;
    applied: readonly CharacterVoiceShift[];
  }> {
    const profile = await this.getProfile(characterId);
    if (profile === null) return { profile: null, attributes: {}, applied: [] };
    const shifts = await this.listShifts(characterId);
    const { attributes, applied } = voiceAt(profile, shifts, sceneOrder, sceneId);
    return { profile, attributes, applied };
  }
}
