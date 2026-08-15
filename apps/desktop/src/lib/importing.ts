import {
  importDocx,
  importEpub,
  importMarkdown,
  importPlainText,
  previewOf,
  streamInflate,
  type ImportPreview,
  type ImportedManuscript,
} from "@jellytind/manuscript-io";
import { writeChapterBody } from "@jellytind/story-mapper";
import { readProjectArchive } from "@jellytind/manuscript-io";
import { createProjectAt, restoreProjectFiles, type ProjectSession } from "../repo/session";
import { readExternalFile } from "./external-files";

/**
 * Manuscript import (Phase 40 Part A).
 *
 * The source file is read once and never written (§2). What the writer sees
 * before anything is created is the preview (§3); what lands in the new
 * project is the corrected chapter list, plus a provenance record naming
 * where the book came from.
 */

export interface LoadedImport {
  readonly fileName: string;
  readonly manuscript: ImportedManuscript;
  readonly preview: ImportPreview;
}

export async function loadManuscriptForImport(path: string): Promise<LoadedImport> {
  const fileName = path.slice(path.lastIndexOf("/") + 1);
  const extension = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  const bytes = await readExternalFile(path);

  let manuscript: ImportedManuscript;
  if (extension === "docx") {
    manuscript = await importDocx(bytes, streamInflate);
  } else if (extension === "epub") {
    manuscript = await importEpub(bytes, streamInflate);
  } else if (extension === "md" || extension === "markdown") {
    manuscript = importMarkdown(new TextDecoder().decode(bytes));
  } else if (extension === "txt" || extension === "text") {
    manuscript = importPlainText(new TextDecoder().decode(bytes));
  } else {
    throw new Error(
      `".${extension}" is not an importable manuscript format. Manu imports DOCX, Markdown, plain text and EPUB.`,
    );
  }
  return { fileName, manuscript, preview: previewOf(manuscript) };
}

/** The corrections the preview allows before committing (§3). */
export interface ImportDecision {
  readonly title: string;
  /** Chapter titles as (possibly) corrected, in order; null drops the chapter. */
  readonly chapterTitles: ReadonlyArray<string | null>;
}

export async function createImportedProject(
  parent: string,
  loaded: LoadedImport,
  decision: ImportDecision,
): Promise<ProjectSession> {
  const session = await createProjectAt(parent, decision.title, "novel");
  const { repo } = session;
  for (const [index, chapter] of loaded.manuscript.chapters.entries()) {
    const title = decision.chapterTitles[index];
    if (title === null || title === undefined) continue;
    const record = await repo.addChapter({ title });
    await writeChapterBody(repo, record.filePath, chapter.markdown);
  }
  await repo.writeProjectFile(
    ".writer/import/provenance.json",
    JSON.stringify(
      {
        fileName: loaded.fileName,
        format: loaded.manuscript.format,
        importedAt: new Date().toISOString(),
        words: loaded.manuscript.words,
        chapterCount: loaded.manuscript.chapters.length,
      },
      null,
      2,
    ),
  );
  return session;
}

/**
 * Restore a Manu project archive (§40): the round trip back from
 * "Export Manu Project", landing as a fresh folder in the chosen place.
 */
export async function importProjectArchive(
  parent: string,
  fileName: string,
  path: string,
): Promise<ProjectSession> {
  const bytes = await readExternalFile(path);
  const unpacked = await readProjectArchive(bytes, streamInflate);
  if (unpacked.problems.length > 0) {
    throw new Error(unpacked.problems[0] as string);
  }
  const name = fileName.replace(/\.zip$/i, "") || "Restored project";
  return restoreProjectFiles(parent, name, unpacked.files);
}
