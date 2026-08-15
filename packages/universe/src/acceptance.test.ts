import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NodeProjectStore } from "@jellytind/persistence/node";
import { StoryRepository } from "@jellytind/story-repository";
import { Universe, universeStoreOver } from "./store";
import { buildBookDigest } from "./digest";
import { boundaryForBook, priorKnowledgeForBook, priorState, renderPriorContext } from "./context";
import { derivedAge, universeChronology } from "./chronology";
import { detectCanonConflicts, resolveConflict, runUniverseTests, universeChecks } from "./checks";
import { applyMatch, promoteToCanon, reconcileEntities } from "./reconcile";
import type { BookDigest, CanonEntity, UniverseBook } from "./types";

/**
 * Phase 41 §25 — the Blackthorn universe acceptance scenario — plus the §24
 * scale requirements and the §18 cross-book checks.
 */

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "manu-universe-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeBookRepo(folder: string, title: string): Promise<StoryRepository> {
  return StoryRepository.createProject({
    store: new NodeProjectStore(join(root, folder)),
    title,
    rootPath: join(root, folder),
  });
}

describe("§25 — the Blackthorn universe", () => {
  it("shares canon, carries state forward, holds boundaries, survives restart", async () => {
    // Universe: Blackthorn, with Book 1 and Book 2 as real repositories.
    const universeStore = universeStoreOver(new NodeProjectStore(join(root, "Blackthorn")));
    const universe = await Universe.create(universeStore, {
      name: "Blackthorn",
      description: "Two books, one manor.",
    });
    const book1 = await universe.addBook({ title: "The Vault", path: "The Vault" });
    const book2 = await universe.addBook({ title: "The Return", path: "The Return" });

    const repo1 = await makeBookRepo("Blackthorn/The Vault", "The Vault");
    const repo2 = await makeBookRepo("Blackthorn/The Return", "The Return");

    // Book 1's world: Mara, the Manor, the vault fact, Elias, a relationship.
    const mara1 = await repo1.addCharacter({ name: "Mara Ellison", aliases: ["Mara"] });
    const elias1 = await repo1.addCharacter({ name: "Elias Wren" });
    const manor1 = await repo1.addLocation({ name: "Blackthorn Manor" });
    const vault1 = await repo1.addFact({ statement: "The vault is beneath Blackthorn Manor." });
    const built1 = await repo1.addFact({ statement: "Blackthorn Manor was built in 1884." });
    const rel1 = await repo1.addRelationship({
      characterAId: mara1.id,
      characterBId: elias1.id,
      type: "allies",
      status: "wary",
    });
    void rel1;
    const chapter1 = await repo1.addChapter({ title: "The Cellar Door" });
    const scene1 = await repo1.addScene({ title: "Descent", chapterId: chapter1.id });
    await repo1.addStateTransitions([
      {
        sceneId: scene1.id as string,
        kind: "knowledge_changed",
        subjectId: mara1.id as string,
        value: vault1.id as string,
        knowledgeState: "known",
      } as never,
    ]);

    // 1–2: shared Mara and shared Manor — one canon identity, bound per book.
    const canonMara = await universe.addCanon({
      kind: "character",
      name: "Mara Ellison",
      aliases: ["Mara", "Detective Ellison"],
      birthYear: 1861,
    });
    await universe.bindCanon(canonMara.id, { bookId: book1.bookId, localId: mara1.id as string });
    const canonManor = await universe.addCanon({ kind: "location", name: "Blackthorn Manor" });
    await universe.bindCanon(canonManor.id, { bookId: book1.bookId, localId: manor1.id as string });
    const canonVault = await promoteToCanon(universe, book1.bookId, {
      localId: vault1.id as string,
      name: "The vault exists",
      kind: "fact",
      statement: "The vault is beneath Blackthorn Manor.",
    });
    const canonBuilt = await promoteToCanon(universe, book1.bookId, {
      localId: built1.id as string,
      name: "Manor construction date",
      kind: "fact",
      statement: "Blackthorn Manor was built in 1884.",
    });
    const canonElias = await promoteToCanon(universe, book1.bookId, {
      localId: elias1.id as string,
      name: "Elias Wren",
      kind: "character",
    });

    // Book 1's digest is what Book 2 inherits.
    await universe.saveDigest(
      await buildBookDigest(repo1, universe, book1.bookId, {
        summary: "Mara finds the vault beneath the manor.",
      }),
    );

    // Book 2's world, including its own Mara record and a contradicting fact.
    const mara2 = await repo2.addCharacter({ name: "Mara Ellison" });
    const built2 = await repo2.addFact({
      statement: "The house was completed in 1891.",
    });

    // 9: reconciliation matches Book 2's Mara to canon; nothing auto-merges.
    const proposals = await reconcileEntities(universe, book2.bookId, [
      { localId: mara2.id as string, localName: "Mara Ellison", kind: "character" },
      { localId: "CHAR_9999", localName: "Brand New Person", kind: "character" },
    ]);
    const match = proposals.find((held) => held.kind === "match");
    expect(match).toMatchObject({ canonId: canonMara.id, confidence: "high" });
    const fresh = proposals.find((held) => held.kind === "new");
    expect(fresh?.localName).toBe("Brand New Person");
    await applyMatch(universe, book2.bookId, {
      localId: mara2.id as string,
      localName: "Mara Ellison",
      canonId: canonMara.id,
    });
    await universe.bindCanon(canonBuilt.id, {
      bookId: book2.bookId,
      localId: built2.id as string,
    });

    // 1: same canon identity now binds both books' local records.
    const shared = await universe.getCanon(canonMara.id);
    expect(shared?.bindings.map((held) => held.bookId).sort()).toEqual([
      book1.bookId,
      book2.bookId,
    ]);

    // 3: Book 1 knowledge carries into Book 2, in Book 2's local terms where bound.
    const prior = await priorKnowledgeForBook(universe, book2.bookId);
    const carried = prior.find((held) => held.canonFactId === canonVault.id);
    expect(carried).toBeDefined();
    expect(carried?.canonCharacterId).toBe(canonMara.id);
    expect(carried?.localCharacterId).toBe(mara2.id as string);
    expect(carried?.state).toBe("known");

    // 4: Book 2 state never leaks backwards. Give Book 2 a digest with a
    // death, then ask as of Book 1: nothing of it is visible.
    const book2Digest: BookDigest = {
      bookId: book2.bookId,
      generatedAt: new Date().toISOString(),
      summary: "Mara returns; Elias dies.",
      knowledge: [{ canonCharacterId: canonMara.id, canonFactId: canonBuilt.id, state: "known" }],
      relationships: [],
      characterStatus: [{ canonCharacterId: canonElias.id, status: "deceased" }],
      destroyedOrLost: [],
      importantEvents: [],
    };
    await universe.saveDigest(book2Digest);
    const asOfBook1 = await priorState(universe, boundaryForBook(universe, book1.bookId));
    expect(asOfBook1.fromBooks).toEqual([]);
    expect(asOfBook1.knowledge).toEqual([]);
    expect(asOfBook1.characterStatus).toEqual([]);
    const book1Context = await renderPriorContext(universe, book1.bookId);
    expect(book1Context).not.toContain("Elias");
    expect(book1Context).not.toContain("deceased");

    // 5: relationship history carries forward into Book 2's context.
    const book2Context = await renderPriorContext(universe, book2.bookId);
    expect(book2Context).toContain("Relationship history");
    expect(book2Context).toContain("Mara Ellison");
    expect(book2Context).toContain("Previously:");
    expect(book2Context).toContain("vault");

    // 6: the shared timeline interleaves books and events in story order.
    await universe.addEvent({ name: "The Fire of 1870", afterStoryOrder: 0, year: 1870 });
    await universe.addEvent({ name: "The quiet decade", afterStoryOrder: 1 });
    const rows = await universeChronology(universe);
    expect(rows.map((row) => row.label)).toEqual([
      "The Fire of 1870",
      "The Vault",
      "The quiet decade",
      "The Return",
    ]);

    // 8 (§8): age derives only where the story states enough.
    expect(derivedAge(1861, 1895)).toBe(34);
    expect(derivedAge(undefined, 1895)).toBeNull();

    // 7–8 (§25): Book 2 contradicts canon, and the compiler-side check flags it.
    const conflicts = await detectCanonConflicts(universe, book2.bookId, repo2);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.canonSays).toContain("1884");
    expect(conflicts[0]?.bookSays).toContain("1891");
    await resolveConflict(
      universe,
      conflicts[0] as never,
      "explain_exception",
      "Unreliable narrator.",
    );
    const saved = await universe.listConflicts();
    expect(saved[0]?.resolution).toBe("explain_exception");

    // §19: universe story tests over the same digests.
    const aliveTest = await universe.addTest({
      description: "Mara remains alive through Book 2.",
      assertion: {
        kind: "character_alive_through",
        canonCharacterId: canonMara.id,
        throughBookId: book2.bookId,
      },
    });
    const spoilTest = await universe.addTest({
      description: "The construction date is not known before Book 1.",
      assertion: {
        kind: "fact_not_known_before",
        canonFactId: canonBuilt.id,
        beforeBookId: book1.bookId,
      },
    });
    const results = await runUniverseTests(universe, await universe.listTests());
    expect(results.find((held) => held.testId === aliveTest.id)?.outcome).toBe("pass");
    expect(results.find((held) => held.testId === spoilTest.id)?.outcome).toBe("pass");

    // §18: Elias dead in Book 2's digest — a hypothetical Book 3 repo that
    // shows him active gets flagged; Book 1 (earlier) does not.
    const book3 = await universe.addBook({ title: "The Heir", path: "The Heir" });
    const repo3 = await makeBookRepo("Blackthorn/The Heir", "The Heir");
    const elias3 = await repo3.addCharacter({ name: "Elias Wren", status: "active" });
    await universe.bindCanon(canonElias.id, {
      bookId: book3.bookId,
      localId: elias3.id as string,
    });
    const diagnostics = await universeChecks(universe, book3.bookId, repo3);
    expect(diagnostics.some((held) => held.id.startsWith("dead-then-alive:"))).toBe(true);
    const book1Diagnostics = await universeChecks(universe, book1.bookId, repo1);
    expect(book1Diagnostics).toHaveLength(0);

    // 10: the universe survives a restart — a fresh instance over the same
    // folder sees everything.
    const reopened = await Universe.open(
      universeStoreOver(new NodeProjectStore(join(root, "Blackthorn"))),
    );
    expect(reopened.name).toBe("Blackthorn");
    expect(reopened.getManifest().books).toHaveLength(3);
    const reopenedMara = await reopened.getCanon(canonMara.id);
    expect(reopenedMara?.bindings).toHaveLength(2);
    expect((await reopened.listConflicts())[0]?.resolution).toBe("explain_exception");
    expect(await reopened.getDigest(book1.bookId)).not.toBeNull();
    const reopenedContext = await renderPriorContext(reopened, book2.bookId);
    expect(reopenedContext).toContain("Previously:");
  }, 120_000);
});

