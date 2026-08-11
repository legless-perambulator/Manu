import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeProjectStore } from "@jellytind/persistence/node";
import { StoryRepository } from "./story-repository";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jellytind-graph-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("entity graph on a real filesystem", () => {
  it("writes human-readable entity files and reloads the graph", async () => {
    const repo = await StoryRepository.createProject({
      store: new NodeProjectStore(root),
      title: "Disk Graph",
      rootPath: root,
    });
    const elias = await repo.addCharacter({ name: "Elias", role: "protagonist", aliases: ["E"] });
    const manor = await repo.addLocation({ name: "Blackthorn Manor" });
    const scene = await repo.addScene({
      title: "Arrival",
      pov: elias.id,
      locationId: manor.id,
      characterIds: [elias.id],
    });

    // Character is a real Markdown file with front-matter on disk.
    const charFile = await readFile(join(root, elias.filePath), "utf8");
    expect(charFile).toContain("id: CHAR_0001");
    expect(charFile).toContain("role: protagonist");
    expect(charFile).toContain("# Elias");

    // Scenes live in the scenes collection file.
    const scenesFile = JSON.parse(await readFile(join(root, "scenes/scenes.json"), "utf8"));
    expect(scenesFile.items[0].pov).toBe(elias.id);

    // Reopen from disk and confirm the graph + integrity survive.
    const reopened = await StoryRepository.openProject({
      store: new NodeProjectStore(root),
      rootPath: root,
    });
    expect((await reopened.listCharacters())[0]?.aliases).toEqual(["E"]);
    expect((await reopened.listScenes())[0]?.id).toBe(scene.id);
    expect((await reopened.checkIntegrity()).ok).toBe(true);
  });
});
