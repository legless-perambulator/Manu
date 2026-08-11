/**
 * @jellytind/domain — the authoritative fiction domain model.
 *
 * Phase 0 establishes only the identity foundation: stable, branded entity IDs
 * and their generation. Concrete entity types (Character, Scene, PlotThread, …)
 * are introduced per vertical slice in later phases (see docs/DOMAIN_MODEL.md
 * and docs/ROADMAP.md). Nothing in the UI or a model response may become the
 * authoritative representation of this data.
 */
export * from "./ids";
