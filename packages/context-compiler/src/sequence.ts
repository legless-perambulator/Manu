/**
 * Narrative order lives in the domain — every subsystem must agree on what
 * "the previous scene" means. Re-exported here so recipes read naturally.
 */
export {
  adjacentChapters,
  adjacentScenes,
  orderChapters,
  orderScenes,
  scenesOfChapter,
} from "@jellytind/domain";
export type { Neighbours } from "@jellytind/domain";
