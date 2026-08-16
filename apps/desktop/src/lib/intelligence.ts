import {
  Autopilot,
  type AnalysisKind,
  type IntelAnalyst,
  type IntelFinding,
  type IntelProposal,
  type KnownEntity,
  type ProseUnit,
} from "@jellytind/autopilot";
import { chapterBody } from "@jellytind/story-mapper";
import { listSceneSpans, type StoryRepository } from "@jellytind/story-repository";
import type { SecretStore } from "@jellytind/model-router";
import { createRoutedModel } from "./routing";
import { loadAiSettings } from "./connections";

/**
 * The autopilot's home in the desktop app (Phase 44).
 *
 * Prose units come from the real chapter files: each scene marker span is a
 * unit, and a chapter without markers is one unit. Explicit scene metadata —
 * a POV or location the author set — is passed as authoritative, so the
 * engine never proposes over it (§20). The analyst goes through the Model
 * Router's `manuscript_mapping` operation, which is cheap-analysis class,
 * local-eligible and privacy-governed: a Local Only policy means prose never
 * leaves the machine, because routing refuses cloud models before any call
 * exists (§27, §29).
 */

export interface IntelligenceRuntime {
  readonly pilot: Autopilot;
  /** Debounced entry point: call after autosave or idle; never per keystroke. */
  noteChangeSoon(): void;
  drainNow(): Promise<void>;
}

async function units(repo: StoryRepository): Promise<ProseUnit[]> {
  const [chapters, scenes] = await Promise.all([repo.listChapters(), repo.listScenes()]);
  const byId = new Map(scenes.map((scene) => [scene.id as string, scene]));
  const out: ProseUnit[] = [];
  for (const chapter of [...chapters].sort((a, b) => a.order - b.order)) {
    const raw = (await repo.readProjectFile(chapter.filePath)) ?? "";
    const body = chapterBody(raw);
    const spans = listSceneSpans(body);
    if (spans.length === 0) {
      out.push({
        sceneId: chapter.id as string,
        chapterId: chapter.id as string,
        title: chapter.title,
        text: body,
      });
      continue;
    }
    for (let index = 0; index < spans.length; index += 1) {
      const span = spans[index];
      if (span === undefined) continue;
      const end = spans[index + 1]?.start ?? body.length;
      const record = byId.get(span.sceneId);
      const authoritative = [
        ...(record?.pov !== undefined ? ["pov"] : []),
        ...(record?.locationId !== undefined ? ["location"] : []),
      ];
      out.push({
        sceneId: span.sceneId,
        chapterId: chapter.id as string,
        title: record?.title ?? `${chapter.title} — scene ${String(index + 1)}`,
        text: body.slice(span.start, end),
        ...(authoritative.length > 0 ? { authoritative } : {}),
      });
    }
  }
  return out;
}

async function entities(repo: StoryRepository): Promise<KnownEntity[]> {
  const summaries = await repo.listEntitySummaries();
  return summaries
    .filter((held) => ["character", "location", "object", "plot_thread"].includes(held.kind))
    .map((held) => ({ id: held.id, kind: held.kind, name: held.name, aliases: [] }));
}

interface FindingsPayload {
  readonly findings?: unknown;
}

function parseFindings(value: unknown): IntelFinding[] {
  const held = (value ?? {}) as FindingsPayload;
  if (!Array.isArray(held.findings)) return [];
  const out: IntelFinding[] = [];
  for (const entry of held.findings) {
    const raw = (entry ?? {}) as Record<string, unknown>;
    if (typeof raw["summary"] !== "string" || raw["summary"].trim() === "") continue;
    const confidence = raw["confidence"];
    out.push({
      summary: raw["summary"],
      confidence: confidence === "high" || confidence === "low" ? confidence : "medium",
      ...(typeof raw["quote"] === "string" ? { quote: raw["quote"] } : {}),
      ...(typeof raw["payload"] === "object" && raw["payload"] !== null
        ? { payload: raw["payload"] as Record<string, unknown> }
        : {}),
    });
  }
  return out.slice(0, 6);
}

function createAnalyst(repo: StoryRepository, secrets: SecretStore): IntelAnalyst {
  return {
    async read(kind: AnalysisKind, request) {
      const { model } = await createRoutedModel(repo, secrets, "manuscript_mapping");
      return model.generateStructured({
        system:
          "You maintain a novel's structured story data from its prose. Report only what the " +
          "prose supports; never invent precision it lacks. Reply as JSON: " +
          '{"findings":[{"summary":string,"confidence":"low"|"medium"|"high","quote"?:string,"payload"?:object}]} ' +
          "with at most six findings. An empty list is a correct answer.",
        messages: [
          {
            role: "user",
            content: `Task (${kind}): ${request.briefing}\n\nScene: ${request.sceneTitle}\n\n---\n${request.text.slice(0, 24_000)}`,
          },
        ],
        maxOutputTokens: 900,
        schema: { name: "intel_findings", parse: parseFindings },
      });
    },
  };
}

/**
 * Applying accepted intelligence. Everything resolvable lands as its real
 * record — a character, a state transition, a relationship. Anything the
 * project cannot yet anchor (an unknown name, a thread that already exists)
 * lands as a *provisional fact* carrying the evidence, so the inference is
 * preserved and reviewable rather than dropped or guessed at.
 */
