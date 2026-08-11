import { AppError } from "@jellytind/shared";
import type { LanguageModel } from "./model";

/**
 * Task categories that can be routed to different models. Routing lets the
 * product send planning to a strong reasoning model, drafting to a preferred
 * prose model, metadata to a cheap/local model, and so on
 * (docs/MODEL_ROUTER.md). The set will grow; it is intentionally coarse now.
 */
export type ModelTask =
  | "planning"
  | "drafting"
  | "continuity"
  | "copy_edit"
  | "metadata"
  | "reader_sim"
  | "research"
  | "embedding";

export class ModelRoutingError extends AppError {
  constructor(message: string) {
    super("model_routing_error", message);
  }
}

export interface ModelRouterOptions {
  /** Fallback model used for any task without a specific binding. */
  readonly defaultModel?: LanguageModel;
  /** Per-task model bindings. */
  readonly routes?: Partial<Record<ModelTask, LanguageModel>>;
}

/**
 * Maps a {@link ModelTask} to a concrete {@link LanguageModel}. Deterministic
 * and side-effect free: policy (cost limits, privacy, per-agent overrides) is
 * layered on later without changing this contract.
 */
export class ModelRouter {
  private defaultModel: LanguageModel | undefined;
  private readonly routes = new Map<ModelTask, LanguageModel>();

  constructor(options: ModelRouterOptions = {}) {
    this.defaultModel = options.defaultModel;
    for (const [task, model] of Object.entries(options.routes ?? {})) {
      if (model) this.routes.set(task as ModelTask, model);
    }
  }

  /** Bind a task to a model, overriding any previous binding. */
  register(task: ModelTask, model: LanguageModel): this {
    this.routes.set(task, model);
    return this;
  }

  setDefault(model: LanguageModel): this {
    this.defaultModel = model;
    return this;
  }

  /** Resolve the model for a task, falling back to the default. */
  route(task: ModelTask): LanguageModel {
    const model = this.routes.get(task) ?? this.defaultModel;
    if (model === undefined) {
      throw new ModelRoutingError(`No model registered for task "${task}" and no default set.`);
    }
    return model;
  }

  has(task: ModelTask): boolean {
    return this.routes.has(task) || this.defaultModel !== undefined;
  }
}
