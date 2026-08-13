import type { Character } from "@jellytind/domain";
import { PRIORITY, type Candidate } from "../candidate";
import type { ProjectReader } from "../reader";
import { stripFrontmatter } from "../render";
import { gatherSceneInspection } from "./scene-inspection";
import { byId, provenance, readSnapshot, type ProjectSnapshot } from "./shared";
import { voiceCandidates } from "./voice";
import { characterVoiceCandidates } from "./character-voice";

/** Where authored style material lives in a project (docs/STORY_REPOSITORY.md). */
const STYLE_DIR = "style";
const EXAMPLES_DIR = "style/examples";

/**
 * **Scene Rewrite** — everything Scene Inspection gathers, plus the material a
 * rewrite must not violate: the author's style rules and the voice of the
 * characters who speak in the scene.
 *
 * Rewriting is a superset of inspecting, so this recipe *composes* Scene
 * Inspection rather than restating it. That is the point of having separate
 * recipes: the extra cost of style and voice material is paid only when the task
 * actually calls for it.
 *
 * Voice material is found deterministically — a `style/examples/` file is voice
 * material for a character when its path names the character's ID or name — and
 * the character's own `notes` field, which is where a writer records voice, is
 * carried by the character rendering already gathered by Scene Inspection.
 */
export async function gatherSceneRewrite(
  reader: ProjectReader,
  sceneId: string,
  snapshot?: ProjectSnapshot,
): Promise<{ candidates: Candidate[]; snapshot: ProjectSnapshot }> {
  const snap = snapshot ?? (await readSnapshot(reader));
  const inspection = await gatherSceneInspection(reader, sceneId, snap);
  const { scene } = inspection;
  const candidates = [...inspection.candidates];

  const files = await reader.listProjectFiles(STYLE_DIR);
  const styleFiles = files.filter((path) => !path.startsWith(`${EXAMPLES_DIR}/`)).sort();
  const exampleFiles = files.filter((path) => path.startsWith(`${EXAMPLES_DIR}/`)).sort();

  for (const path of styleFiles) {
    const text = await readProse(reader, path);
    if (text === null) continue;
    candidates.push({
      id: path,
      kind: "file",
      label: path.slice(STYLE_DIR.length + 1),
      section: "styleRules",
      priority: PRIORITY.style,
      provenance: provenance(
        "style_rule",
        `author style material, which a rewrite of ${scene.id} must respect`,
        [scene.id],
      ),
      full: text,
    });
  }

  // The author's own voice profile, retrieved for this operation only.
  candidates.push(
    ...(await voiceCandidates(reader, {
      operation: "rewrite_scene",
      ...(scene.pov !== undefined ? { povCharacterId: scene.pov as string } : {}),
      relatedIds: [scene.id],
    })),
  );

  // How each person in this scene speaks — recorded, not described.
  {
    const speaking = [
      ...(scene.pov !== undefined ? [scene.pov as string] : []),
      ...scene.characterIds.filter((id) => id !== scene.pov),
    ]
      .map((id) => byId(snap.characters, id))
      .filter((c): c is Character => c !== undefined);
    candidates.push(
      ...(await characterVoiceCandidates(reader, {
        characters: speaking,
        ...(scene.pov !== undefined ? { povId: scene.pov as string } : {}),
        sceneId: scene.id,
        relatedIds: [scene.id],
      })),
    );
  }

  // Voice material for the POV character first, then the other participants.
  const speakers = [
    ...(scene.pov !== undefined ? [scene.pov as string] : []),
    ...scene.characterIds.filter((id) => id !== scene.pov),
  ];
  for (const [index, id] of speakers.entries()) {
    const character = byId(snap.characters, id);
    if (character === undefined) continue;
    for (const path of exampleFiles.filter((p) => mentionsCharacter(p, character))) {
      const text = await readProse(reader, path);
      if (text === null) continue;
      candidates.push({
        id: path,
        kind: "file",
        label: `${character.name} — ${path.slice(EXAMPLES_DIR.length + 1)}`,
        section: "styleRules",
        priority: PRIORITY.style + 1 + index,
        provenance: provenance(
          "character_voice",
          `voice material for ${character.id}, who ${
            character.id === scene.pov ? "narrates" : "speaks in"
          } ${scene.id}`,
          [scene.id, character.id],
        ),
        full: text,
      });
    }
  }

  return { candidates, snapshot: snap };
}

/** A style example belongs to a character when its path names their ID or name. */
function mentionsCharacter(path: string, character: Character): boolean {
  const name = path.slice(EXAMPLES_DIR.length + 1).toLowerCase();
  return name.includes(character.id.toLowerCase()) || name.includes(character.name.toLowerCase());
}

async function readProse(reader: ProjectReader, path: string): Promise<string | null> {
  const raw = await reader.readProjectFile(path);
  if (raw === null) return null;
  const text = stripFrontmatter(raw).trim();
  return text === "" ? null : text;
}
