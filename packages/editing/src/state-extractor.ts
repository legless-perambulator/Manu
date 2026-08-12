import {
  checkPermission,
  createTask,
  transition,
  type PermissionGrant,
} from "@jellytind/agent-runtime";
import { OBJECT_STATUSES, OBJECT_VISIBILITIES } from "@jellytind/domain";
import { ContextCompiler, renderContextPackage } from "@jellytind/context-compiler";
import { ModelError, type LanguageModel, type OutputSchema } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  ACQUISITION_SOURCES,
  describeTransition,
  isQualitativeLevel,
  isRelationshipDimension,
  KNOWLEDGE_STATES,
  QUALITATIVE_LEVELS,
  RELATIONSHIP_DIMENSIONS,
  RELATIONSHIP_EVENT_KINDS,
  LOCATION_CHANGE_KINDS,
  TRANSITION_KINDS,
  validateTransition,
  type AcquisitionSource,
  type KnowledgeState,
  type StateTransition,
  type TransitionDraft,
  type LocationChangeKind,
  type TransitionKind,
} from "@jellytind/story-state";
import { EditError } from "./types";

const REQUIRED_PERMISSION = "edit_story_state" as const;

/** One change the model believes the scene makes to the story world. */
export interface ProposedTransition extends TransitionDraft {
  /** How sure the model is that this change happened. */
  readonly confidence: number;
  /** The model's stated evidence — a phrase from the scene. */
  readonly evidence: string;
  /** Set when the draft failed validation; it is shown but cannot be saved. */
  readonly problem?: string;
}

export interface StateProposal {
  readonly taskId: string;
  readonly sceneId: string;
  readonly transitions: readonly ProposedTransition[];
  /** Drafts that failed validation, kept visible rather than hidden. */
  readonly rejected: readonly ProposedTransition[];
  readonly modelId: string;
  readonly contextRecipe: string;
  readonly createdAt: string;
}

interface RawExtraction {
  readonly transitions: ReadonlyArray<Record<string, unknown>>;
}

const EXTRACTION_SCHEMA: OutputSchema<RawExtraction> = {
  name: "StateExtraction",
  parse(value: unknown): RawExtraction {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new EditError("empty_response", "StateExtraction: expected an object.");
    }
    const list = (value as { transitions?: unknown }).transitions;
    if (!Array.isArray(list)) {
      throw new EditError("empty_response", 'StateExtraction: "transitions" must be an array.');
    }
    return {
      transitions: list.filter(
        (t): t is Record<string, unknown> => typeof t === "object" && t !== null,
      ),
    };
  },
};

const SYSTEM_PROMPT = `You extract story-state changes from a scene in a fiction project.

You are given the scene's structured record, its prose, and the state of the story as it stood entering the scene — including what each character already knows or believes. Report what the scene *changes*, and nothing else.

Rules:
- Only report changes the scene actually shows or states. Do not infer offstage events.
- Use the entity IDs given in the context. Never invent an ID; if the change involves something with no ID, leave it out.
- Do not repeat state that was already true entering the scene.
- For information, distinguish carefully:
  - "known" — the character has it first-hand or beyond doubt;
  - "believed" — they accept it, but could be wrong;
  - "suspected" — they entertain it without accepting it;
  - "disbelieved" — they actively reject it;
  - "unknown" — they no longer hold it at all.
- Say how they came by it: witnessed, told, read, inferred, remembered, assumed, deceived, or unknown. When another character is the source, name them in sourceEntityId.
- A character can be told something false. Record what they now hold, not what is true; use "deceived" when they are being lied to.
- For objects, separate who *owns* a thing from who is *holding* it: a stolen revolver still belongs to its owner. Use object_holder when it changes hands and object_location when it is put down somewhere.
- Report object_status only when the scene changes it: ${OBJECT_STATUSES.join(", ")}. Do not mark something destroyed because it is merely lost or hidden.
- object_condition is free text for physical damage or change ("cracked", "bloodstained"); object_visibility is ${OBJECT_VISIBILITIES.join(", ")}.
- For a character arriving somewhere, use character_location with no movement. Use movement "departure" when they leave, "travel" while they are between places, and "unknown" when the scene deliberately hides where they are.
- For relationships, report a change of type or status when the scene shows one, and milestones (betrayal, alliance, reconciliation, and so on) when they occur.
- Relationship dimensions are optional analytical aids, not objective truth. Only report one when the scene clearly moves it, prefer a qualitative level over a number, and always give a reason.
- Give each change a confidence between 0 and 1 and quote the phrase that supports it.
- You are proposing, not deciding. A human confirms every change.`;

