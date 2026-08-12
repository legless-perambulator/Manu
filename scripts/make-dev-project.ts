/**
 * Writes a small development project to disk for manual testing.
 *
 * It builds the fixture through the real repository API, so the result is a
 * genuine Manu project rather than a hand-written imitation that could drift
 * from the scaffolder.
 *
 *     pnpm dev:fixture                 # -> ./.dev/blackthorn
 *     MANU_FIXTURE_DIR=/tmp/x pnpm dev:fixture
 *
 * Nothing opens it automatically: Manu always starts on the start screen, and
 * the folder is git-ignored. Open it from the app with "Open an existing
 * project…".
 *
 * It runs under Vitest only because Vitest is this repository's TypeScript
 * runner; it is excluded from `pnpm test` by the default include globs.
 */
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { it } from "vitest";
import { NodeProjectStore } from "@jellytind/persistence/node";
import { StoryRepository } from "@jellytind/story-repository";

const DEFAULT_DIR = resolve(process.cwd(), ".dev/blackthorn");

it("writes a development project", { timeout: 60_000 }, async () => {
  const root = process.env.MANU_FIXTURE_DIR ?? DEFAULT_DIR;
  rmSync(root, { recursive: true, force: true });

  const store = new NodeProjectStore(root);
  const repo = await StoryRepository.createProject({
    store,
    title: "The Blackthorn Inheritance",
    rootPath: root,
  });

  const manor = await repo.addLocation({
    name: "Blackthorn Manor",
    description: "The family seat, shut up since the funeral.",
  });
  const elias = await repo.addCharacter({
    name: "Elias Vance",
    role: "protagonist",
    description: "The younger brother, back after eleven years away.",
    goals: ["Find out who was in the house the night of the fire"],
  });
  const mara = await repo.addCharacter({
    name: "Mara Sallow",
    role: "supporting",
    description: "The solicitor handling the estate. Knows more than she says.",
    goals: ["Keep the will's second codicil out of court"],
  });

  const chapter = await repo.addChapter({ title: "The Reading", order: 1 });
  const scene = await repo.addScene({
    chapterId: chapter.id,
    title: "The reading of the will",
    pov: elias.id,
    locationId: manor.id,
    characterIds: [elias.id, mara.id],
    purpose: ["Establish the estate, the codicil, and that Mara is hiding something."],
    status: "drafted",
  });

  // A chapter file carries the chapter's record in its frontmatter and the
  // prose below it, so prose is appended rather than written over — exactly
  // what the editor does when a writer types into it.
  const scaffold = (await repo.readProjectFile(chapter.filePath)) ?? "";
  await repo.writeProjectFile(
    chapter.filePath,
    [
      scaffold.trimEnd(),
      "",
      `<!-- scene:${scene.id} -->`,
      "",
      "The house smelled of cold ash and lemon polish, which was how Elias knew",
      "someone had been keeping it. Mara Sallow set the folder down on the table",
      "between them and did not open it.",
      "",
      '"There is a codicil," she said.',
      "",
    ].join("\n"),
  );

  await repo.createCheckpoint("Fixture");

  // Prove the project is valid the way the app will read it back.
  const reopened = await StoryRepository.openProject({
    store: new NodeProjectStore(root),
    rootPath: root,
  });
  const build = await reopened.buildStory({ persist: false });

  process.stdout.write(
    `\nDevelopment project written to ${root}\n` +
      `  ${build.diagnostics.length} diagnostic(s), verdict: ${build.status}\n` +
      build.diagnostics.map((d) => `    ${d.severity} ${d.ruleId}: ${d.message}\n`).join("") +
      `  Open it from Manu with "Open an existing project…".\n\n`,
  );
});
