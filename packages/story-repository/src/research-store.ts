import { WRITER_DIR } from "@jellytind/domain";
import type { ResearchItem, ResearchTask } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";
import { RepositoryError } from "./errors";

const ITEM_DIR = "research/library";
const ITEM_INDEX = `${ITEM_DIR}/index.json`;
const TASK_DIR = `${WRITER_DIR}/research/tasks`;
const TASK_INDEX = `${TASK_DIR}/index.json`;

interface ItemIndex {
  seq: number;
  ids: string[];
}

interface TaskIndex {
  seq: number;
  ids: string[];
}

/**
 * The research library on disk.
 *
 * Items live under `research/library/` — beside the writer's loose research
 * documents, but as structured records — because sourced research is authored
 * project knowledge: it is journaled, versioned and backed up with everything
 * else the writer owns, and provenance survives restarts because it is simply
 * part of the file (§3, §28.9).
 *
 * Tasks live under `.writer/research/tasks/`: a question being worked on is
 * working state, not authored knowledge. Its findings are items, which are.
 */
export class ResearchStore {
  constructor(private readonly store: ProjectStore) {}

  // ── Items ────────────────────────────────────────────────────────────────

  private async readItemIndex(): Promise<ItemIndex> {
    const raw = await this.store.readFile(ITEM_INDEX);
    if (raw === null) return { seq: 0, ids: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<ItemIndex>;
      return {
        seq: typeof parsed.seq === "number" ? parsed.seq : 0,
        ids: Array.isArray(parsed.ids) ? parsed.ids : [],
      };
    } catch {
      return { seq: 0, ids: [] };
    }
  }

  async nextItemId(): Promise<string> {
    const index = await this.readItemIndex();
    index.seq += 1;
    await this.store.createDirectory(ITEM_DIR);
    await this.store.writeFile(ITEM_INDEX, `${JSON.stringify(index, null, 2)}\n`);
    return `RES_${String(index.seq).padStart(4, "0")}`;
  }

  async getItem(id: string): Promise<ResearchItem | null> {
    const raw = await this.store.readFile(`${ITEM_DIR}/${id}.json`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as ResearchItem;
    } catch {
      return null;
    }
  }

  async listItems(): Promise<ResearchItem[]> {
    const index = await this.readItemIndex();
    const out: ResearchItem[] = [];
    for (const id of index.ids) {
      const item = await this.getItem(id);
      if (item !== null) out.push(item);
    }
    return out;
  }

  async saveItem(item: ResearchItem): Promise<ResearchItem> {
    await this.store.createDirectory(ITEM_DIR);
    await this.store.writeFile(`${ITEM_DIR}/${item.id}.json`, `${JSON.stringify(item, null, 2)}\n`);
    const index = await this.readItemIndex();
    if (!index.ids.includes(item.id)) {
      index.ids.push(item.id);
      await this.store.writeFile(ITEM_INDEX, `${JSON.stringify(index, null, 2)}\n`);
    }
    return item;
  }

  async removeItem(id: string): Promise<void> {
    if ((await this.getItem(id)) === null) {
      throw new RepositoryError("entity_not_found", `No research item with id ${id}.`);
    }
    await this.store.delete(`${ITEM_DIR}/${id}.json`);
    const index = await this.readItemIndex();
    index.ids = index.ids.filter((held) => held !== id);
    await this.store.writeFile(ITEM_INDEX, `${JSON.stringify(index, null, 2)}\n`);
  }

  // ── Tasks ────────────────────────────────────────────────────────────────

  private async readTaskIndex(): Promise<TaskIndex> {
    const raw = await this.store.readFile(TASK_INDEX);
    if (raw === null) return { seq: 0, ids: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<TaskIndex>;
      return {
        seq: typeof parsed.seq === "number" ? parsed.seq : 0,
        ids: Array.isArray(parsed.ids) ? parsed.ids : [],
      };
    } catch {
      return { seq: 0, ids: [] };
    }
  }

  async nextTaskId(): Promise<string> {
    const index = await this.readTaskIndex();
    index.seq += 1;
    await this.store.createDirectory(TASK_DIR);
    await this.store.writeFile(TASK_INDEX, `${JSON.stringify(index, null, 2)}\n`);
    return `RTASK_${String(index.seq).padStart(4, "0")}`;
  }

  async getTask(id: string): Promise<ResearchTask | null> {
    const raw = await this.store.readFile(`${TASK_DIR}/${id}.json`);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as ResearchTask;
    } catch {
      return null;
    }
  }

  async listTasks(): Promise<ResearchTask[]> {
    const index = await this.readTaskIndex();
    const out: ResearchTask[] = [];
    for (const id of index.ids) {
      const task = await this.getTask(id);
      if (task !== null) out.push(task);
    }
    return out;
  }

  async saveTask(task: ResearchTask): Promise<ResearchTask> {
    await this.store.createDirectory(TASK_DIR);
    await this.store.writeFile(`${TASK_DIR}/${task.id}.json`, `${JSON.stringify(task, null, 2)}\n`);
    const index = await this.readTaskIndex();
    if (!index.ids.includes(task.id)) {
      index.ids.push(task.id);
      await this.store.writeFile(TASK_INDEX, `${JSON.stringify(index, null, 2)}\n`);
    }
    return task;
  }
}
