import type { ProjectAccess, RefactorRequestLike } from "@jellytind/agent-runtime";
import type { StoryRepository } from "@jellytind/story-repository";
import { analyseRefactor } from "./analyse";
import type { RefactorRequest } from "./types";

/**
 * The repository, plus refactor analysis, as one `ProjectAccess`.
 *
 * The repository cannot offer `analyseStoryRefactor` itself: this package sits
 * above it, and reaching back down would be a cycle. So the two are composed
 * here, at the layer that already depends on both.
 *
 * Delegation is written out rather than done with a prototype trick, because a
 * silent `this`-binding bug in the object every agent tool reads a project
 * through is not a bug anyone would find quickly.
 */
export function refactorAccess(repo: StoryRepository): ProjectAccess {
  return {
    project: repo.project,

    listProjectFiles: (prefix) => repo.listProjectFiles(prefix),
    readProjectFile: (path) => repo.readProjectFile(path),
    searchText: (query) => repo.searchText(query),

    getEntity: (id) => repo.getEntity(id),
    listEntitySummaries: () => repo.listEntitySummaries(),

    listChapters: () => repo.listChapters(),
    listScenes: () => repo.listScenes(),
    listCharacters: () => repo.listCharacters(),
    listLocations: () => repo.listLocations(),
    listPlotThreads: () => repo.listPlotThreads(),
    listRelationships: () => repo.listRelationships(),

    buildStory: (options) => repo.buildStory(options),
    getBuild: (id) => repo.getBuild(id),
    getLatestBuild: () => repo.getLatestBuild(),

    listStoryTests: () => repo.listStoryTests(),
    runStoryTests: () => repo.runStoryTests(),

    // Chapter plans (Phase 32). Draft writes only; approval is not on the
    // port, because approving a plan is the writer's decision.
    getChapterPlan: (chapterId) => repo.plans.get(chapterId),
    saveChapterPlan: (plan, options) =>
      repo.saveChapterPlan(plan as Parameters<StoryRepository["saveChapterPlan"]>[0], {
        actor: options?.actor ?? "agent",
        ...(options?.note !== undefined ? { note: options.note } : {}),
      }),
    validateChapterPlan: (plan) =>
      repo.validateChapterPlan(plan as Parameters<StoryRepository["validateChapterPlan"]>[0]),

    traceStoryProblem: (request) => repo.traceStoryProblem(request),
    listDebugReports: (limit) => repo.listDebugReports(limit),
    getDebugReport: (id) => repo.getDebugReport(id),

    /** Analysis only. Nothing here stages or applies a refactor. */
    analyseStoryRefactor: (request: RefactorRequestLike) =>
      analyseRefactor(repo, request as unknown as RefactorRequest),

    getScenesByCharacter: (id) => repo.getScenesByCharacter(id),
    getScenesByLocation: (id) => repo.getScenesByLocation(id),
    getScenesByPlotThread: (id) => repo.getScenesByPlotThread(id),
  };
}
