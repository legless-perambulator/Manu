import { WRITER_DIR } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

const USAGE_DIR = `${WRITER_DIR}/usage`;
const LEDGER_PATH = `${USAGE_DIR}/ledger.json`;
const FEEDBACK_PATH = `${USAGE_DIR}/feedback.json`;

/**
 * One model call as it actually happened (Phase 36 §10). Structurally the
 * `UsageRecord` the model-router's cost layer produces; stored verbatim.
 * Token counts are the provider's own numbers; `cost` is present only when
 * pricing was known at the time — an absent cost means *unknown*, never zero.
 */
export interface StoredUsageRecord {
  readonly at: string;
  readonly operation?: string;
  readonly routingClass?: string;
  readonly buildId?: string;
  readonly connectionId?: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly local: boolean;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly cost?: { readonly amount: number; readonly currency: string };
  readonly estimated?: boolean;
}

/** The writer's verdict on a piece of model output (Phase 36 §18). */
export interface ModelFeedbackRecord {
  readonly at: string;
  readonly verdict: "good" | "poor";
  readonly modelId: string;
  readonly operation?: string;
  readonly buildId?: string;
  readonly note?: string;
}

interface Ledger {
  records: StoredUsageRecord[];
}

interface FeedbackFile {
  entries: ModelFeedbackRecord[];
}

/**
 * The project's usage ledger: what was actually spent, call by call, and what
 * the writer thought of the results (Phase 36 §10–§11, §18).
 *
 * Lives under `.writer/usage/` — accounting is working state, not authored
 * knowledge, so it is not journaled. It IS the project's memory of spend: the
 * cost dashboard, the monthly budget check and "project lifetime" all read
 * this one file, and nothing here is ever estimated after the fact — records
 * land as calls complete, or not at all.
 */
export class UsageStore {
  constructor(private readonly store: ProjectStore) {}

  private async readLedger(): Promise<Ledger> {
    const raw = await this.store.readFile(LEDGER_PATH);
    if (raw === null) return { records: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<Ledger>;
      return { records: Array.isArray(parsed.records) ? parsed.records : [] };
    } catch {
      return { records: [] };
    }
  }

  async append(record: StoredUsageRecord): Promise<void> {
    const ledger = await this.readLedger();
    ledger.records.push(record);
    await this.store.createDirectory(USAGE_DIR);
    await this.store.writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
  }

  async list(filter?: {
    readonly since?: string;
    readonly buildId?: string;
  }): Promise<StoredUsageRecord[]> {
    const ledger = await this.readLedger();
    return ledger.records.filter(
      (record) =>
        (filter?.since === undefined || record.at >= filter.since) &&
        (filter?.buildId === undefined || record.buildId === filter.buildId),
    );
  }

  private async readFeedback(): Promise<FeedbackFile> {
    const raw = await this.store.readFile(FEEDBACK_PATH);
    if (raw === null) return { entries: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<FeedbackFile>;
      return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
    } catch {
      return { entries: [] };
    }
  }

  async appendFeedback(entry: ModelFeedbackRecord): Promise<void> {
    const feedback = await this.readFeedback();
    feedback.entries.push(entry);
    await this.store.createDirectory(USAGE_DIR);
    await this.store.writeFile(FEEDBACK_PATH, `${JSON.stringify(feedback, null, 2)}\n`);
  }

  async listFeedback(): Promise<ModelFeedbackRecord[]> {
    return (await this.readFeedback()).entries;
  }
}
