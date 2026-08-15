import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NodeProjectStore } from "@jellytind/persistence/node";
import { StoryRepository } from "@jellytind/story-repository";
import {
  exportDocx,
  exportEpub,
  exportMarkdown,
  exportPdf,
  exportPlainText,
  importDocx,
  buildProjectArchive,
  readProjectArchive,
  leaksInternalData,
  previewOf,
  toExportManuscript,
  STANDARD_MANUSCRIPT,
  type ExportManuscript,
} from "@jellytind/manuscript-io";
import { nodeInflate } from "@jellytind/manuscript-io/node";
import { StoryMapper, type MappingStorePort } from "./pipeline";
import { writeChapterBody } from "./chapters";
import { acceptWhere, applyProposals, resolveAlias, reviewSummary } from "./review";
import { MAX_EXCERPT_CHARS, type MappingAnalyst } from "./analyst";
import type { MappingSourceChapter } from "./types";

/**
 * Phase 40 acceptance: §41 (import → map → review → build → reopen),
 * §42 (export without leaks, archive round-trip) and §43 (scale).
 */

// ── The fixture novel (§41): 20 chapters, POVs, aliases, places, objects ──

const POVS = ["Mara Ellison", "Elias Wren"] as const;

function fixtureChapter(index: number): string {
  const pov = POVS[index % 2] as string;
  const other = POVS[(index + 1) % 2] as string;
  const paragraphs: string[] = [];
  paragraphs.push(
    `${pov} crossed the hall toward the Library at Blackthorn Manor, thinking of ${other}.`,
  );
  paragraphs.push(
    `"You are late again," said ${pov.split(" ")[0] as string}. "The photograph is missing."`,
  );
  paragraphs.push(
    `Detective Ellison had seen the cellar door before. Marcus Webb watched from the West Wing, and Mara said nothing at all.`,
  );
  paragraphs.push(
    `${other} took the photograph and hid the photograph beneath a floorboard. Later Iris found the watch near the Cellar, and Elias held the watch to the light.`,
  );
  paragraphs.push(`"We should never have come back to Blackthorn Manor," Marcus said.`);
  paragraphs.push(
    `Mara Vance arrived from the village after dark, asking for Mara by name, which confused everyone at the Manor.`,
  );
  // Pad each chapter with distinct filler prose.
  for (let p = 0; p < 8; p += 1) {
    paragraphs.push(
      `The evening settled over the grounds while chapter ${index + 1} pressed on, and the house kept its own counsel about what had happened in the years before anyone now living had walked its corridors.`,
    );
  }
  // An explicit scene break in every chapter, for §5's detection.
  paragraphs.splice(4, 0, "* * *");
  return paragraphs.join("\n\n");
}

function fixtureManuscript(): ExportManuscript {
  return {
    title: "The Blackthorn Inheritance",
    author: "P. Larkin",
    chapters: Array.from({ length: 20 }, (_, index) => ({
      title: `Chapter ${index + 1}`,
      markdown: fixtureChapter(index),
    })),
  };
}

/** A mock analyst: canned semantic findings for the first chapters only. */
const mockAnalyst: MappingAnalyst = {
  analyse(kind, excerpt) {
    if (excerpt.chapterIndex > 1) return Promise.resolve([]);
    switch (kind) {
      case "facts":
        return Promise.resolve([
          {
            summary: "The vault is beneath Blackthorn Manor.",
            confidence: "high" as const,
            quote: "the cellar door",
            payload: { statement: "The vault is beneath Blackthorn Manor." },
          },
        ]);
      case "knowledge":
        return Promise.resolve([
          {
            summary: "Mara Ellison learns the vault exists",
            confidence: "medium" as const,
            payload: {
              character: "Mara Ellison",
              fact: "The vault is beneath Blackthorn Manor.",
              state: "known",
            },
          },
        ]);
      case "relationships":
        return Promise.resolve([
          {
            summary: "Mara Ellison and Elias Wren work the case together",
            confidence: "medium" as const,
            payload: { a: "Mara Ellison", b: "Elias Wren", type: "allies" },
          },
        ]);
      case "threads":
        return Promise.resolve([
          {
            summary: "The missing photograph",
            confidence: "high" as const,
            payload: { name: "Missing Photograph" },
          },
        ]);
      case "timeline":
        return Promise.resolve([
          {
            summary: "The years before anyone now living — a past-time reference",
            confidence: "low" as const,
            payload: { kind: "flashback" },
          },
        ]);
      default:
        return Promise.resolve([]);
    }
  },
};

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "manu-mapping-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