const FORMAT = `Reply with JSON only, matching:
{
  "transitions": [
    {
      "kind": "one of: ${TRANSITION_KINDS.join(", ")}",
      "subjectId": "the entity the change is about (CHAR_/OBJECT_/FACT_)",
      "value": "the new value: LOC_ for a location, CHAR_ for an owner, FACT_ for knowledge or a fact, or one of active/inactive/deceased/unknown for a status",
      "confidence": 0.0,
      "evidence": "the phrase in the scene that supports this",
      "knowledgeState": "${KNOWLEDGE_STATES.join(" | ")} — only for knowledge_changed",
      "sourceType": "${ACQUISITION_SOURCES.join(" | ")} — only for knowledge_changed",
      "sourceEntityId": "CHAR_ or OBJECT_ the information came from, when there is one",
      "certainty": 1.0,
      "movement": "${LOCATION_CHANGE_KINDS.join(" | ")} — only for character_location, omit for a plain arrival",
      "dimension": "${RELATIONSHIP_DIMENSIONS.join(" | ")} — only for relationship_dimension",
      "level": "${QUALITATIVE_LEVELS.join(" | ")} — preferred form for a dimension",
      "magnitude": 0.0
    }
  ]
}
For object_condition, object_status and object_visibility, subjectId is an OBJECT_ id and value is the new condition, status or visibility.
For relationship_type and relationship_status, subjectId is a REL_ id and value is the new type or status. For relationship_event, value is one of: ${RELATIONSHIP_EVENT_KINDS.join(", ")}.
Return an empty array if the scene changes nothing.`;

export interface StateExtractorOptions {
  readonly repo: StoryRepository;
  readonly model: LanguageModel;
  readonly grant: PermissionGrant;
  readonly now?: () => string;
  readonly maxContextTokens?: number;
}

/**
 * "Analyse state changes" — the optional operation offered after a scene is
 * written or edited.
 *
 * The model reads the scene *with* the state that preceded it and proposes
 * structured transitions. Nothing it proposes becomes canon: every draft is
 * shape-validated and reference-checked, then stored as `proposed` for a human
 * to confirm, correct or reject (AGENTS.md — "Canon vs Inference";
 * docs/STORY_STATE.md).
 */
export class StateExtractor {
  private readonly repo: StoryRepository;
  private readonly model: LanguageModel;
  private readonly grant: PermissionGrant;
  private readonly now: () => string;
  private readonly maxContextTokens: number;

  constructor(options: StateExtractorOptions) {
    this.repo = options.repo;
    this.model = options.model;
    this.grant = options.grant;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxContextTokens = options.maxContextTokens ?? 12_000;
  }

