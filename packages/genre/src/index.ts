/**
 * @jellytind/genre — the Genre Module Framework.
 *
 * One fiction development environment that adapts to different forms of
 * storytelling, rather than several applications sharing a logo. A module
 * extends the common story domain and never replaces it: the timeline, the
 * knowledge model, the causality graph, the version history and the story
 * compiler are the same ones under every genre (docs/GENRE_MODULES.md).
 */

export { MODULE_IDS, isModuleId, FIELD_TYPES, GenreError, MODULE_MATURITIES } from "./types";
export type {
  DisableImpact,
  ModuleMaturity,
  ExtensionField,
  ExtensionKind,
  FieldType,
  GenreErrorCode,
  GenreModule,
  MetadataField,
  ModuleCommand,
  ModuleId,
  ModuleView,
  TestTemplate,
} from "./types";

export {
  MODULES,
  commandsFor,
  disableImpact,
  enabledModules,
  extensionKindById,
  extensionKindsFor,
  hasModule,
  moduleById,
  moduleOwningView,
  rulesFor,
  skillIsAvailable,
  viewsFor,
} from "./registry";

export { TEMPLATES, templateById } from "./templates";
export type { ProjectTemplate } from "./templates";

export { GenreRuntime } from "./runtime";
export { validateModule, validateRecord } from "./validate";
export type { RecordDraft } from "./validate";

export { MYSTERY_MODULE } from "./modules/mystery";
export type { MysteryBuildData } from "./modules/mystery";
export { FANTASY_MODULE } from "./modules/fantasy";
export { ROMANCE_MODULE, BEAT_TYPES } from "./modules/romance";
export { THRILLER_MODULE } from "./modules/thriller";
export { SCREENPLAY_MODULE } from "./modules/screenplay";