async function importedProject(dir: string): Promise<{
  repo: StoryRepository;
  source: MappingSourceChapter[];
}> {
  // 1–2: a real DOCX, produced by our writer, imported by our reader.
  const docx = exportDocx(fixtureManuscript(), {
    ...STANDARD_MANUSCRIPT,
    includeTitlePage: false,
  });
  const imported = await importDocx(docx, nodeInflate);
  expect(imported.chapters).toHaveLength(20);
  const preview = previewOf(imported);
  expect(preview.words).toBeGreaterThan(1000);

  // The import creates a fresh project; the source file is never touched (§2).
  const store = new NodeProjectStore(dir);
  const repo = await StoryRepository.createProject({
    store,
    title: imported.title ?? "Imported manuscript",
    rootPath: dir,
  });
  const source: MappingSourceChapter[] = [];
  for (const [index, chapter] of imported.chapters.entries()) {
    const record = await repo.addChapter({ title: chapter.title });
    await writeChapterBody(repo, record.filePath, chapter.markdown);
    source.push({
      index,
      chapterId: record.id as string,
      title: chapter.title,
      text: chapter.markdown,
    });
  }
  await repo.writeProjectFile(
    ".writer/import/provenance.json",
    JSON.stringify({
      fileName: "the-blackthorn-inheritance.docx",
      format: "docx",
      importedAt: new Date().toISOString(),
      words: imported.words,
      chapterCount: imported.chapters.length,
    }),
  );
  return { repo, source };
}

function storeOver(repo: StoryRepository): MappingStorePort {
  return {
    read: (path) => repo.readProjectFile(path),
    write: (path, content) => repo.writeProjectFile(path, content),
  };
}