describe("§24 — scale", () => {
  it("serves five books, 100+ characters and hundreds of facts from digests alone", async () => {
    // An instrumented store proves retrieval never touches a manuscript.
    const reads: string[] = [];
    const held = new Map<string, string>();
    const universe = await Universe.create(
      {
        read: (path) => {
          reads.push(path);
          return Promise.resolve(held.get(path) ?? null);
        },
        write: (path, content) => {
          held.set(path, content);
          return Promise.resolve();
        },
        list: (prefix) =>
          Promise.resolve([...held.keys()].filter((path) => path.startsWith(prefix))),
      },
      { name: "Vastness" },
    );

    const books: UniverseBook[] = [];
    for (let index = 0; index < 5; index += 1) {
      books.push(await universe.addBook({ title: `Book ${index + 1}`, path: `Book ${index + 1}` }));
    }
    const characters: CanonEntity[] = [];
    for (let index = 0; index < 110; index += 1) {
      characters.push(
        await universe.addCanon({ kind: "character", name: `Character ${index + 1}` }),
      );
    }
    const facts: CanonEntity[] = [];
    for (let index = 0; index < 400; index += 1) {
      facts.push(
        await universe.addCanon({
          kind: "fact",
          name: `Fact ${index + 1}`,
          statement: `Something true number ${index + 1}.`,
        }),
      );
    }

    // Digests simulating ~500k words of finished books (word counts are the
    // books'; the universe only ever stores their structured residue).
    for (const [index, book] of books.entries()) {
      const digest: BookDigest = {
        bookId: book.bookId,
        generatedAt: new Date().toISOString(),
        summary: `Around ${100_000 + index * 5_000} words of consequences, condensed.`,
        knowledge: facts.slice(index * 60, index * 60 + 60).map((fact, factIndex) => ({
          canonCharacterId: (
            characters[(index * 13 + factIndex) % characters.length] as { id: string }
          ).id,
          canonFactId: fact.id,
          state: "known",
        })),
        relationships: characters.slice(0, 30).map((character, characterIndex) => ({
          canonAId: character.id,
          canonBId: (characters[(characterIndex + 1) % characters.length] as { id: string }).id,
          type: "knows",
          status: "steady",
        })),
        characterStatus: characters.slice(0, 100).map((character) => ({
          canonCharacterId: character.id,
          status: "active",
        })),
        destroyedOrLost: [],
        importantEvents: Array.from({ length: 20 }, (_, eventIndex) => ({
          summary: `Book ${index + 1}, notable event ${eventIndex + 1}`,
        })),
      };
      await universe.saveDigest(digest);
    }

    reads.length = 0;
    const state = await priorState(universe, { upToReadingOrder: 5 });
    expect(state.fromBooks).toHaveLength(4);
    expect(state.knowledge.length).toBeGreaterThan(200);

    // Retrieval read only digests — never a chapter, never a manuscript.
    expect(reads.every((path) => path.startsWith(".universe/memory/"))).toBe(true);
    expect(reads.length).toBeLessThanOrEqual(6); // One read per candidate digest.
  });
});
