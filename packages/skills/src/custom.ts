import { WRITER_DIR } from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import { hasOperation } from "./operations";
import { BUILT_IN_SKILLS, defineSkill } from "./skills";
import { SkillError, type SkillDefinition, type SkillInput } from "./types";

export const CUSTOM_SKILLS_DIR = `${WRITER_DIR}/skills/custom`;

/**
 * Skills a writer defines themselves.
 *
 * A custom skill is **a different order of the same operations** — a JSON file
 * naming steps from the registry, not code and not a prompt. That is what makes
 * loading one from a project safe: there is nothing a custom skill can do that
 * a shipped one cannot, and no way for a file in a repository to execute
 * anything (docs/WRITING_SKILLS.md).
 *
 * No marketplace, no installation, no sharing infrastructure: a file in the
 * project, which travels with the project because it *is* the project.
 */
export interface CustomSkillFile {
  readonly id?: unknown;
  readonly command?: unknown;
  readonly name?: unknown;
  readonly description?: unknown;
  readonly inputs?: unknown;
  readonly steps?: unknown;
  readonly preferredAgent?: unknown;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function inputsOf(value: unknown, where: string): SkillInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new SkillError("invalid_definition", `${where}: "inputs" must be a list.`);
  }
  return value.map((entry, index) => {
    const raw = (entry ?? {}) as Record<string, unknown>;
    const key = text(raw.key);
    if (key === "") {
      throw new SkillError(
        "invalid_definition",
        `${where}: input ${String(index + 1)} has no key.`,
      );
    }
    const kind = text(raw.entityKind);
    return {
      key,
      label: text(raw.label) === "" ? key : text(raw.label),
      required: raw.required === true,
      ...(kind === "" ? {} : { entityKind: kind as SkillInput["entityKind"] }),
      ...(text(raw.description) === "" ? {} : { description: text(raw.description) }),
    };
  });
}

/**
 * Turn one file's contents into a skill, or explain why it cannot be one.
 *
 * Every failure names the file and the problem: a writer editing JSON by hand
 * deserves a sentence, not a stack trace.
 */
export function parseCustomSkill(raw: string, where: string): SkillDefinition {
  let parsed: CustomSkillFile;
  try {
    parsed = JSON.parse(raw) as CustomSkillFile;
  } catch (cause) {
    throw new SkillError("invalid_definition", `${where}: not valid JSON.`, { cause });
  }

  const id = text(parsed.id);
  const name = text(parsed.name);
  if (id === "") throw new SkillError("invalid_definition", `${where}: "id" is required.`);
  if (name === "") throw new SkillError("invalid_definition", `${where}: "name" is required.`);
  if (BUILT_IN_SKILLS.some((skill) => skill.id === id)) {
    throw new SkillError(
      "invalid_definition",
      `${where}: "${id}" is the id of a skill Manu ships with. Choose another.`,
    );
  }

  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    throw new SkillError("invalid_definition", `${where}: "steps" must list at least one step.`);
  }

  const steps = parsed.steps.map((entry, index) => {
    const raw2 = (entry ?? {}) as Record<string, unknown>;
    const operationId = text(raw2.operationId) === "" ? text(raw2.op) : text(raw2.operationId);
    if (operationId === "") {
      throw new SkillError(
        "invalid_definition",
        `${where}: step ${String(index + 1)} names no operation.`,
      );
    }
    if (!hasOperation(operationId)) {
      throw new SkillError(
        "invalid_definition",
        `${where}: step ${String(index + 1)} names "${operationId}", which is not an operation Manu has.`,
        { details: { operation: operationId } },
      );
    }
    return {
      operationId,
      ...(text(raw2.id) === "" ? {} : { id: text(raw2.id) }),
      ...(text(raw2.title) === "" ? {} : { title: text(raw2.title) }),
    };
  });

  const command = text(parsed.command);
  return defineSkill({
    id,
    command: command === "" ? `/${id.replace(/_/g, "-")}` : command,
    name,
    description: text(parsed.description),
    inputs: inputsOf(parsed.inputs, where),
    steps,
    ...(text(parsed.preferredAgent) === "" ? {} : { preferredAgent: text(parsed.preferredAgent) }),
    custom: true,
  });
}

export interface LoadedCustomSkills {
  readonly skills: readonly SkillDefinition[];
  /** Files that could not be loaded, each with the reason. Never silent. */
  readonly problems: ReadonlyArray<{ path: string; reason: string }>;
}

/** Load every custom skill in a project, reporting the ones that failed. */
export async function loadCustomSkills(repo: StoryRepository): Promise<LoadedCustomSkills> {
  const paths = (await repo.listProjectFiles(CUSTOM_SKILLS_DIR)).filter((path) =>
    path.endsWith(".json"),
  );
  const skills: SkillDefinition[] = [];
  const problems: Array<{ path: string; reason: string }> = [];

  for (const path of paths.sort()) {
    const raw = await repo.readProjectFile(path);
    if (raw === null) continue;
    try {
      skills.push(parseCustomSkill(raw, path));
    } catch (cause) {
      problems.push({ path, reason: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  return { skills, problems };
}

/** Write a custom skill into the project, where it travels with the book. */
export async function saveCustomSkill(
  repo: StoryRepository,
  definition: {
    id: string;
    name: string;
    description?: string;
    command?: string;
    inputs?: readonly SkillInput[];
    steps: ReadonlyArray<{ operationId: string; title?: string; id?: string }>;
    preferredAgent?: string;
  },
): Promise<SkillDefinition> {
  const body = `${JSON.stringify(definition, null, 2)}\n`;
  const path = `${CUSTOM_SKILLS_DIR}/${definition.id}.json`;
  // Parsed before it is written: an invalid skill never reaches the project.
  const skill = parseCustomSkill(body, path);
  await repo.createDirectory(CUSTOM_SKILLS_DIR);
  await repo.writeProjectFile(path, body);
  return skill;
}