describe("§41 — the import acceptance scenario", () => {
  it("imports, maps, reviews, builds and reopens", async () => {
    const dir = join(root, "novel");
    const { repo, source } = await importedProject(dir);

    const mapper = new StoryMapper({ source, store: storeOver(repo), analyst: mockAnalyst });
    const scope = mapper.scope();
    expect(scope.chapters).toBe(20);
    expect(scope.estimatedOperations).toBeGreaterThan(20); // §29: shown up front.

    await mapper.start();
    const run = await mapper.runToCompletion();
    expect(run.status).toBe("completed");
    let proposals = [...(await mapper.proposals())];

    // 3: scene detection proposed from explicit breaks, not forced.
    const scenes = proposals.filter((held) => held.category === "scene");
    expect(scenes.length).toBe(20);
    expect(scenes.every((held) => held.status === "proposed")).toBe(true);

    // 4–5: characters extracted, aliases resolved to one owner.
    const characters = proposals.filter((held) => held.category === "character");
    const names = characters.map((held) => String(held.payload["name"]));
    expect(names).toContain("Mara Ellison");
    expect(names).toContain("Elias Wren");
    expect(names).toContain("Marcus Webb");
    expect(names).not.toContain("Detective Ellison"); // An alias, not a person.
    const resolved = proposals.find((held) => held.id === "alias:Detective Ellison→Mara Ellison");
    expect(resolved?.confidence).toBe("high");

    // 11/§41.13: "Mara" is genuinely ambiguous (Ellison vs Vance) — review.
    const ambiguous = proposals.find(
      (held) => held.category === "alias" && held.status === "needs_review",
    );
    expect(ambiguous).toBeDefined();
    expect(ambiguous?.summary).toContain("Mara");

    // 6: locations, with only *stated* hierarchy.
    const locations = proposals.filter((held) => held.category === "location");
    expect(locations.some((held) => String(held.payload["name"]) === "Blackthorn Manor")).toBe(
      true,
    );
    const hierarchy = locations.find((held) => held.payload["parent"] !== undefined);
    expect(hierarchy?.status).toBe("needs_review");

    // 7: the photograph matters; no entity for every cup and chair.
    const objects = proposals.filter((held) => held.category === "object");
    expect(objects.some((held) => String(held.payload["name"]) === "photograph")).toBe(true);
    expect(objects.every((held) => held.status === "needs_review")).toBe(true);

    // 8–11: semantic proposals arrived with evidence and confidence.
    expect(proposals.some((held) => held.category === "timeline")).toBe(true);
    expect(proposals.some((held) => held.category === "knowledge")).toBe(true);
    expect(proposals.some((held) => held.category === "relationship")).toBe(true);
    expect(proposals.some((held) => held.category === "thread")).toBe(true);
    for (const held of proposals.filter((p) => p.origin === "model")) {
      expect(held.evidence.length).toBeGreaterThan(0);
      expect(["low", "medium", "high"]).toContain(held.confidence);
    }

    // 12: the review summary reads like the workspace mock-up.
    const summary = reviewSummary(proposals);
    const characterRow = summary.find((row) => row.category === "character");
    expect((characterRow?.proposed ?? 0) + (characterRow?.needsReview ?? 0)).toBeGreaterThan(2);

    // 13: the writer corrects the ambiguity, then batch-accepts (§26).
    proposals = resolveAlias(proposals, (ambiguous as { id: string }).id, "Mara Ellison");
    proposals = acceptWhere(proposals, { category: "character", minConfidence: "medium" });
    proposals = acceptWhere(proposals, { category: "alias", minConfidence: "high" });
    proposals = acceptWhere(proposals, { category: "location", minConfidence: "medium" });
    proposals = acceptWhere(proposals, {
      category: "object",
      minConfidence: "low",
      includeNeedsReview: true,
    });
    proposals = acceptWhere(proposals, { category: "scene", minConfidence: "high" });
    proposals = acceptWhere(proposals, { category: "fact", minConfidence: "medium" });
    proposals = acceptWhere(proposals, { category: "thread", minConfidence: "medium" });
    proposals = acceptWhere(proposals, { category: "relationship", minConfidence: "medium" });
    proposals = acceptWhere(proposals, { category: "knowledge", minConfidence: "medium" });
    proposals = acceptWhere(proposals, { category: "importance", minConfidence: "medium" });

    const applied = await applyProposals(repo, proposals);
    expect(applied.created["characters"]).toBeGreaterThanOrEqual(3);
    expect(applied.created["locations"]).toBeGreaterThanOrEqual(1);
    expect(applied.created["objects"]).toBeGreaterThanOrEqual(1);
    expect(applied.created["scenes"]).toBeGreaterThanOrEqual(20);
    expect(applied.created["facts"]).toBe(1);
    expect(applied.created["threads"]).toBe(1);
    expect(applied.created["relationships"]).toBe(1);
    expect(applied.created["knowledge transitions"]).toBeGreaterThanOrEqual(1);

    // Model facts land provisional, model transitions land proposed (§14, §16).
    const facts = await repo.listFacts();
    expect(facts[0]?.status).toBe("provisional");
    const transitions = await repo.listStateTransitions();
    const knowledge = transitions.filter((held) => held.kind === "knowledge_changed");
    expect(knowledge.every((held) => held.confirmationStatus === "proposed")).toBe(true);

    // The mapped character carries its aliases (§11).
    const mara = (await repo.listCharacters()).find((held) => held.name === "Mara Ellison");
    expect(mara?.aliases).toContain("Detective Ellison");
    expect(mara?.aliases).toContain("Mara");

    // 14: the same Story Build a native project gets, over mapped data.
    const build = await repo.buildStory();
    expect(build.diagnostics).toBeDefined();
    expect((await repo.listScenes()).length).toBeGreaterThanOrEqual(40);

    // 15: reopen from disk — mapping and structure intact.
    const reopened = await StoryRepository.openProject({
      store: new NodeProjectStore(dir),
      rootPath: dir,
    });
    expect((await reopened.listCharacters()).some((held) => held.name === "Mara Ellison")).toBe(
      true,
    );
    const persisted = await reopened.readProjectFile(".writer/mapping/proposals.json");
    expect(persisted).not.toBeNull();
  }, 120_000);

  it("pauses, survives a restart, and resumes (§27)", async () => {
    const dir = join(root, "resume");
    const { repo, source } = await importedProject(dir);
    const mapper = new StoryMapper({ source, store: storeOver(repo), analyst: mockAnalyst });
    await mapper.start();
    await mapper.advance();
    await mapper.advance();
    await mapper.pause();

    // A fresh mapper over the same store: exactly where it left off.
    const resumed = new StoryMapper({ source, store: storeOver(repo), analyst: mockAnalyst });
    const before = await resumed.load();
    expect(before?.status).toBe("paused");
    const doneSteps = before?.steps.filter((step) => step.status === "done").length ?? 0;
    expect(doneSteps).toBeGreaterThanOrEqual(2);
    await resumed.start();
    const run = await resumed.runToCompletion();
    expect(run.status).toBe("completed");
  }, 60_000);

  it("skips semantic steps with a stated reason when no model is configured", async () => {
    const dir = join(root, "nomodel");
    const { repo, source } = await importedProject(dir);
    const mapper = new StoryMapper({ source, store: storeOver(repo) });
    await mapper.start();
    const run = await mapper.runToCompletion();
    expect(run.status).toBe("completed");
    const skipped = run.steps.filter((step) => step.status === "skipped");
    expect(skipped.length).toBeGreaterThan(3);
    expect(skipped[0]?.note).toContain("No model configured");
    // Deterministic extraction still happened.
    expect((await mapper.proposals()).some((held) => held.category === "character")).toBe(true);
  }, 60_000);
});

