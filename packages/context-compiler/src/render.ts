import type {
  Chapter,
  Character,
  Location,
  PlotThread,
  Relationship,
  Scene,
  WorldRule,
} from "@jellytind/domain";

/**
 * Deterministic renderings of project data.
 *
 * Every element gets a `full` form and, where a meaningful shorter form exists,
 * a `summary`. The summary is a *structured digest*, not a chopped string: when
 * the budget forces a downgrade the reader still gets coherent, labelled
 * information rather than a sentence cut in half. Prose is the one exception —
 * there is no structural digest of a paragraph — so its shortened form is an
 * explicitly-labelled opening excerpt with the omitted amount stated inline.
 *
 * All renderings are pure functions of their input: compile the same project
 * twice and you get byte-identical text.
 */

const list = (values: readonly string[]): string =>
  values.length === 0 ? "none" : values.join(", ");

const line = (label: string, value: string | number | undefined): string | null =>
  value === undefined || value === "" ? null : `${label}: ${String(value)}`;

const block = (header: string, lines: ReadonlyArray<string | null>): string =>
  [header, ...lines.filter((l): l is string => l !== null)].join("\n");

// ── Scenes ──────────────────────────────────────────────────────────────────

export function renderScene(scene: Scene): string {
  return block(`SCENE ${scene.id} — ${scene.title}`, [
    line("chapter", scene.chapterId),
    line("status", scene.status),
    line("pov", scene.pov),
    line("location", scene.locationId),
    `characters: ${list(scene.characterIds)}`,
    `plot threads: ${list(scene.plotThreadIds)}`,
    `objects: ${list(scene.objectIds)}`,
    `purpose: ${list(scene.purpose)}`,
  ]);
}

export function summariseScene(scene: Scene): string {
  return `SCENE ${scene.id} — ${scene.title} (${scene.status}); characters: ${list(
    scene.characterIds,
  )}`;
}

// ── Chapters ────────────────────────────────────────────────────────────────

export function renderChapter(chapter: Chapter, scenes: readonly Scene[]): string {
  return block(`CHAPTER ${chapter.id} — ${chapter.title}`, [
    line("order", chapter.order),
    line("status", chapter.status),
    line("file", chapter.filePath),
    `scenes: ${list(scenes.map((s) => `${s.id} (${s.title})`))}`,
  ]);
}

/**
 * A chapter's digest, used where a recipe asks for "the previous chapter's
 * summary if available". Stored hierarchical summaries do not exist yet, so this
 * is derived deterministically from structure — and is labelled as derived, so
 * it can never be mistaken for authored canon.
 */
export function summariseChapter(chapter: Chapter, scenes: readonly Scene[]): string {
  return block(`CHAPTER ${chapter.id} — ${chapter.title} (derived summary)`, [
    line("status", chapter.status),
    `${String(scenes.length)} scene(s): ${list(scenes.map((s) => s.title))}`,
  ]);
}

// ── Characters ──────────────────────────────────────────────────────────────

export function renderCharacter(
  character: Character,
  relationships: readonly Relationship[],
): string {
  const links = relationships.map(
    (r) =>
      `${r.characterAId === character.id ? r.characterBId : r.characterAId} (${r.type})${
        r.description === "" ? "" : ` — ${r.description}`
      }`,
  );
  return block(`CHARACTER ${character.id} — ${character.name}`, [
    line("role", character.role),
    line("status", character.status),
    character.aliases.length > 0 ? `aliases: ${list(character.aliases)}` : null,
    line("description", character.description),
    line("notes", character.notes),
    links.length > 0 ? `relationships: ${list(links)}` : null,
  ]);
}

export function summariseCharacter(character: Character): string {
  return `CHARACTER ${character.id} — ${character.name}${
    character.role === "" ? "" : ` (${character.role})`
  }; status: ${character.status}`;
}

// ── Locations ───────────────────────────────────────────────────────────────

export function renderLocation(location: Location): string {
  return block(`LOCATION ${location.id} — ${location.name}`, [
    location.aliases.length > 0 ? `aliases: ${list(location.aliases)}` : null,
    line("within", location.parentLocationId),
    line("description", location.description),
    line("notes", location.notes),
  ]);
}

export function summariseLocation(location: Location): string {
  return `LOCATION ${location.id} — ${location.name}`;
}

// ── Plot threads ────────────────────────────────────────────────────────────

export function renderPlotThread(thread: PlotThread): string {
  return block(`PLOT THREAD ${thread.id} — ${thread.name}`, [
    line("status", thread.status),
    line("introduced in", thread.introducedSceneId),
    line("resolved in", thread.resolvedSceneId),
    `related scenes: ${list(thread.relatedSceneIds)}`,
    line("description", thread.description),
  ]);
}

export function summarisePlotThread(thread: PlotThread): string {
  return `PLOT THREAD ${thread.id} — ${thread.name} (${thread.status})`;
}

// ── World rules ─────────────────────────────────────────────────────────────

export function renderWorldRule(rule: WorldRule): string {
  return block(`WORLD RULE ${rule.id} — ${rule.name}`, [
    line("severity", rule.severity),
    line("scope", rule.scope),
    line("description", rule.description),
  ]);
}

export function summariseWorldRule(rule: WorldRule): string {
  return `WORLD RULE ${rule.id} — ${rule.name} (${rule.severity})`;
}

// ── Prose ───────────────────────────────────────────────────────────────────

/** Strip a Markdown file's YAML front-matter so prose context is prose. */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  return end === -1 ? text : text.slice(end + 4).replace(/^\n+/, "");
}

/**
 * An explicitly-labelled opening excerpt of prose.
 *
 * The label states how much was omitted, so a downgraded prose element announces
 * itself in the context a model actually reads — not only in the metadata.
 */
export function excerptProse(text: string, keepChars: number): string {
  if (text.length <= keepChars) return text;
  const cut = text.lastIndexOf("\n", keepChars);
  const head = text.slice(0, cut > keepChars / 2 ? cut : keepChars);
  const omitted = text.length - head.length;
  return `${head}\n\n[excerpt: opening ${String(head.length)} of ${String(
    text.length,
  )} characters; ${String(omitted)} omitted for context budget]`;
}
