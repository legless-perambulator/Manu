import {
  checkPermission,
  createTask,
  transition,
  type PermissionGrant,
} from "@jellytind/agent-runtime";
import {
  DEPENDENCY_KINDS,
  DEPENDENCY_KIND_INFO,
  describeDependency,
  isDependencyKind,
  isDependencyNode,
  type Dependency,
  type DependencyKind,
} from "@jellytind/domain";
import { ModelError, type LanguageModel, type OutputSchema } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { EditError } from "./types";

const REQUIRED_PERMISSION = "read_canon" as const;

/**
 * Proposing causality.
 *
 * A model can read a run of scenes and notice that the confrontation only
 * happens because of the letter. What it cannot do is *decide* that, because
 * being wrong here is expensive in a way most model errors are not: a
 * hallucinated dependency does not produce a bad sentence, it produces a blast
 * radius a writer trusts and a refactor planned against a link that does not
 * exist.
 *
 * So everything here arrives as `proposed`, stays out of the graph, and waits
 * for a human (AGENTS.md — "Canon vs Inference"; docs/STORY_REFACTOR.md).
 */

const SYSTEM_PROMPT = `You identify cause-and-effect relationships between elements of a fiction project.

You are given a run of scenes with their records and prose, and the story elements they touch. Propose the dependencies that genuinely hold between them.

Rules:
- Propose only relationships the material actually supports. A dependency you are unsure of is worse than one you leave out: a writer will plan a rewrite around it.
- Do not propose a link merely because two things are near each other, or because one follows the other. Sequence is not consequence.
- Use only the entity IDs given to you. Never invent an ID.
- Quote the phrase or record that supports each proposal as your evidence.
- Aim for the small number of links a writer would want to be warned about before cutting a scene. Ten good ones beat a hundred plausible ones.
- You are proposing. A human accepts or rejects each one.`;

interface RawProposal {
  readonly dependencies: ReadonlyArray<Record<string, unknown>>;
}

const PROPOSAL_SCHEMA: OutputSchema<RawProposal> = {
  name: "DependencyProposal",
  parse(value: unknown): RawProposal {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new EditError("empty_response", "DependencyProposal: expected an object.");
    }
    const list = (value as { dependencies?: unknown }).dependencies;
    if (!Array.isArray(list)) {
      throw new EditError("empty_response", 'DependencyProposal: "dependencies" must be an array.');
    }
    return {
      dependencies: list.filter(
        (d): d is Record<string, unknown> => typeof d === "object" && d !== null,
      ),
    };
  },
};

const FORMAT = `Reply with JSON only, matching:
{
  "dependencies": [
    {
      "fromId": "the subject, e.g. SCENE_0004",
      "kind": "${DEPENDENCY_KINDS.join(" | ")}",
      "toId": "the object, e.g. SCENE_0019",
      "description": "the relationship in one short sentence",
      "evidence": "the phrase or record that supports it"
    }
  ]
}
Each entry reads as a sentence: "<fromId> <kind> <toId>".
${DEPENDENCY_KINDS.map((k) => `- ${k}: ${DEPENDENCY_KIND_INFO[k].description}`).join("\n")}
Return an empty array if nothing in the scope supports a dependency.`;

/** One proposal, with why it was kept or set aside. */
export interface ProposedDependency {
  readonly kind: DependencyKind;
  readonly fromId: string;
  readonly toId: string;
  readonly description: string;
  readonly evidence: string;
  /** Set when the draft could not be used; shown, not saved. */
  readonly problem?: string;
}

export interface DependencyProposal {
  readonly taskId: string;
  readonly sceneIds: readonly string[];
  /** Stored as `proposed`, awaiting review. */
  readonly proposed: readonly Dependency[];
  /** Drafts that failed validation, kept visible rather than hidden. */
  readonly rejected: readonly ProposedDependency[];
  readonly modelId: string;
  readonly createdAt: string;
}

export interface DependencyAnalystOptions {
  readonly repo: StoryRepository;
  readonly model: LanguageModel;
  readonly grant: PermissionGrant;
  readonly now?: () => string;
  readonly maxOutputTokens?: number;
}

export class DependencyAnalyst {
  private readonly repo: StoryRepository;
  private readonly model: LanguageModel;
  private readonly grant: PermissionGrant;
  private readonly now: () => string;
  private readonly maxOutputTokens: number;

  constructor(options: DependencyAnalystOptions) {
    this.repo = options.repo;
    this.model = options.model;
    this.grant = options.grant;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxOutputTokens = options.maxOutputTokens ?? 2_000;
  }

