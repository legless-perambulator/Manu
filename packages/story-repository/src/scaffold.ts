import type { ProjectStore } from "@jellytind/persistence";
import { PROJECT_DIRECTORIES, PATHS } from "./paths";

/**
 * Sensible starter files for a new project. Deliberately sparse — we do not
 * litter every folder with placeholder content (the task is explicit about
 * this). Only files a writer would expect to find and fill in are created.
 */
function starterFiles(title: string): Record<string, string> {
  const heading = (t: string, body: string): string => `# ${t}\n\n${body}\n`;
  return {
    "story/premise.md": heading("Premise", "_What is this story about, in a sentence or two?_"),
    "story/synopsis.md": heading("Synopsis", "_A short summary of the whole story._"),
    "story/themes.md": heading("Themes", "_The ideas this story explores._"),
    "story/story_rules.md": heading(
      "Story Rules",
      "_Hard and soft rules the story must respect (e.g. POV, world constraints)._",
    ),
    "plot/master_outline.md": heading("Master Outline", "_The high-level plan, act by act._"),
    "plot/plot_threads.json": `${JSON.stringify({ threads: [] }, null, 2)}\n`,
    "plot/timeline.json": `${JSON.stringify({ events: [] }, null, 2)}\n`,
    "plot/foreshadowing.json": `${JSON.stringify({ setups: [] }, null, 2)}\n`,
    "style/prose.md": heading("Prose Style", "_Notes on sentence rhythm, description, voice._"),
    "style/dialogue.md": heading("Dialogue Style", "_How characters speak; subtext preferences._"),
    "style/banned_tendencies.md": heading("Banned Tendencies", "_Phrasings and habits to avoid._"),
    "notes/README.md": heading(title, "_Loose notes and ideas live here._"),
  };
}

/**
 * Create the canonical directory structure and starter files for a new project.
 * Idempotent at the directory level; overwrites starter files only if called on
 * an existing project (callers guard against that).
 */
export async function scaffoldProject(store: ProjectStore, title: string): Promise<void> {
  for (const dir of PROJECT_DIRECTORIES) {
    await store.createDirectory(dir);
  }
  const files = starterFiles(title);
  for (const [path, content] of Object.entries(files)) {
    await store.writeFile(path, content);
  }
  // Initialise empty derived index + id-sequence state.
  await store.writeFile(PATHS.entitiesCatalog, `${JSON.stringify({ entities: [] }, null, 2)}\n`);
  await store.writeFile(PATHS.idSequences, `${JSON.stringify({}, null, 2)}\n`);
}
