import { BRANCHES_DIR, type ProjectStore } from "@jellytind/persistence";
import {
  MAIN_BRANCH_NAME,
  normaliseBranchName,
  type Branch,
  type BranchId,
  type BranchStatus,
} from "@jellytind/domain";
import { RepositoryError } from "./errors";

const REGISTRY_PATH = `${BRANCHES_DIR}/branches.json`;

interface Registry {
  readonly version: 1;
  readonly activeBranchId: string;
  readonly branches: readonly Branch[];
}

/**
 * The branch registry: one record for the whole project, shared by every
 * branch.
 *
 * It is written through the **base** store rather than a branched view, so
 * switching versions never forks the list of versions. `BranchedProjectStore`
 * routes anything under `.writer/branches/` straight to the parent for exactly
 * this reason.
 */
export class BranchStore {
  constructor(private readonly base: ProjectStore) {}

  /**
   * Read the registry, creating main on first use.
   *
   * Projects created before branching existed have no registry; they get one
   * with a single main branch describing the state already on disk, so opening
   * an old project is a migration that changes nothing the writer can see.
   */
  async load(): Promise<Registry> {
    const raw = await this.base.readFile(REGISTRY_PATH);
    if (raw !== null) {
      const parsed = parse(raw);
      if (parsed !== null) return parsed;
      throw new RepositoryError(
        "invalid_manifest",
        "The branch registry (.writer/branches/branches.json) is unreadable.",
      );
    }
    return this.initialise();
  }

  private async initialise(): Promise<Registry> {
    const main: Branch = {
      id: "BRANCH_0001" as BranchId,
      name: MAIN_BRANCH_NAME,
      description: "The primary manuscript.",
      createdAt: new Date().toISOString(),
      status: "active",
    };
    const registry: Registry = { version: 1, activeBranchId: main.id, branches: [main] };
    await this.save(registry);
    return registry;
  }

  private async save(registry: Registry): Promise<void> {
    await this.base.createDirectory(BRANCHES_DIR);
    await this.base.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  }

  async list(): Promise<Branch[]> {
    return [...(await this.load()).branches];
  }

  async main(): Promise<Branch> {
    const branches = await this.list();
    const found = branches.find((b) => b.parentBranchId === undefined);
    if (found === undefined) {
      throw new RepositoryError("invalid_manifest", "This project has no main branch.");
    }
    return found;
  }

  async active(): Promise<Branch> {
    const registry = await this.load();
    return this.require(registry.activeBranchId as BranchId, registry);
  }

  async get(id: BranchId): Promise<Branch> {
    return this.require(id, await this.load());
  }

  private require(id: BranchId, registry: Registry): Branch {
    const found = registry.branches.find((b) => b.id === id);
    if (found === undefined) {
      throw new RepositoryError("branch_not_found", `No such version: ${id}.`);
    }
    return found;
  }

  /** Allocate the next branch ID. Branch IDs are never reused. */
  private nextId(registry: Registry): BranchId {
    const highest = registry.branches.reduce((max, branch) => {
      const n = Number.parseInt(branch.id.replace("BRANCH_", ""), 10);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    return `BRANCH_${String(highest + 1).padStart(4, "0")}` as BranchId;
  }

  async create(input: {
    name: string;
    description?: string;
    parentBranchId: BranchId;
    createdFromRevisionId?: string;
  }): Promise<Branch> {
    const registry = await this.load();
    const name = normaliseBranchName(input.name);
    if (name === "") {
      throw new RepositoryError("invalid_branch_operation", "A version needs a name.");
    }
    if (registry.branches.some((b) => b.name === name)) {
      throw new RepositoryError("already_exists", `A version called "${name}" already exists.`);
    }
    this.require(input.parentBranchId, registry);

    const branch: Branch = {
      id: this.nextId(registry),
      name,
      ...(input.description !== undefined && input.description !== ""
        ? { description: input.description }
        : {}),
      parentBranchId: input.parentBranchId,
      ...(input.createdFromRevisionId !== undefined
        ? { createdFromRevisionId: input.createdFromRevisionId }
        : {}),
      createdAt: new Date().toISOString(),
      status: "active",
    };
    await this.save({ ...registry, branches: [...registry.branches, branch] });
    return branch;
  }

  async setActive(id: BranchId): Promise<Branch> {
    const registry = await this.load();
    const branch = this.require(id, registry);
    await this.save({ ...registry, activeBranchId: id });
    return branch;
  }

  async setStatus(id: BranchId, status: BranchStatus): Promise<Branch> {
    const registry = await this.load();
    const branch = this.require(id, registry);
    const updated: Branch = { ...branch, status };
    await this.save({
      ...registry,
      branches: registry.branches.map((b) => (b.id === id ? updated : b)),
    });
    return updated;
  }

  /**
   * Remove a branch from the registry and delete its files.
   *
   * Main is not deletable, and neither is the branch currently being written
   * on — losing the version under your cursor is not a recoverable mistake.
   */
  async remove(id: BranchId): Promise<Branch> {
    const registry = await this.load();
    const branch = this.require(id, registry);
    if (branch.parentBranchId === undefined) {
      throw new RepositoryError("invalid_branch_operation", "The main version cannot be deleted.");
    }
    if (registry.activeBranchId === id) {
      throw new RepositoryError(
        "invalid_branch_operation",
        "Switch to another version before deleting this one.",
      );
    }
    const children = registry.branches.filter((b) => b.parentBranchId === id);
    if (children.length > 0) {
      throw new RepositoryError(
        "invalid_branch_operation",
        `${branch.name} has ${String(children.length)} version(s) taken from it: ` +
          `${children.map((c) => c.name).join(", ")}. Delete those first.`,
      );
    }

    for (const path of await this.base.list(`${BRANCHES_DIR}/${id}`)) {
      await this.base.delete(path);
    }
    await this.save({
      ...registry,
      branches: registry.branches.filter((b) => b.id !== id),
    });
    return branch;
  }
}

function parse(raw: string): Registry | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.branches) || typeof record.activeBranchId !== "string") return null;
    return {
      version: 1,
      activeBranchId: record.activeBranchId,
      branches: record.branches as Branch[],
    };
  } catch {
    return null;
  }
}
