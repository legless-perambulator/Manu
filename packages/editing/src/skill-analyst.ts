import { checkPermission, type PermissionGrant } from "@jellytind/agent-runtime";
import type { LanguageModel, OutputSchema } from "@jellytind/model-router";
import type { AnalystNote, SkillAnalyst } from "@jellytind/skills";
import { EditError } from "./types";

const REQUIRED_PERMISSION = "read_canon" as const;

/**
 * The semantic half of a Writing Skill.
 *
 * The workflow engine in `@jellytind/skills` holds no provider knowledge and no
 * model at all: a semantic step states what it needs read and hands over the
 * material the deterministic steps already retrieved. This is the
 * implementation of that port, and it lives here for the same reason the
 * diagnosis analyst does — every controlled model operation sits above the
 * repository, and every one of them proposes rather than decides
 * (docs/AI_EDITING.md, docs/WRITING_SKILLS.md).
 *
 * The contract is deliberately narrow. The model is given material and asked
 * for short observations; it cannot call tools, cannot reach the project, and
 * nothing it returns is written anywhere. Notes come back labelled as
 * model-derived and land in the report beside — never inside — what the
 * project records.
 */
const SYSTEM_PROMPT = `You are reading for a novelist inside Manu, a fiction development environment.

You are given material the project already retrieved — records, measurements, or lines of dialogue — and one specific thing to look for. You are not being asked for general writing advice, and you are not editing anything.

Rules:
- Work only from the material given. You cannot see the manuscript, and must not reason about text you were not shown.
- Do not repeat something the material already states as found.
- Counts are counts. Do not treat a number as a verdict, and do not say a chapter is bad because it is long.
- Quote or name what you are pointing at, so the writer can find it.
- If nothing in the material warrants an observation, return an empty list. An empty answer is a real answer.
- One or two sentences each. A writer reads these to decide what to look at next.`;

interface RawNotes {
  readonly notes?: unknown;
}

const NOTES_SCHEMA: OutputSchema<RawNotes> = {
  name: "SkillNotes",
  parse(value: unknown): RawNotes {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new EditError("empty_response", "SkillNotes: expected an object.");
    }
    return value as RawNotes;
  },
};

const FORMAT = `Reply with JSON only, matching:
{
  "notes": [
    {
      "statement": "one sentence naming what you noticed",
      "detail": "one sentence on why, referring to the material",
      "sceneIds": ["SCENE_0001"],
      "entities": ["CHAR_0001"]
    }
  ]
}
An empty "notes" list is a valid answer.`;

export interface ModelSkillAnalystOptions {
  readonly model: LanguageModel;
  readonly grant: PermissionGrant;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
}

export class ModelSkillAnalyst implements SkillAnalyst {
  readonly modelId: string;
  private readonly model: LanguageModel;
  private readonly grant: PermissionGrant;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;

  constructor(options: ModelSkillAnalystOptions) {
    this.model = options.model;
    this.modelId = options.model.id;
    this.grant = options.grant;
    this.maxOutputTokens = options.maxOutputTokens ?? 1_200;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async read(request: {
    instruction: string;
    material: string;
    maxItems?: number;
  }): Promise<readonly AnalystNote[]> {
    const decision = checkPermission(
      { name: "skill_reading", permission: REQUIRED_PERMISSION },
      this.grant,
    );
    if (!decision.allowed) {
      throw new EditError("permission_denied", decision.reason);
    }

    const limit = request.maxItems ?? 8;
    const raw = await this.model.generateStructured(
      {
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: `MATERIAL\n${request.material}` },
          {
            role: "user",
            content: `${request.instruction}\n\nReturn at most ${String(limit)} note(s).\n\n${FORMAT}`,
          },
        ],
        schema: NOTES_SCHEMA,
        maxOutputTokens: this.maxOutputTokens,
      },
      { timeoutMs: this.timeoutMs },
    );

    return notesOf(raw.notes).slice(0, limit);
  }
}

// ── Coercion: model output is untrusted ──────────────────────────────────────

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const ids = (value: unknown, prefix: RegExp): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && prefix.test(entry))
    : [];

function notesOf(value: unknown): AnalystNote[] {
  if (!Array.isArray(value)) return [];
  const out: AnalystNote[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const statement = text(raw.statement);
    // A note with nothing in it is not a note.
    if (statement === "") continue;
    const sceneIds = ids(raw.sceneIds, /^SCENE_/);
    const entities = ids(raw.entities, /^[A-Z]+_/);
    out.push({
      statement,
      ...(text(raw.detail) === "" ? {} : { detail: text(raw.detail) }),
      ...(sceneIds.length === 0 ? {} : { sceneIds }),
      ...(entities.length === 0 ? {} : { entities }),
    });
  }
  return out;
}