describe("§42 — the export acceptance scenario", () => {
  it("exports every format cleanly and round-trips the project archive", async () => {
    const dir = join(root, "exporting");
    const { repo, source } = await importedProject(dir);
    // Map + apply scenes so chapter files carry internal scene markers —
    // the exact data that must never leak.
    const mapper = new StoryMapper({ source, store: storeOver(repo) });
    await mapper.start();
    await mapper.runToCompletion();
    let proposals = [...(await mapper.proposals())];
    proposals = acceptWhere(proposals, { category: "scene", minConfidence: "high" });
    await applyProposals(repo, proposals);

    const chapters = [...(await repo.listChapters())].sort((a, b) => a.order - b.order);
    const raws: Array<{ title: string; raw: string }> = [];
    for (const chapter of chapters) {
      raws.push({
        title: chapter.title,
        raw: (await repo.readProjectFile(chapter.filePath)) ?? "",
      });
    }
    expect(raws.some((held) => held.raw.includes("<!-- scene:"))).toBe(true);

    const manuscript = toExportManuscript(repo.project.title, "P. Larkin", raws);

    // 1–4, 6: every format, no internal metadata anywhere.
    const outputs = [
      new TextDecoder().decode(exportDocx(manuscript, STANDARD_MANUSCRIPT)),
      new TextDecoder().decode(exportEpub(manuscript)),
      new TextDecoder().decode(exportPdf(manuscript, STANDARD_MANUSCRIPT)),
      exportMarkdown(manuscript),
      exportPlainText(manuscript),
    ];
    for (const output of outputs) {
      expect(leaksInternalData(output)).toBe(false);
      expect(output).toContain("photograph");
    }

    // 5, 7–8: the archive round-trips into a working project (§40).
    const paths = await repo.listProjectFiles();
    const files: Array<{ path: string; content: string }> = [];
    for (const path of paths) {
      const content = await repo.readProjectFile(path);
      if (content !== null) files.push({ path, content });
    }
    const archive = buildProjectArchive(files);
    const unpacked = await readProjectArchive(archive, nodeInflate);
    expect(unpacked.problems).toEqual([]);

    const restoredDir = join(root, "restored");
    const restoredStore = new NodeProjectStore(restoredDir);
    for (const file of unpacked.files) {
      await restoredStore.writeFile(file.path, file.content);
    }
    const restored = await StoryRepository.openProject({
      store: restoredStore,
      rootPath: restoredDir,
    });
    expect(restored.project.title).toBe(repo.project.title);
    const restoredChapters = [...(await restored.listChapters())].sort((a, b) => a.order - b.order);
    expect(restoredChapters).toHaveLength(chapters.length);
    for (const [index, chapter] of restoredChapters.entries()) {
      const original = await repo.readProjectFile(
        (chapters[index] as { filePath: string }).filePath,
      );
      const roundTripped = await restored.readProjectFile(chapter.filePath);
      expect(roundTripped).toBe(original);
    }
  }, 120_000);
});

