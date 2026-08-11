/**
 * Nominal ("branded") typing helper.
 *
 * TypeScript is structurally typed: two `string` aliases are freely
 * interchangeable. Branding attaches a phantom, compile-time-only tag so that
 * otherwise-identical primitives become mutually incompatible. This is the
 * mechanism that lets the domain layer guarantee a {@link CharacterId} can
 * never be passed where a {@link SceneId} is expected (see AGENTS.md — "Stable
 * Entity IDs").
 *
 * The `__brand` property never exists at runtime; it is purely a type-level
 * marker.
 */
export type Brand<TValue, TBrand extends string> = TValue & {
  readonly __brand: TBrand;
};

/**
 * Extract the underlying primitive value of a branded type.
 */
export type Unbrand<T> = T extends Brand<infer V, string> ? V : T;
