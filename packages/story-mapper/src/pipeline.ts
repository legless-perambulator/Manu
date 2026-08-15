import { countWords } from "@jellytind/manuscript-io";
import {
  MAPPING_STEPS,
  SEMANTIC_STEPS,
  type MappingProposal,
  type MappingRun,
  type MappingScope,
  type MappingSourceChapter,
  type MappingStep,
  type MappingStepRecord,
} from "./types";
import {
  characterCandidates,
  characterProposals,
  importanceProposals,
  locationProposals,
  objectProposals,
  sceneProposals,
} from "./deterministic";
import {
  excerptsOf,
  type MappingAnalyst,
  type MappingExcerpt,
  type SemanticMappingKind,
} from "./analyst";

/**
 * Map Manuscript (§7, §8): the persistent, resumable pipeline.
 *
 * Not one model call. Deterministic steps parse the whole book cheaply;
 * semantic steps walk it one bounded excerpt at a time, and progress is
 * persisted after every chunk — so a 150,000-word mapping can be paused,
 * the app closed, and the run resumed exactly where it stopped (§27).
 */

/** Where mapping state lives. The desktop backs this with project files. */
export interface MappingStorePort {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
}

export const MAPPING_RUN_PATH = ".writer/mapping/run.json";
export const MAPPING_PROPOSALS_PATH = ".writer/mapping/proposals.json";

const BRIEFINGS: Readonly<Record<SemanticMappingKind, string>> = {
  facts:
    "List candidate canonical story facts stated or strongly implied by this excerpt. One per finding, statement in the summary, with a supporting quote. Do not invent.",
  timeline:
    "Note chronology signals: dates, elapsed time, flashbacks, parallel action, or events clearly out of presentation order. Unknown chronology stays unknown.",
  knowledge:
    "Note moments where a character learns, infers or is told something, or comes to believe something false. Name the character, what they learn, and how.",
  relationships:
    "Note the relationships in play and any change in them: conflict, alliance, betrayal, romance. Qualitative only, with evidence.",
  threads:
    "Name the narrative threads this excerpt advances or introduces, as short noun phrases a writer would recognise.",
  setup_payoff:
    "Note apparent setups or foreshadowing, and any payoff of something planted earlier. Quote the planting line.",
  causality:
    "Note events in this excerpt that clearly depend on, or enable, other story events. State both sides.",
  voice:
    "Describe the author's prose style in this excerpt: sentence rhythm, description density, dialogue handling, pacing tendencies.",
  character_voice:
    "For characters with dialogue in this excerpt, describe how each speaks, quoting a representative line.",
  summaries: "Summarise what happens in this excerpt in two or three sentences.",
};

const KIND_FOR_STEP: Partial<Record<MappingStep, SemanticMappingKind>> = {
  facts: "facts",
  timeline: "timeline",
  knowledge: "knowledge",
  relationships: "relationships",
  threads: "threads",
  setup_payoff: "setup_payoff",
  causality: "causality",
  voice: "voice",
  character_voice: "character_voice",
  summaries: "summaries",
};

const CATEGORY_FOR_KIND: Readonly<Record<SemanticMappingKind, MappingProposal["category"]>> = {
  facts: "fact",
  timeline: "timeline",
  knowledge: "knowledge",
  relationships: "relationship",
  threads: "thread",
  setup_payoff: "setup_payoff",
  causality: "causality",
  voice: "voice",
  character_voice: "character_voice",
  summaries: "summary",
};

/** Voice needs a sample, not the whole book: first, middle and last chapters. */
function voiceSample(chapters: readonly MappingSourceChapter[]): MappingSourceChapter[] {
  if (chapters.length <= 3) return [...chapters];
  const middle = chapters[Math.floor(chapters.length / 2)] as MappingSourceChapter;
  return [
    chapters[0] as MappingSourceChapter,
    middle,
    chapters[chapters.length - 1] as MappingSourceChapter,
  ];
}

export interface MapperOptions {
  readonly source: readonly MappingSourceChapter[];
  readonly store: MappingStorePort;
  readonly analyst?: MappingAnalyst;
  readonly now?: () => string;
}

export class StoryMapper {
  private readonly source: readonly MappingSourceChapter[];
  private readonly store: MappingStorePort;
  private readonly analyst: MappingAnalyst | null;
  private readonly now: () => string;
  private run: MappingRun | null = null;
  private held: MappingProposal[] = [];

