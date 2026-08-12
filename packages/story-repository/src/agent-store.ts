import type { ProjectStore } from "@jellytind/persistence";
import type { AgentActivityEvent, AgentStore, AgentTask } from "@jellytind/agent-runtime";
import { WRITER_DIR } from "@jellytind/domain";

const DIR = `${WRITER_DIR}/agents`;
const TASKS_PATH = `${DIR}/tasks.json`;
const ACTIVITY_PATH = `${DIR}/activity.json`;

/** Keep the activity log bounded; it is a feed, not an archive. */
const MAX_ACTIVITY = 1_000;

interface TaskFile {
  seq: number;
  tasks: AgentTask[];
}

interface ActivityFile {
  seq: number;
  events: AgentActivityEvent[];
}

/**
 * Persists agent tasks and activity under `.writer/agents/`.
 *
 * Task state lives in the project, not in a chat transcript, so an
 * investigation survives closing the app and can be inspected later
 * (MASTER_BUILD.md §48, AGENTS.md — chat is not the source of truth).
 *
 * Uses the raw (un-journaled) store, like the history store: an agent reading
 * the project is not a story mutation, so it must not generate change sets or
 * appear in the manuscript's revision history.
 */
export class RepositoryAgentStore implements AgentStore {
  constructor(private readonly store: ProjectStore) {}

  private async readTasks(): Promise<TaskFile> {
    const raw = await this.store.readFile(TASKS_PATH);
    if (raw === null) return { seq: 0, tasks: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<TaskFile>;
      return {
        seq: typeof parsed.seq === "number" ? parsed.seq : 0,
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      };
    } catch {
      // A corrupt log must not make the project unopenable; start a fresh one.
      return { seq: 0, tasks: [] };
    }
  }

  private async writeTasks(file: TaskFile): Promise<void> {
    await this.store.writeFile(TASKS_PATH, `${JSON.stringify(file, null, 2)}\n`);
  }

  private async readActivity(): Promise<ActivityFile> {
    const raw = await this.store.readFile(ACTIVITY_PATH);
    if (raw === null) return { seq: 0, events: [] };
    try {
      const parsed = JSON.parse(raw) as Partial<ActivityFile>;
      return {
        seq: typeof parsed.seq === "number" ? parsed.seq : 0,
        events: Array.isArray(parsed.events) ? parsed.events : [],
      };
    } catch {
      return { seq: 0, events: [] };
    }
  }

  async listTasks(): Promise<AgentTask[]> {
    const { tasks } = await this.readTasks();
    return [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getTask(id: string): Promise<AgentTask | null> {
    const { tasks } = await this.readTasks();
    return tasks.find((task) => task.id === id) ?? null;
  }

  async nextTaskId(): Promise<string> {
    const file = await this.readTasks();
    file.seq += 1;
    await this.writeTasks(file);
    return `TASK_${String(file.seq).padStart(4, "0")}`;
  }

  async saveTask(task: AgentTask): Promise<AgentTask> {
    const file = await this.readTasks();
    const index = file.tasks.findIndex((t) => t.id === task.id);
    if (index === -1) file.tasks.push(task);
    else file.tasks[index] = task;
    await this.writeTasks(file);
    return task;
  }

  async appendActivity(event: Omit<AgentActivityEvent, "id">): Promise<AgentActivityEvent> {
    const file = await this.readActivity();
    file.seq += 1;
    const stored: AgentActivityEvent = { ...event, id: `ACT_${String(file.seq).padStart(6, "0")}` };
    file.events.push(stored);
    if (file.events.length > MAX_ACTIVITY) {
      file.events = file.events.slice(file.events.length - MAX_ACTIVITY);
    }
    await this.store.writeFile(ACTIVITY_PATH, `${JSON.stringify(file, null, 2)}\n`);
    return stored;
  }

  async listActivity(taskId?: string): Promise<AgentActivityEvent[]> {
    const { events } = await this.readActivity();
    return taskId === undefined ? events : events.filter((e) => e.taskId === taskId);
  }
}