describe("§43 — scale", () => {
  it("maps a 150k-word, 40-chapter, 200-scene, 100-entity manuscript in bounded excerpts", async () => {
    const firsts = ["Al", "Bren", "Cor", "Dun", "El", "Fen", "Gar", "Hol", "Ir", "Jas"];
    const seconds = ["wick", "dale", "ric", "ton", "by", "mund", "field", "ley", "ard", "row"];
    const names = Array.from(
      { length: 100 },
      (_, index) =>
        `${firsts[index % 10] as string}${seconds[Math.floor(index / 10)] as string} Holloway`,
    );
    const chapters: MappingSourceChapter[] = Array.from({ length: 40 }, (_, index) => {
      const paragraphs: string[] = [];
      for (let scene = 0; scene < 5; scene += 1) {
        for (let p = 0; p < 24; p += 1) {
          const name = names[(index * 5 + scene * 3 + p) % names.length] as string;
          paragraphs.push(
            `${name} walked the long gallery again while the evening light failed over the estate, and ` +
              `"we are not done here," said ${name.split(" ")[0] as string}, thinking about everything that had happened since the morning the letters arrived and the household began to change in ways nobody had been willing to name aloud.`,
          );
        }
        if (scene < 4) paragraphs.push("* * *");
      }
      return {
        index,
        chapterId: `CHAPTER_${String(index + 1).padStart(4, "0")}`,
        title: `Chapter ${index + 1}`,
        text: paragraphs.join("\n\n"),
      };
    });

    const words = chapters.reduce((sum, chapter) => sum + chapter.text.split(/\s+/).length, 0);
    expect(words).toBeGreaterThan(150_000);

    // A counting analyst proves no call ever sees the whole manuscript.
    let calls = 0;
    let maxSeen = 0;
    const counting: MappingAnalyst = {
      analyse(_kind, excerpt) {
        calls += 1;
        maxSeen = Math.max(maxSeen, excerpt.text.length);
        return Promise.resolve([]);
      },
    };

    const held = new Map<string, string>();
    const mapper = new StoryMapper({
      source: chapters,
      store: {
        read: (path) => Promise.resolve(held.get(path) ?? null),
        write: (path, content) => {
          held.set(path, content);
          return Promise.resolve();
        },
      },
      analyst: counting,
    });
    const scope = mapper.scope();
    expect(scope.words).toBeGreaterThan(150_000);
    await mapper.start();
    const run = await mapper.runToCompletion();
    expect(run.status).toBe("completed");

    expect(calls).toBeGreaterThan(40); // Chunked, chapter by chapter.
    expect(maxSeen).toBeLessThanOrEqual(MAX_EXCERPT_CHARS); // Never the whole book.

    const proposals = await mapper.proposals();
    const sceneProps = proposals.filter((held2) => held2.category === "scene");
    const sceneCount = sceneProps.reduce(
      (sum, proposal) =>
        sum + ((proposal.payload["segments"] as readonly unknown[] | undefined)?.length ?? 0),
      0,
    );
    expect(sceneCount).toBeGreaterThanOrEqual(200);
    const characters = proposals.filter((held2) => held2.category === "character");
    expect(characters.length).toBeGreaterThanOrEqual(100);
  }, 120_000);
});
