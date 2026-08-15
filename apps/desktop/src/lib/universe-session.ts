import {
  Universe,
  universeStoreOver,
  UNIVERSE_PATHS,
  type UniverseBook,
  type UniverseManifest,
} from "@jellytind/universe";
import type { StoryRepository } from "@jellytind/story-repository";
import { TauriProjectStore } from "../repo/tauri-project-store";
import type { ProjectSession } from "../repo/session";

/**
 * How a book session finds its universe (Phase 41 §15).
 *
 * Opening a book stays lightweight: the book carries one small link file
 * naming its universe folder and its BOOK id there. The Universe panel loads
 * the universe lazily from that link; a book without one is simply a
 * standalone book, exactly as before.
 */

const LINK_PATH = ".writer/universe-link.json";

export interface UniverseLink {
  readonly universeRoot: string;
  readonly bookId: string;
}

export async function readUniverseLink(repo: StoryRepository): Promise<UniverseLink | null> {
  const raw = await repo.readProjectFile(LINK_PATH);
  return raw === null ? null : (JSON.parse(raw) as UniverseLink);
}

export async function openLinkedUniverse(
  repo: StoryRepository,
): Promise<{ universe: Universe; link: UniverseLink } | null> {
  const link = await readUniverseLink(repo);
  if (link === null) return null;
  const universe = await Universe.open(universeStoreOver(new TauriProjectStore(link.universeRoot)));
  return { universe, link };
}

/** Create a new universe folder and register this book as its first book. */
export async function createUniverseAround(
  session: ProjectSession,
  parent: string,
  name: string,
): Promise<{ universe: Universe; link: UniverseLink }> {
  const universeRoot = `${parent.replace(/\/$/, "")}/${name.replace(/[/\\]/g, "-")}`;
  const universe = await Universe.create(universeStoreOver(new TauriProjectStore(universeRoot)), {
    name,
  });
  return registerBook(session, universe, universeRoot);
}

/** Attach this book to an existing universe folder. */
export async function joinUniverse(
  session: ProjectSession,
  universeRoot: string,
): Promise<{ universe: Universe; link: UniverseLink }> {
  const universe = await Universe.open(universeStoreOver(new TauriProjectStore(universeRoot)));
  return registerBook(session, universe, universeRoot);
}

async function registerBook(
  session: ProjectSession,
  universe: Universe,
  universeRoot: string,
): Promise<{ universe: Universe; link: UniverseLink }> {
  // Prefer the portable arrangement: a book nested inside the universe folder
  // is stored by relative path; anything else by absolute path.
  const path = session.root.startsWith(`${universeRoot}/`)
    ? session.root.slice(universeRoot.length + 1)
    : session.root;
  const book = await universe.addBook({
    title: session.repo.project.title,
    path,
    projectId: session.repo.project.id as string,
  });
  const link: UniverseLink = { universeRoot, bookId: book.bookId };
  await session.repo.writeProjectFile(LINK_PATH, JSON.stringify(link, null, 2));
  return { universe, link };
}

/** Where a universe book's project folder really is on disk. */
export function bookRoot(universeRoot: string, book: UniverseBook): string {
  return book.path.startsWith("/") ? book.path : `${universeRoot}/${book.path}`;
}

/** Validate + read a universe folder for the start screen's Open Universe. */
export async function peekUniverse(universeRoot: string): Promise<UniverseManifest | null> {
  const store = new TauriProjectStore(universeRoot);
  const raw = await store.readFile(UNIVERSE_PATHS.manifest);
  return raw === null ? null : (JSON.parse(raw) as UniverseManifest);
}