  /**
   * Analyse a run of scenes and propose the dependencies between them.
   *
   * The scope is explicit rather than "the whole book": causality proposed over
   * a novel at once would be a thousand guesses nobody reviews, which is the
   * same as no review at all.
   */
  async analyseScope(sceneIds: readonly string[]): Promise<DependencyProposal> {
    const decision = checkPermission(
      { name: "propose_dependencies", permission: REQUIRED_PERMISSION },
      this.grant,
    );
    if (!decision.allowed) {
      throw new EditError("permission_denied", decision.reason, { details: { sceneIds } });
    }
    if (sceneIds.length === 0) {
      throw new EditError("unknown_target", "Name the scenes to analyse.");
    }

    const scenes = (await this.repo.listScenes()).filter((s) => sceneIds.includes(s.id as string));
    if (scenes.length === 0) {
      throw new EditError("unknown_target", "None of those scenes exist in this project.");
    }

    const task = createTask({
      id: await this.repo.agents.nextTaskId(),
      goal: `propose_dependencies: ${String(scenes.length)} scene(s)`,
      now: this.now(),
      scope: scenes.map((s) => s.id as string),
      allowedTools: [],
      approvalPolicy: "approve_every_edit",
    });
    await this.repo.agents.saveTask(task);
    let current = await this.repo.agents.saveTask(transition(task, "running", { now: this.now() }));

    try {
      const raw = await this.model.generateStructured(
        {
          system: SYSTEM_PROMPT,
          messages: [
            { role: "user", content: await this.renderScope(scenes.map((s) => s.id as string)) },
            {
              role: "user",
              content: `Propose the dependencies that hold between these elements.\n\n${FORMAT}`,
            },
          ],
          schema: PROPOSAL_SCHEMA,
          maxOutputTokens: this.maxOutputTokens,
        },
        { timeoutMs: 120_000 },
      );

      const known = await this.knownIds();
      const { valid, rejected } = sift(raw.dependencies, known);

      const proposed =
        valid.length === 0
          ? []
          : await this.repo.addDependencies(valid, {
              source: "agent",
              status: "proposed",
              modelId: this.model.id,
              summary: `Proposed ${String(valid.length)} dependency(ies) from ${String(scenes.length)} scene(s)`,
            });

      current = await this.repo.agents.saveTask(
        transition(current, "awaiting_approval", { now: this.now() }),
      );
      await this.repo.agents.appendActivity({
        taskId: current.id,
        timestamp: this.now(),
        tool: "propose_dependencies",
        argumentsSummary: `scenes=${scenes.length}`,
        resultSummary: `${String(proposed.length)} proposed, ${String(rejected.length)} unusable`,
        status: "ok",
      });

      return {
        taskId: current.id,
        sceneIds: scenes.map((s) => s.id as string),
        proposed,
        rejected,
        modelId: this.model.id,
        createdAt: this.now(),
      };
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      await this.repo.agents.saveTask(
        transition(current, "failed", { now: this.now(), failureReason: reason }),
      );
      if (cause instanceof ModelError) throw new EditError("provider_failed", reason, { cause });
      throw cause;
    }
  }

  /** Every ID the model is allowed to name, so an invented one is caught. */
  private async knownIds(): Promise<Set<string>> {
    const summaries = await this.repo.listEntitySummaries();
    return new Set(summaries.filter((s) => isDependencyNode(s.id)).map((s) => s.id));
  }

