import type { BuildContext, DiagnosticDraft, StoryCompilerRule } from "@jellytind/story-compiler";
import type { InstalledPlugin } from "./host";
import type { CompilerRuleContribution, ExporterContribution, ImporterContribution } from "./types";

/**
 * Contribution adapters (§7–§12): everything a plugin contributes lands in an
 * architecture Manu already has — the command registry, the custom-skill
 * format, the compiler's rule contract — never a parallel system.
 */

/** Deterministic template rules, emitted in the compiler's own contract (§9). */
export function compilerRulesFrom(plugin: InstalledPlugin): StoryCompilerRule[] {
  if (!plugin.enabled || !plugin.granted.includes("register_compiler_rules")) return [];
  const rules: StoryCompilerRule[] = [];
  for (const contribution of plugin.manifest.contributes.compilerRules ?? []) {
    if (contribution.type !== "deterministic") continue; // Semantic goes to the semantic layer.
    rules.push(deterministicRule(plugin.manifest.id, contribution));
  }
  return rules;
}

function deterministicRule(
  pluginId: string,
  contribution: Extract<CompilerRuleContribution, { type: "deterministic" }>,
): StoryCompilerRule {
  const template = contribution.template;
  return {
    id: `plugin:${pluginId}:${contribution.id}`,
    name: contribution.name,
    category: "project_rules",
    description: contribution.description,
    inputs: ["scenes", "chapters", "characters", "locations"] as never,
    run(context: BuildContext): DiagnosticDraft[] {
      const drafts: DiagnosticDraft[] = [];
      if (template.kind === "scene_word_limit") {
        for (const scene of context.scenes) {
          const words = context.metrics.wordsBySceneId?.get(scene.id as string);
          if (words !== undefined && words > template.maxWords) {
            drafts.push({
              severity: contribution.severity,
              message: `${scene.title} runs ${words} words — over this project's ${template.maxWords}-word scene limit.`,
              sceneId: scene.id as string,
              evidence: `Measured ${words} words against the plugin rule "${contribution.name}".`,
            });
          }
        }
      } else {
        const pool = template.entity === "character" ? context.characters : context.locations;
        for (const entity of pool) {
          const value = (entity as unknown as Record<string, unknown>)[template.field];
          if (typeof value !== "string" || value.trim() === "") {
            drafts.push({
              severity: contribution.severity,
              message: `${(entity as { name: string }).name} has no ${template.field}.`,
              entities: [(entity as { id: string }).id],
              evidence: `The ${template.field} field is empty; the plugin rule "${contribution.name}" requires it.`,
            });
          }
        }
      }
      return drafts;
    },
  };
}

/** Semantic briefings, for the semantic layer to run as model judgement. */
export function semanticBriefingsFrom(
  plugin: InstalledPlugin,
): ReadonlyArray<{ id: string; name: string; briefing: string }> {
  if (!plugin.enabled || !plugin.granted.includes("register_compiler_rules")) return [];
  return (plugin.manifest.contributes.compilerRules ?? [])
    .filter(
      (held): held is Extract<CompilerRuleContribution, { type: "semantic" }> =>
        held.type === "semantic",
    )
    .map((held) => ({
      id: `plugin:${plugin.manifest.id}:${held.id}`,
      name: held.name,
      briefing: held.briefing,
    }));
}

/** Raw custom-skill JSON, for the existing skills loader to parse (§8). */
export function skillSourcesFrom(plugin: InstalledPlugin): ReadonlyArray<Record<string, unknown>> {
  if (!plugin.enabled || !plugin.granted.includes("register_skills")) return [];
  return plugin.manifest.contributes.skills ?? [];
}

/** Import a Markdown dialect: patterns applied, nothing executed (§11). */
export function importWithDialect(
  importer: ImporterContribution,
  source: string,
): ReadonlyArray<{ title: string; markdown: string }> {
  const heading = new RegExp(importer.dialect.chapterHeading);
  const sceneBreak =
    importer.dialect.sceneBreak === undefined ? null : new RegExp(importer.dialect.sceneBreak);
  const chapters: Array<{ title: string; lines: string[] }> = [];
  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const match = heading.exec(line);
    if (match !== null) {
      chapters.push({ title: (match[1] ?? line).trim(), lines: [] });
      continue;
    }
    if (chapters.length === 0) chapters.push({ title: "Chapter 1", lines: [] });
    (chapters[chapters.length - 1] as { lines: string[] }).lines.push(
      sceneBreak !== null && sceneBreak.test(line) ? "* * *" : line,
    );
  }
  return chapters.map((chapter) => ({
    title: chapter.title,
    markdown: chapter.lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  }));
}

/** Export through a text template. Placeholders only — no code (§11). */
export function exportWithTemplate(
  exporter: ExporterContribution,
  manuscript: { title: string; chapters: ReadonlyArray<{ title: string; markdown: string }> },
): string {
  const parts: string[] = [];
  if (exporter.template.header !== undefined) {
    parts.push(exporter.template.header.replace(/\{title\}/g, manuscript.title));
  }
  manuscript.chapters.forEach((chapter, index) => {
    parts.push(
      exporter.template.chapterHeading
        .replace(/\{title\}/g, chapter.title)
        .replace(/\{number\}/g, String(index + 1)),
    );
    const body =
      exporter.template.sceneBreak === undefined
        ? chapter.markdown
        : chapter.markdown.replace(/^\s*\*\s*\*\s*\*\s*$/gm, exporter.template.sceneBreak);
    parts.push(body);
  });
  if (exporter.template.footer !== undefined) parts.push(exporter.template.footer);
  return (
    parts
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n"
  );
}