async function applyIntel(repo: StoryRepository, proposal: IntelProposal): Promise<string[]> {
  const summaries = await repo.listEntitySummaries();
  const byName = new Map(summaries.map((held) => [held.name.toLowerCase(), held]));
  const resolve = (name: unknown, kind?: string) => {
    const found = byName.get(String(name ?? "").toLowerCase());
    return found !== undefined && (kind === undefined || found.kind === kind) ? found : undefined;
  };
  const evidence = proposal.evidence[0];
  const source = `Story Intelligence${evidence !== undefined ? ` — ${evidence.sceneTitle}` : ""}`;
  const fallbackFact = async (): Promise<string[]> => {
    const fact = await repo.addFact({
      statement: proposal.summary,
      status: "provisional",
      source,
    });
    return [fact.id as string];
  };

  switch (proposal.kind) {
    case "new_entity": {
      const character = await repo.addCharacter({
        name: String(proposal.payload["name"] ?? proposal.summary),
        aliases: [],
        role: "",
        notes: `Proposed by Story Intelligence. ${proposal.because}`,
      });
      return [character.id as string];
    }
    case "fact": {
      const fact = await repo.addFact({
        statement: String(proposal.payload["statement"] ?? proposal.summary),
        status: proposal.origin === "model" ? "provisional" : "canonical",
        source,
      });
      return [fact.id as string];
    }
    case "state_transition": {
      const character = resolve(proposal.payload["character"], "character");
      const location = resolve(proposal.payload["value"], "location");
      if (
        character !== undefined &&
        location !== undefined &&
        String(proposal.payload["field"]) === "location" &&
        evidence !== undefined
      ) {
        const transitions = await repo.addStateTransitions(
          [
            {
              sceneId: evidence.sceneId,
              kind: "character_location",
              subjectId: character.id,
              value: location.id,
              movement: "arrival",
            },
          ],
          { source: "agent", confirmationStatus: "confirmed", summary: proposal.summary },
        );
        return transitions.map((held) => held.id as string);
      }
      return fallbackFact();
    }
    case "object_transfer": {
      const object = resolve(proposal.payload["object"], "object");
      const holder = resolve(proposal.payload["holder"], "character");
      if (object !== undefined && holder !== undefined && evidence !== undefined) {
        const transitions = await repo.addStateTransitions(
          [
            {
              sceneId: evidence.sceneId,
              kind: "object_holder",
              subjectId: object.id,
              value: holder.id,
            },
          ],
          { source: "agent", confirmationStatus: "confirmed", summary: proposal.summary },
        );
        return transitions.map((held) => held.id as string);
      }
      return fallbackFact();
    }
    case "knowledge": {
      const character = resolve(proposal.payload["character"], "character");
      if (character !== undefined && evidence !== undefined) {
        const fact = await repo.addFact({
          statement: String(proposal.payload["fact"] ?? proposal.summary),
          status: "provisional",
          source,
        });
        const transitions = await repo.addStateTransitions(
          [
            {
              sceneId: evidence.sceneId,
              kind: "knowledge_changed",
              subjectId: character.id,
              value: fact.id as string,
              knowledgeState: "known",
            },
          ],
          { source: "agent", confirmationStatus: "confirmed", summary: proposal.summary },
        );
        return [fact.id as string, ...transitions.map((held) => held.id as string)];
      }
      return fallbackFact();
    }
    case "relationship": {
      const a = resolve(proposal.payload["a"], "character");
      const b = resolve(proposal.payload["b"], "character");
      if (a !== undefined && b !== undefined) {
        const relationship = await repo.addRelationship({
          characterAId: a.id as never,
          characterBId: b.id as never,
          type: String(proposal.payload["change"] ?? "unspecified"),
          description: proposal.summary,
        });
        return [relationship.id as string];
      }
      return fallbackFact();
    }
    case "thread": {
      const existing = resolve(proposal.payload["thread"], "plot_thread");
      if (existing === undefined && String(proposal.payload["movement"]) === "new") {
        const thread = await repo.addPlotThread({
          name: String(proposal.payload["thread"] ?? proposal.summary),
          description: proposal.summary,
          status: "active",
        });
        return [thread.id as string];
      }
      return fallbackFact();
    }
    case "alias":
    case "scene_metadata":
    case "timeline":
      return fallbackFact();
  }
}

export async function createIntelligenceRuntime(
  repo: StoryRepository,
  secrets: SecretStore,
  onSettled?: () => void,
): Promise<IntelligenceRuntime> {
  const ai = loadAiSettings();
  const pilot = await Autopilot.open({
    files: repo,
    units: () => units(repo),
    entities: () => entities(repo),
    analyst: ai.connections.length === 0 ? null : createAnalyst(repo, secrets),
    applier: { apply: (proposal) => applyIntel(repo, proposal) },
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let working = false;
  const drainNow = async () => {
    if (working) return;
    working = true;
    try {
      await pilot.noteChange();
      await pilot.drain(6);
    } finally {
      working = false;
      onSettled?.();
    }
  };

  return {
    pilot,
    // §4: debounced — the editor calls this after saves; analysis starts
    // only once the writer has been quiet for a few seconds.
    noteChangeSoon() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void drainNow();
      }, 4_000);
    },
    drainNow,
  };
}
