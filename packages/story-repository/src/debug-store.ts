import { WRITER_DIR } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";
import type { DebugReport, DebugReportSummary } from "@jellytind/story-debugger";

const DIR = `${WRITER_DIR}/debug`;
const INDEX = `${DIR}/index.json`;

interface Index {
  seq: number;
  reports: DebugReportSummary[];
}

/**
 * Persists debug reports under `.writer/debug/`.
 *
 * A report is **derived**, not canon: it is what the project's state implies
 * about a question, and producing one changes nothing about the story. So it
 * goes straight to the store rather than through the journal — the same
 * treatment builds get, and for the same reason: a writer's revision history
 * should contain the changes they made, not the questions they asked
 * (docs/VERSIONING.md).
 *
 * Summaries live in one index so the list is a single read; each report's
 * evidence lives in its own file, because a debug run can gather a great deal
 * and none of it is needed to answer "what have I investigated?".
 */
export class DebugStore {
  constructor(private readonly store: ProjectStore) {}

  private async readIndex(): Promise<Index> {
    const raw = await this.store.readFile(INDEX);
    if (raw === null) return { seq: 0, reports: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<Index>;
      return {
        seq: typeof parsed.seq === "number" ? parsed.seq : 0,
        reports: Array.isArray(parsed.reports) ? parsed.reports : [],
      };
    } catch {
      return { seq: 0, reports: [] };
    }
  }

  /** The ID the next report will carry. */
  async nextId(): Promise<string> {
    return `DEBUG_${String((await this.readIndex()).seq + 1).padStart(4, "0")}`;
  }

  /** Report summaries, newest first. */
  async list(limit = 50): Promise<DebugReportSummary[]> {
    const index = await this.readIndex();
    return [...index.reports].reverse().slice(0, limit);
  }

  async get(id: string): Promise<DebugReport | null> {
    const raw = await this.store.readFile(`${DIR}/${id}.json`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as DebugReport;
    } catch {
      return null;
    }
  }

  async save(report: DebugReport): Promise<void> {
    const index = await this.readIndex();
    index.seq += 1;
    index.reports.push({
      id: report.id,
      mode: report.mode,
      problem: report.problem,
      createdAt: report.createdAt,
      evidenceCount: report.evidence.length,
      diagnosed: report.diagnosis !== undefined,
    });
    await this.store.writeFile(`${DIR}/${report.id}.json`, `${JSON.stringify(report, null, 2)}\n`);
    await this.store.writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`);
  }
}
