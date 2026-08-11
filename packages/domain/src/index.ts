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
