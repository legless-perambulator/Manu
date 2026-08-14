import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "./story-repository";

/**
 * One mystery, shared by every temporal-leakage test.
 *
 * A setup in chapter one and a reveal in chapter three. The audit treated
 * future leakage as critical and could not test it, so this is the permanent
 * guard — and it is exported from the package for the same reason the Story
 * Compiler exports its broken novel: the reader simulator, the character
 * simulator and the repository must all be checked against *the same story*,
 * or the three guards drift apart and stop meaning the same thing.
 *
 * Two disciplines make the tests built on it worth anything:
 *
 * - **A distinctive token.** The reveal chapter's prose contains
 *   `ZEPHYRSECRET`, which appears nowhere else, so a leak of any size is a
 *   substring search rather than a judgement call.
 * - **A positive control.** Every "must not contain" case is paired with a
 *   check that the same query *does* return the material at the later point.
 *   Otherwise a fixture that silently recorded nothing would pass every
 *   assertion while proving nothing.
 */

/** Appears in the reveal chapter and nowhere else, so a leak is greppable. */
export const REVEAL_TOKEN = "ZEPHYRSECRET";

export async function leakageFixture() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Reveal" });

  const ch1 = await repo.addChapter({ title: "The Setup" });
  const ch2 = await repo.addChapter({ title: "The Middle" });
  const ch3 = await repo.addChapter({ title: "The Reveal" });

  const mara = await repo.addCharacter({ name: "Mara" });
  const elias = await repo.addCharacter({ name: "Elias" });
  const manor = await repo.addLocation({ name: "Manor" });
  const cellar = await repo.addLocation({ name: "Cellar" });
  const knife = await repo.addObject({ name: "Letter opener" });
  const thread = await repo.addPlotThread({ name: "Who killed the steward" });

  // The thing a first-time reader must not know at chapter one.
  const culprit = await repo.addFact({ statement: "Elias killed the steward." });
  const early = await repo.addFact({ statement: "The steward is missing." });

  const relationship = await repo.addRelationship({
    characterAId: mara.id,
    characterBId: elias.id,
    type: "ally",
  });

  const s1 = await repo.addScene({
    title: "The disappearance",
    chapterId: ch1.id,
    locationId: manor.id,
    characterIds: [mara.id, elias.id],
    objectIds: [knife.id],
    plotThreadIds: [thread.id],
  });
  const s2 = await repo.addScene({
    title: "Questions",
    chapterId: ch2.id,
    locationId: manor.id,
    characterIds: [mara.id, elias.id],
  });
  const s3 = await repo.addScene({
    title: "The cellar",
    chapterId: ch3.id,
    locationId: cellar.id,
    characterIds: [mara.id, elias.id],
    objectIds: [knife.id],
    plotThreadIds: [thread.id],
    // The reveal scene names the fact it reveals.
    factIds: [culprit.id],
  });

  // Chapter one establishes only what chapter one knows.
  await repo.addStateTransitions([
    {
      sceneId: s1.id,
      kind: "fact_established",
      subjectId: early.id as string,
      value: early.id as string,
    },
    {
      sceneId: s1.id,
      kind: "knowledge_changed",
      subjectId: mara.id,
      value: early.id as string,
      knowledgeState: "known",
    },
    { sceneId: s1.id, kind: "object_location", subjectId: knife.id, value: manor.id },
  ]);

  // Everything the reveal changes happens in chapter three.
  await repo.addStateTransitions([
    {
      sceneId: s3.id,
      kind: "fact_established",
      subjectId: culprit.id as string,
      value: culprit.id as string,
    },
    {
      sceneId: s3.id,
      kind: "knowledge_changed",
      subjectId: mara.id,
      value: culprit.id as string,
      knowledgeState: "known",
    },
    {
      sceneId: s3.id,
      kind: "relationship_type",
      subjectId: relationship.id as string,
      value: "enemy",
    },
    { sceneId: s3.id, kind: "object_location", subjectId: knife.id, value: cellar.id },
    { sceneId: s3.id, kind: "character_status", subjectId: elias.id, value: "deceased" },
  ]);

  // Prose goes *below* the front matter a chapter file carries. Replacing the
  // whole file would delete the chapter record along with it.
  const prose = (chapter: { id: unknown; title: string; filePath: string }, text: string) =>
    repo.writeProjectFile(
      chapter.filePath,
      `---\nid: ${String(chapter.id)}\ntitle: ${chapter.title}\n---\n\n${text}\n`,
    );

  await prose(ch1, "The steward did not come down to dinner.");
  await prose(ch2, "Mara asked her questions.");
  await prose(ch3, `In the cellar she found it: ${REVEAL_TOKEN}, and Elias's face went white.`);

  return {
    repo,
    ch1,
    ch3,
    mara,
    elias,
    manor,
    cellar,
    knife,
    relationship,
    culprit,
    early,
    s1,
    s2,
    s3,
  };
}