  constructor(options: MapperOptions) {
    this.source = options.source;
    this.store = options.store;
    this.analyst = options.analyst ?? null;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** Honest scope before starting (§29): counts, not promises. */
  scope(): MappingScope {
    const words = this.source.reduce((sum, chapter) => sum + countWords(chapter.text), 0);
    const perChapterKinds = SEMANTIC_STEPS.length - 2; // voice + summaries sampled/short.
    const excerptCount = this.source.reduce((sum, chapter) => sum + excerptsOf(chapter).length, 0);
    return {
      words,
      chapters: this.source.length,
      estimatedOperations:
        this.analyst === null
          ? 0
          : excerptCount * perChapterKinds + voiceSample(this.source).length + this.source.length,
    };
  }

  async load(): Promise<MappingRun | null> {
    if (this.run !== null) return this.run;
    const rawRun = await this.store.read(MAPPING_RUN_PATH);
    const rawProposals = await this.store.read(MAPPING_PROPOSALS_PATH);
    if (rawRun !== null) this.run = JSON.parse(rawRun) as MappingRun;
    if (rawProposals !== null) this.held = JSON.parse(rawProposals) as MappingProposal[];
    return this.run;
  }

  async proposals(): Promise<readonly MappingProposal[]> {
    await this.load();
    return this.held;
  }

  /** Start a fresh run, or pick an interrupted one back up (§27). */
  async start(): Promise<MappingRun> {
    const existing = await this.load();
    if (existing !== null && existing.status !== "completed" && existing.status !== "failed") {
      this.run = { ...existing, status: "running", updatedAt: this.now() };
      await this.persist();
      return this.run;
    }
    const steps: MappingStepRecord[] = MAPPING_STEPS.map((id) => ({
      id,
      status: "pending",
      chunksDone: 0,
      chunksTotal: this.chunksFor(id),
    }));
    this.run = {
      id: `mapping-${Date.now()}`,
      status: "running",
      steps,
      startedAt: this.now(),
      updatedAt: this.now(),
    };
    this.held = [];
    await this.persist();
    return this.run;
  }

  async pause(): Promise<MappingRun> {
    await this.load();
    if (this.run !== null && this.run.status === "running") {
      this.run = { ...this.run, status: "paused", updatedAt: this.now() };
      await this.persist();
    }
    return this.run as MappingRun;
  }

  /**
   * Do the next unit of work: a whole deterministic step, or one chapter of a
   * semantic step. Returns whether anything remains. Persisted every time.
   */
  async advance(): Promise<{ run: MappingRun; done: boolean }> {
    await this.load();
    if (this.run === null) await this.start();
    const run = this.run as MappingRun;
    if (run.status !== "running") return { run, done: run.status === "completed" };

    const stepIndex = run.steps.findIndex(
      (step) => step.status === "pending" || step.status === "running",
    );
    if (stepIndex === -1) {
      this.run = { ...run, status: "completed", updatedAt: this.now() };
      await this.persist();
      return { run: this.run, done: true };
    }
    const step = run.steps[stepIndex] as MappingStepRecord;

    try {
      const updated = await this.work(step);
      const steps = [...run.steps];
      steps[stepIndex] = updated;
      const allDone = steps.every((held) => held.status === "done" || held.status === "skipped");
      this.run = {
        ...run,
        steps,
        status: allDone ? "completed" : "running",
        updatedAt: this.now(),
      };
      await this.persist();
      return { run: this.run, done: allDone };
    } catch (cause) {
      this.run = {
        ...run,
        status: "failed",
        error: cause instanceof Error ? cause.message : String(cause),
        updatedAt: this.now(),
      };
      await this.persist();
      return { run: this.run, done: true };
    }
  }

  /** Run until completion, pause, or failure. */
  async runToCompletion(options: { shouldPause?: () => boolean } = {}): Promise<MappingRun> {
    for (;;) {
      if (options.shouldPause?.() === true) return this.pause();
      const { run, done } = await this.advance();
      if (done || run.status !== "running") return run;
    }
  }

  private chunksFor(step: MappingStep): number {
    if (!SEMANTIC_STEPS.includes(step)) return 1;
    if (step === "voice") return voiceSample(this.source).length;
    return this.source.length;
  }

  private async work(step: MappingStepRecord): Promise<MappingStepRecord> {
    // Deterministic steps: parse everything at once — no model, no chunks.
    switch (step.id) {
      case "scenes":
        this.merge(sceneProposals(this.source));
        return { ...step, status: "done", chunksDone: 1, chunksTotal: 1 };
      case "characters":
        this.merge(characterProposals(this.source));
        return { ...step, status: "done", chunksDone: 1, chunksTotal: 1 };
      case "aliases":
        // Alias proposals are produced with the characters; this step exists
        // so review can see resolution as its own concern.
        return { ...step, status: "done", chunksDone: 1, chunksTotal: 1 };
      case "importance":
        this.merge(importanceProposals(this.source, characterCandidates(this.source)));
        return { ...step, status: "done", chunksDone: 1, chunksTotal: 1 };
      case "locations": {
        const names = new Set(characterCandidates(this.source).map((held) => held.canonical));
        this.merge(locationProposals(this.source, names));
        return { ...step, status: "done", chunksDone: 1, chunksTotal: 1 };
      }
      case "objects":
        this.merge(objectProposals(this.source));
        return { ...step, status: "done", chunksDone: 1, chunksTotal: 1 };
      case "validation": {
        const needing = this.held.filter((held) => held.status === "needs_review").length;
        return {
          ...step,
          status: "done",
          chunksDone: 1,
          chunksTotal: 1,
          note: `${this.held.length} proposals, ${needing} needing review.`,
        };
      }
      default:
        break;
    }

    // Semantic steps: one chapter excerpt per advance, resumable mid-step.
    const kind = KIND_FOR_STEP[step.id];
    /* istanbul ignore next — every non-deterministic step has a kind. */
    if (kind === undefined) return { ...step, status: "done", chunksDone: 1, chunksTotal: 1 };

    if (this.analyst === null) {
      return {
        ...step,
        status: "skipped",
        note: "No model configured — semantic mapping skipped, not guessed.",
      };
    }

    const chapters = step.id === "voice" ? voiceSample(this.source) : [...this.source];
    const chapter = chapters[step.chunksDone];
    if (chapter === undefined) {
      return { ...step, status: "done", chunksDone: step.chunksTotal };
    }

    for (const excerpt of excerptsOf(chapter)) {
      const findings = await this.analyst.analyse(kind, excerpt, BRIEFINGS[kind]);
      this.merge(findings.map((finding, index) => this.proposalOf(kind, excerpt, finding, index)));
    }
    const chunksDone = step.chunksDone + 1;
    return {
      ...step,
      status: chunksDone >= chapters.length ? "done" : "running",
      chunksDone,
      chunksTotal: chapters.length,
    };
  }

  private proposalOf(
    kind: SemanticMappingKind,
    excerpt: MappingExcerpt,
    finding: {
      summary: string;
      confidence: MappingProposal["confidence"];
      quote?: string;
      payload?: Readonly<Record<string, unknown>>;
    },
    index: number,
  ): MappingProposal {
    const category = CATEGORY_FOR_KIND[kind];
    return {
      id: `${category}:${excerpt.chapterIndex}:${excerpt.part}:${index}:${finding.summary.slice(0, 40)}`,
      category,
      // Model output is never silently canon (§14, §16, §21): low-confidence
      // findings demand review; the rest still wait for acceptance.
      status: finding.confidence === "low" ? "needs_review" : "proposed",
      confidence: finding.confidence,
      origin: "model",
      summary: finding.summary,
      evidence: [
        {
          chapterIndex: excerpt.chapterIndex,
          chapterTitle: excerpt.chapterTitle,
          ...(finding.quote !== undefined ? { quote: finding.quote } : {}),
        },
      ],
      payload: finding.payload ?? {},
    };
  }

  private merge(incoming: readonly MappingProposal[]): void {
    for (const proposal of incoming) {
      const existing = this.held.findIndex((held) => held.id === proposal.id);
      if (existing === -1) this.held.push(proposal);
      // A re-run never clobbers a reviewed decision.
      else if (
        this.held[existing]?.status === "proposed" ||
        this.held[existing]?.status === "needs_review"
      ) {
        this.held[existing] = proposal;
      }
    }
  }

  private async persist(): Promise<void> {
    await this.store.write(MAPPING_RUN_PATH, JSON.stringify(this.run, null, 2));
    await this.store.write(MAPPING_PROPOSALS_PATH, JSON.stringify(this.held, null, 2));
  }
}
