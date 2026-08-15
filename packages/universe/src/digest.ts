import type { StoryRepository } from "@jellytind/story-repository";
import type { Universe } from "./store";
import type { BookDigest } from "./types";

/**
 * Build a book's digest: its contribution to the universe's memory (§9, §10).
 *
 * Everything here is *end-of-book* state computed from the book's own
 * transitions and translated into canon terms through the bindings. Only
 * bound entities travel — a book-local character stays book-local (§3), and
 * book-time state ("injured after Scene 12") stays in the book (§5); the
 * digest carries what later books genuinely inherit: who knows what, where
 * relationships stand, who is alive.
 */
export async function buildBookDigest(
  repo: StoryRepository,
  universe: Universe,
  bookId: string,
  options: { summary?: string } = {},
): Promise<BookDigest> {
  const bindings = await universe.bindingsForBook(bookId);
  const canonOf = (localId: string) => bindings.get(localId)?.id ?? null;

  const timeline = await repo.getStoryTimeline();
  const lastScene = timeline.sceneOrder[timeline.sceneOrder.length - 1];
  const end = lastScene === undefined ? null : { sceneId: lastScene, position: "after" as const };

  const knowledge: Array<{ canonCharacterId: string; canonFactId: string; state: string }> = [];
  const characterStatus: Array<{ canonCharacterId: string; status: string }> = [];
  const relationships: Array<{
    canonAId: string;
    canonBId: string;
    type: string;
    status: string;
  }> = [];
  const destroyedOrLost: Array<{ canonEntityId: string; note: string }> = [];

  if (end !== null) {
    for (const character of await repo.listCharacters()) {
      const canonCharacter = canonOf(character.id as string);
      if (canonCharacter === null) continue;
      const state = timeline.characterStateAt(character.id as string, end);
      for (const known of state.knowledge) {
        const canonFact = canonOf(known.factId);
        if (canonFact === null || known.state === "unknown") continue;
        knowledge.push({
          canonCharacterId: canonCharacter,
          canonFactId: canonFact,
          state: known.state,
        });
      }
      characterStatus.push({
        canonCharacterId: canonCharacter,
        status: state.status ?? character.status ?? "active",
      });
    }

    for (const relationship of await repo.listRelationships()) {
      const canonA = canonOf(relationship.characterAId as string);
      const canonB = canonOf(relationship.characterBId as string);
      if (canonA === null || canonB === null) continue;
      const state = timeline.relationshipStateAt(
        {
          id: relationship.id as string,
          characterAId: relationship.characterAId as string,
          characterBId: relationship.characterBId as string,
          type: relationship.type,
          status: relationship.status,
        },
        end,
      );
      relationships.push({
        canonAId: canonA,
        canonBId: canonB,
        type: (state as { type?: string }).type ?? relationship.type,
        status: (state as { status?: string }).status ?? relationship.status,
      });
    }

    // Objects a later book must not quietly resurrect (§18).
    for (const object of await repo.listObjects()) {
      const canonObject = canonOf(object.id as string);
      if (canonObject === null) continue;
      const status = timeline.objectStateAt(object.id as string, end).status ?? object.status;
      if (status === "destroyed" || status === "lost") {
        destroyedOrLost.push({
          canonEntityId: canonObject,
          note: `${object.name} ends this book ${status}.`,
        });
      }
    }
  }

  // Important events: chapter titles are the deterministic skeleton; a model
  // summary can enrich this later without being required (§10).
  const chapters = [...(await repo.listChapters())].sort((a, b) => a.order - b.order);
  const importantEvents = chapters.slice(0, 40).map((chapter) => ({
    summary: chapter.title,
    chapterTitle: chapter.title,
  }));

  return {
    bookId,
    generatedAt: new Date().toISOString(),
    ...(options.summary !== undefined ? { summary: options.summary } : {}),
    knowledge,
    relationships,
    characterStatus,
    destroyedOrLost,
    importantEvents,
  };
}