  /**
   * The scope as the model sees it.
   *
   * Records and prose together: causality is visible in both, and a model given
   * only structure would invent links from adjacency alone.
   */
  private async renderScope(sceneIds: readonly string[]): Promise<string> {
    const [scenes, chapters, characters, threads, facts, decisions, existing] = await Promise.all([
      this.repo.listScenes(),
      this.repo.listChapters(),
      this.repo.listCharacters(),
      this.repo.listPlotThreads(),
      this.repo.listFacts(),
      this.repo.listDecisions(),
      this.repo.listDependencies(),
    ]);

    const wanted = new Set(sceneIds);
    const inScope = scenes.filter((s) => wanted.has(s.id as string));
    const name = new Map<string, string>([
      ...characters.map((c) => [c.id as string, c.name] as const),
      ...threads.map((t) => [t.id as string, t.name] as const),
      ...facts.map((f) => [f.id as string, f.statement] as const),
      ...decisions.map((d) => [d.id as string, d.description] as const),
    ]);

    const out: string[] = ["SCENES IN SCOPE"];
    for (const scene of inScope) {
      const chapter = chapters.find((c) => c.id === scene.chapterId);
      out.push(
        `\n${scene.id as string} — "${scene.title}"${chapter === undefined ? "" : ` (${chapter.title})`}`,
      );
      if (scene.purpose.length > 0) out.push(`  purpose: ${scene.purpose.join("; ")}`);
      const people = scene.characterIds.map((id) => `${name.get(id as string) ?? id} (${id})`);
      if (people.length > 0) out.push(`  characters: ${people.join(", ")}`);
      const linked = scene.plotThreadIds.map((id) => `${name.get(id as string) ?? id} (${id})`);
      if (linked.length > 0) out.push(`  threads: ${linked.join(", ")}`);
      const stated = scene.factIds.map((id) => `${name.get(id as string) ?? id} (${id})`);
      if (stated.length > 0) out.push(`  facts: ${stated.join(", ")}`);

      if (chapter !== undefined) {
        const prose = await this.repo.readProjectFile(chapter.filePath);
        if (prose !== null && prose.trim() !== "") {
          out.push(`  prose (chapter opening): ${excerpt(prose)}`);
        }
      }
    }

    const relevantDecisions = decisions.filter((d) => wanted.has(d.sceneId as string));
    if (relevantDecisions.length > 0) {
      out.push("\nDECISIONS RECORDED IN THESE SCENES");
      for (const decision of relevantDecisions) {
        out.push(
          `${decision.id as string} — ${decision.description} (${name.get(decision.characterId as string) ?? decision.characterId}, in ${decision.sceneId as string})`,
        );
      }
    }

    const already = existing.filter(
      (d) => d.status !== "rejected" && (wanted.has(d.fromId) || wanted.has(d.toId)),
    );
    if (already.length > 0) {
      out.push("\nALREADY REGISTERED — do not propose these again");
      for (const dependency of already) out.push(describeDependency(dependency));
    }

    return out.join("\n");
  }
}

const EXCERPT_WORDS = 220;

function excerpt(text: string): string {
  const body = text
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/<!--\s*scene:[^>]*-->/g, "")
    .trim();
  const words = body.split(/\s+/);
  return words.length <= EXCERPT_WORDS ? body : `${words.slice(0, EXCERPT_WORDS).join(" ")} […]`;
}

/**
 * Split the model's drafts into usable and unusable.
 *
 * A draft naming an invented ID — the classic failure — is set aside *with the
 * reason*, so the writer sees what the model tried to claim rather than
 * wondering why it proposed nothing.
 */
export function sift(
  drafts: ReadonlyArray<Record<string, unknown>>,
  known: ReadonlySet<string>,
): {
  valid: Array<{
    kind: DependencyKind;
    fromId: string;
    toId: string;
    description: string;
    evidence: string;
  }>;
  rejected: ProposedDependency[];
} {
  const valid: Array<{
    kind: DependencyKind;
    fromId: string;
    toId: string;
    description: string;
    evidence: string;
  }> = [];
  const rejected: ProposedDependency[] = [];
  const seen = new Set<string>();

  for (const draft of drafts) {
    const kind = isDependencyKind(draft.kind) ? draft.kind : null;
    const fromId = typeof draft.fromId === "string" ? draft.fromId : "";
    const toId = typeof draft.toId === "string" ? draft.toId : "";
    const description = typeof draft.description === "string" ? draft.description : "";
    const evidence = typeof draft.evidence === "string" ? draft.evidence : "";
    const entry = { kind: kind ?? "causes", fromId, toId, description, evidence } as const;

    const problem =
      kind === null
        ? `"${String(draft.kind)}" is not a relationship kind.`
        : fromId === toId
          ? "A dependency cannot link something to itself."
          : !known.has(fromId)
            ? `${fromId === "" ? "A missing id" : fromId} is not an entity in this project.`
            : !known.has(toId)
              ? `${toId === "" ? "A missing id" : toId} is not an entity in this project.`
              : evidence === ""
                ? "No evidence given. A proposal with nothing behind it cannot be reviewed."
                : null;

    if (problem !== null) {
      rejected.push({ ...entry, problem });
      continue;
    }

    const key = `${entry.kind}|${fromId}|${toId}`;
    if (seen.has(key)) {
      rejected.push({ ...entry, problem: "The model proposed this twice." });
      continue;
    }
    seen.add(key);
    valid.push({ ...entry, kind: entry.kind });
  }

  return { valid, rejected };
}
