/**
 * @jellytind/story-map — the visual story-intelligence layer (Phase 38).
 *
 * One canonical story, many views: pure projections over the same stable
 * entity IDs, at any Story Point. The map computes; it stores nothing, and
 * no view invents a parallel graph entity.
 */

export type {
  ArcMilestone,
  CausalityEdgeModel,
  CausalityNodeModel,
  CausalityViewModel,
  CharacterArcModel,
  CharacterKnowledgeModel,
  FactKnowledgeModel,
  KnowledgeRowModel,
  RelationshipEdgeModel,
  RelationshipViewModel,
  StoryMapContext,
  StoryMapFilters,
  StoryPoint,
  StoryPointStop,
  ThreadChapterModel,
  ThreadViewModel,
  TimelineEventModel,
  TimelineLane,
  TimelineSceneModel,
  TimelineViewModel,
} from "./types";

export {
  describeStoryPoint,
  filteredScenes,
  isReachedAt,
  resolveStoryPoint,
  storyPointStops,
} from "./point";

export {
  blastRadiusView,
  causalityView,
  characterArcView,
  characterKnowledgeView,
  factKnowledgeView,
  kindOfId,
  labelOf,
  relationshipView,
  threadView,
  timelineView,
} from "./views";

export { diagnosticOverlay, searchStrip, storyTestOverlay } from "./overlays";
export type { DiagnosticOverlay, SearchStripEntry, TestOverlayEntry } from "./overlays";
