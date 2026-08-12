/**
 * @jellytind/domain — the authoritative fiction domain model.
 *
 * Phase 0 establishes only the identity foundation: stable, branded entity IDs
 * and their generation. Phase 1 adds the minimal entity + manifest types needed
 * to create and open real projects. Richer entity modelling arrives per vertical
 * slice (see docs/DOMAIN_MODEL.md and docs/ROADMAP.md). Nothing in the UI or a
 * model response may become the authoritative representation of this data.
 */
export * from "./ids";
export * from "./entities";

export {
  orderChapters,
  orderScenes,
  adjacentChapters,
  adjacentScenes,
  scenesOfChapter,
} from "./story-order";
export type { Neighbours } from "./story-order";

export {
  STORY_TIME_KINDS,
  TEMPORAL_RELATIONS,
  RELATION_VERBS,
  isTemporalRelation,
  durationMs,
  describeDuration,
  boundsOf,
  isAnchored,
  parseInstant,
  describeStoryTime,
  normaliseStoryTime,
  normaliseDuration,
} from "./story-time";
export type {
  StoryTime,
  StoryTimeKind,
  StoryDuration,
  TemporalRelation,
  TemporalLink,
  TimeBounds,
  TravelRule,
} from "./story-time";
