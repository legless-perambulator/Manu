import { WRITER_DIR } from "@jellytind/domain";
import type { ReaderProfile } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import { ReaderError } from "./types";

/**
 * The readers Manu ships with.
 *
 * A profile is a short list of **traits**, not a persona to act out. What a
 * reader notices is what makes their answers differ: a genre expert spots the
 * shape of a mystery three chapters before a casual reader feels anything is
 * wrong, and both are useful answers about the same pages
 * (docs/SIMULATIONS.md).
 */
export const GENRE_EXPERT: ReaderProfile = {
  id: "genre_expert",
  name: "Genre Expert",
  description:
    "Has read hundreds of these. Recognises structure early, and is hard to surprise with a familiar move.",
  traits: [
    "recognises genre conventions and where a story is standing in them",
    "notices a planted detail as a plant, and says so",
    "predicts confidently, and is annoyed when a prediction is too easy",
    "forgives slow prose if the structure is doing something",
    "suspicious of the character the text is being kind to",
  ],
};

export const CASUAL_READER: ReaderProfile = {
  id: "casual_reader",
  name: "Casual Reader",
  description:
    "Reads for the story, in the evenings, a chapter or two at a time. Puts a book down when it stops being enjoyable.",
  traits: [
    "follows what is on the page and does not look for structure",
    "loses track of names and needs reminding",
    "notices when a chapter is hard work",
    "predicts rarely, and mostly about what a character will do next",
    "stops caring when confused for too long",
  ],
};

export const EMOTION_FOCUSED: ReaderProfile = {
  id: "emotion_focused",
  name: "Emotion-Focused Reader",
  description:
    "Reads for the people. Remembers how a scene felt long after forgetting what happened in it.",
  traits: [
    "tracks how characters feel and how they treat each other",
    "attaches strongly, and quickly",
    "remembers gestures, silences and small cruelties",
    "forgives plot problems if the feeling is true",
    "loses interest when nobody in the scene wants anything",
  ],
};

export const CRITICAL_DEVELOPMENTAL: ReaderProfile = {
  id: "critical_developmental",
  name: "Critical Developmental Reader",
  description:
    "Reads the way an editor reads: sceptically, asking what each chapter is doing and whether it earns its place.",
  traits: [
    "asks what a chapter is for, and notices when it is doing nothing",
    "tracks promises the book has made and has not kept",
    "flags coincidence, convenient timing and unearned change",
    "distrusts a character being interesting instead of consistent",
    "will say plainly when a chapter bored them",
  ],
};

export const BUILT_IN_PROFILES: readonly ReaderProfile[] = [
  GENRE_EXPERT,
  CASUAL_READER,
  EMOTION_FOCUSED,
  CRITICAL_DEVELOPMENTAL,
];

export const CUSTOM_PROFILES_DIR = `${WRITER_DIR}/readers/profiles`;

export function profileById(id: string, extra: readonly ReaderProfile[] = []): ReaderProfile {
  const found = [...BUILT_IN_PROFILES, ...extra].find((profile) => profile.id === id);
  if (found === undefined) {
    throw new ReaderError("unknown_profile", `No reader profile with id "${id}".`, {
      details: { profile: id },
    });
  }
  return found;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Turn one file's contents into a profile, or explain why it cannot be one. */
export function parseProfile(raw: string, where: string): ReaderProfile {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (cause) {
    throw new ReaderError("invalid_profile", `${where}: not valid JSON.`, { cause });
  }

  const id = text(parsed.id);
  const name = text(parsed.name);
  if (id === "") throw new ReaderError("invalid_profile", `${where}: "id" is required.`);
  if (name === "") throw new ReaderError("invalid_profile", `${where}: "name" is required.`);
  if (BUILT_IN_PROFILES.some((profile) => profile.id === id)) {
    throw new ReaderError(
      "invalid_profile",
      `${where}: "${id}" is the id of a reader Manu ships with. Choose another.`,
    );
  }
  const traits = Array.isArray(parsed.traits)
    ? parsed.traits.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
      )
    : [];
  if (traits.length === 0) {
    throw new ReaderError(
      "invalid_profile",
      `${where}: "traits" must list at least one trait — traits are what makes this reader different.`,
    );
  }

  return { id, name, description: text(parsed.description), traits, custom: true };
}

export interface LoadedProfiles {
  readonly profiles: readonly ReaderProfile[];
  /** Files that could not be loaded, each with the reason. Never silent. */
  readonly problems: ReadonlyArray<{ path: string; reason: string }>;
}

/** Readers a writer has defined for this project. */
export async function loadCustomProfiles(repo: StoryRepository): Promise<LoadedProfiles> {
  const paths = (await repo.listProjectFiles(CUSTOM_PROFILES_DIR)).filter((path) =>
    path.endsWith(".json"),
  );
  const profiles: ReaderProfile[] = [];
  const problems: Array<{ path: string; reason: string }> = [];

  for (const path of paths.sort()) {
    const raw = await repo.readProjectFile(path);
    if (raw === null) continue;
    try {
      profiles.push(parseProfile(raw, path));
    } catch (cause) {
      problems.push({ path, reason: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return { profiles, problems };
}

/** Write a reader into the project, where it travels with the book. */
export async function saveCustomProfile(
  repo: StoryRepository,
  profile: { id: string; name: string; description?: string; traits: readonly string[] },
): Promise<ReaderProfile> {
  const body = `${JSON.stringify(profile, null, 2)}\n`;
  const path = `${CUSTOM_PROFILES_DIR}/${profile.id}.json`;
  // Parsed before it is written: an unusable profile never reaches the project.
  const parsed = parseProfile(body, path);
  await repo.createDirectory(CUSTOM_PROFILES_DIR);
  await repo.writeProjectFile(path, body);
  return parsed;
}