  /**
   * Analyse a scene and persist the model's proposals as **proposed**
   * transitions — visible, correctable, and excluded from canonical state until
   * confirmed.
   */
  async analyseScene(sceneId: string): Promise<StateProposal> {
    const decision = checkPermission(
      { name: "analyse_state_changes", permission: REQUIRED_PERMISSION },
      this.grant,
    );
    if (!decision.allowed) {
      throw new EditError("permission_denied", decision.reason, { details: { sceneId } });
    }

    const scene = (await this.repo.listScenes()).find((s) => s.id === sceneId);
    if (scene === undefined) {
      throw new EditError("unknown_target", `No scene exists with ID "${sceneId}".`);
    }

    const task = createTask({
      id: await this.repo.agents.nextTaskId(),
      goal: `analyse_state_changes: ${sceneId}`,
      now: this.now(),
      scope: [sceneId],
      allowedTools: [],
      approvalPolicy: "approve_every_edit",
    });
    await this.repo.agents.saveTask(task);
    let current = await this.repo.agents.saveTask(transition(task, "running", { now: this.now() }));

    try {
      const compiler = new ContextCompiler(this.repo, { now: this.now });
      const pkg = await compiler.compile({
        recipe: "scene_inspection",
        targetId: sceneId,
        instruction: `Identify the story-state changes ${sceneId} makes.`,
        budget: { maxTokens: this.maxContextTokens, reserveForOutput: 2_000 },
      });

      const raw = await this.model.generateStructured(
        {
          system: SYSTEM_PROMPT,
          messages: [
            { role: "user", content: renderContextPackage(pkg) },
            { role: "user", content: `Extract the state changes ${sceneId} makes.\n\n${FORMAT}` },
          ],
          schema: EXTRACTION_SCHEMA,
          maxOutputTokens: 2_000,
        },
        { timeoutMs: 120_000 },
      );

      const { valid, rejected } = this.sift(raw.transitions, sceneId);

      // Persist as proposals: inspectable and correctable, but not canon.
      if (valid.length > 0) {
        await this.repo.addStateTransitions(valid, {
          source: "agent",
          confirmationStatus: "proposed",
          modelId: this.model.id,
          taskId: current.id,
          summary: `Proposed ${String(valid.length)} state change(s) from ${sceneId}`,
        });
      }

      current = await this.repo.agents.saveTask(
        transition(current, "awaiting_approval", { now: this.now() }),
      );
      await this.repo.agents.appendActivity({
        taskId: current.id,
        timestamp: this.now(),
        tool: "analyse_state_changes",
        argumentsSummary: `scene=${sceneId}`,
        resultSummary: `${String(valid.length)} proposed, ${String(rejected.length)} unusable`,
        status: "ok",
      });

      return {
        taskId: current.id,
        sceneId,
        transitions: valid,
        rejected,
        modelId: this.model.id,
        contextRecipe: pkg.metadata.recipe,
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

  /**
   * Split the model's drafts into usable and unusable.
   *
   * A draft naming an entity kind that does not match its transition kind — the
   * classic hallucinated-ID failure — is set aside with the reason rather than
   * silently dropped, so the author can see what the model tried to claim.
   */
  private sift(
    raw: ReadonlyArray<Record<string, unknown>>,
    sceneId: string,
  ): { valid: ProposedTransition[]; rejected: ProposedTransition[] } {
    const valid: ProposedTransition[] = [];
    const rejected: ProposedTransition[] = [];

    for (const entry of raw) {
      const draft: ProposedTransition = {
        sceneId,
        kind: String(entry.kind ?? "") as TransitionKind,
        subjectId: String(entry.subjectId ?? ""),
        value: String(entry.value ?? ""),
        confidence: clamp(entry.confidence),
        evidence: typeof entry.evidence === "string" ? entry.evidence : "",
        ...(typeof entry.certainty === "number" ? { certainty: clamp(entry.certainty) } : {}),
        ...(isKnowledgeState(entry.knowledgeState) ? { knowledgeState: entry.knowledgeState } : {}),
        ...(isAcquisitionSource(entry.sourceType) ? { sourceType: entry.sourceType } : {}),
        ...(typeof entry.sourceEntityId === "string" && entry.sourceEntityId !== ""
          ? { sourceEntityId: entry.sourceEntityId }
          : {}),
        ...(isLocationChangeKind(entry.movement) ? { movement: entry.movement } : {}),
        ...(isRelationshipDimension(entry.dimension) ? { dimension: entry.dimension } : {}),
        ...(isQualitativeLevel(entry.level) ? { level: entry.level } : {}),
        ...(typeof entry.magnitude === "number" ? { magnitude: clamp(entry.magnitude) } : {}),
        note: typeof entry.evidence === "string" ? `Evidence: ${entry.evidence}` : undefined,
      };

      try {
        validateTransition(draft);
        valid.push(draft);
      } catch (cause) {
        rejected.push({
          ...draft,
          problem: cause instanceof Error ? cause.message : "invalid transition",
        });
      }
    }
    return { valid, rejected };
  }

  /** Confirm a proposed transition, making it canon. */
  confirm(transitionId: string): Promise<StateTransition> {
    return this.repo.setTransitionStatus(transitionId, "confirmed");
  }

  /** Reject a proposal. It stays visible as a considered-and-dismissed record. */
  reject(transitionId: string): Promise<StateTransition> {
    return this.repo.setTransitionStatus(transitionId, "rejected");
  }

  /** A one-line rendering of a proposal, for the confirm/edit/reject list. */
  static describe(t: ProposedTransition): string {
    return describeTransition(t);
  }
}

function clamp(value: unknown): number {
  const n = typeof value === "number" ? value : 0.5;
  return Math.min(1, Math.max(0, n));
}

function isKnowledgeState(value: unknown): value is KnowledgeState {
  return typeof value === "string" && (KNOWLEDGE_STATES as readonly string[]).includes(value);
}

function isAcquisitionSource(value: unknown): value is AcquisitionSource {
  return typeof value === "string" && (ACQUISITION_SOURCES as readonly string[]).includes(value);
}

function isLocationChangeKind(value: unknown): value is LocationChangeKind {
  return typeof value === "string" && (LOCATION_CHANGE_KINDS as readonly string[]).includes(value);
}
