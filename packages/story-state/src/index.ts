/**
 * @jellytind/story-state — deterministic, time-aware story state.
 *
 * State is a set of scene-anchored transitions, not a snapshot: the state at any
 * point is reconstructed by replaying them, so the system answers *what was true
 * immediately before Scene 42?* rather than only *what is true now*
 * (MASTER_BUILD.md §8, docs/STORY_STATE.md).
 */
export { StoryTimeline, TimelineError } from "./timeline";
export { validateTransition, describeTransition, TransitionError } from "./validate";
export type { TransitionDraft } from "./validate";

export { TRANSITION_KINDS } from "./types";
export type {
  CharacterState,
  ConfirmationStatus,
  KnowledgeEntry,
  KnowledgeSource,
  ObjectState,
  StateBoundary,
  StateTransition,
  TimelineView,
  TransitionKind,
  TransitionSource,
  WorldState,
} from "./types";
