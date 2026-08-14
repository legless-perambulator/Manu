/**
 * Turning a project title into a folder name.
 *
 * A writer who calls their book *The Black Thorn* should find a folder called
 * `The Black Thorn` — not `the-black-thorn`, and not `project_a1b2c3`. The
 * folder is the thing they will see in their file manager for the next two
 * years, so it keeps spaces, capitals, accents and ordinary punctuation.
 *
 * Only what a filesystem genuinely cannot take is changed. The project's real
 * identity is its `StoryProjectId` in the manifest, which never depends on this
 * (docs/STORY_REPOSITORY.md).
 */

/**
 * Characters no mainstream filesystem will accept in a name.
 *
 * The Windows set is applied everywhere rather than per-platform, because a
 * project folder created on Linux should still copy onto a Windows machine — a
 * portable project that cannot be moved is not portable.
 */
// eslint-disable-next-line no-control-regex -- control bytes are exactly what must go.
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001F]/g;

/** Names Windows reserves outright, whatever the extension. */
const RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${String(i + 1)}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${String(i + 1)}`),
]);

/** How long a folder name may get before it is trimmed. */
const MAX_LENGTH = 96;

export function projectFolderName(title: string): string {
  let name = title.normalize("NFC").replace(ILLEGAL, " ");

  // Collapse the runs of whitespace that replacing illegal characters leaves.
  name = name.replace(/\s+/g, " ").trim();

  // A leading dot would hide the project from the writer's own file manager,
  // which is a surprising thing to do to somebody's novel.
  name = name.replace(/^\.+/, "").trim();

  // Trailing dots and spaces are silently dropped by Windows, so a folder named
  // "Book." would not be the folder we then look for.
  name = name.replace(/[. ]+$/, "");

  if (name.length > MAX_LENGTH) {
    name = name
      .slice(0, MAX_LENGTH)
      .replace(/[. ]+$/, "")
      .trim();
  }

  if (RESERVED.has(name.toLowerCase())) name = `${name} project`;
  if (name === "") name = "Untitled project";

  return name;
}

/** A folder name that is free, by appending a numeric suffix if needed. */
export async function availableFolderName(
  title: string,
  exists: (name: string) => Promise<boolean>,
): Promise<string> {
  const base = projectFolderName(title);
  if (!(await exists(base))) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base} ${String(n)}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Could not find a free folder name for "${title}".`);
}
