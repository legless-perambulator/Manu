import { readZip, writeZip, type Inflate, type ZipEntry } from "./zip";

/**
 * The Manu project archive (§37, §38): the complete portable Story Repository
 * as one file — manuscript, structured story data, research, project settings
 * and revision metadata — for backup, transfer and round-tripping.
 *
 * Secrets never enter the archive. API credentials live in the system keychain
 * and are not project files at all, but the exclusion list stands guard anyway
 * in case a future file ever matches.
 */

const EXCLUDED = [/(^|\/)\.env/i, /secret/i, /credential/i, /api[-_]?key/i];

export function archiveEligible(path: string): boolean {
  return !EXCLUDED.some((pattern) => pattern.test(path));
}

export interface ArchiveFile {
  readonly path: string;
  readonly content: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function buildProjectArchive(files: readonly ArchiveFile[]): Uint8Array {
  const entries: ZipEntry[] = files
    .filter((file) => archiveEligible(file.path))
    .map((file) => ({ name: file.path, data: encoder.encode(file.content) }));
  return writeZip(entries);
}

export interface ReadArchive {
  readonly files: readonly ArchiveFile[];
  readonly problems: readonly string[];
}

/** Read an archive back, verifying it really is a Manu project. */
export async function readProjectArchive(
  bytes: Uint8Array,
  inflate: Inflate,
): Promise<ReadArchive> {
  const entries = await readZip(bytes, inflate);
  const files = entries.map((entry) => ({ path: entry.name, content: decoder.decode(entry.data) }));
  const problems: string[] = [];
  if (!files.some((file) => file.path === ".writer/project.json")) {
    problems.push("This archive does not contain a Manu project (.writer/project.json missing).");
  }
  return { files, problems };
}
