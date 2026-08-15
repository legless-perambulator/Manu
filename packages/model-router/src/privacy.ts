import type { ModelProfile } from "./profile";

/**
 * Privacy routing constraints (Phase 36 §17).
 *
 * A privacy policy is a restriction the router may NEVER route around — not
 * for a higher quality score, not as a fallback, not because everything else
 * is unavailable. A violated restriction is an *excluded model*, and if
 * nothing eligible remains the operation is blocked and says why.
 */

/** What kind of material an operation sends to the model. */
export const CONTENT_CLASSES = ["manuscript_prose", "story_metadata", "research_query"] as const;
export type ContentClass = (typeof CONTENT_CLASSES)[number];

/** "Never send <these classes> to <this provider>." `"*"` forbids everything. */
export interface PrivacyRule {
  /** Provider adapter id, e.g. "openai". `"*"` matches every provider. */
  readonly providerId: string;
  readonly forbid: readonly (ContentClass | "*")[];
}

export interface PrivacyPolicy {
  /** `local_only`: nothing leaves the writer's machine at all. */
  readonly mode: "allow_cloud" | "local_only";
  readonly rules: readonly PrivacyRule[];
}

export const ALLOW_CLOUD: PrivacyPolicy = { mode: "allow_cloud", rules: [] };

/**
 * Why this model may not receive this material, or `null` when it may.
 * Local models are exempt from provider rules — the material never leaves.
 */
export function privacyRefusal(
  policy: PrivacyPolicy,
  profile: ModelProfile,
  contentClass: ContentClass,
): string | null {
  if (profile.privacyClass === "local") return null;
  if (policy.mode === "local_only") {
    return `Privacy is set to local-only; ${profile.displayName} runs in the cloud.`;
  }
  for (const rule of policy.rules) {
    if (rule.providerId !== "*" && rule.providerId !== profile.providerId) continue;
    if (rule.forbid.includes("*") || rule.forbid.includes(contentClass)) {
      const what =
        contentClass === "manuscript_prose"
          ? "manuscript prose"
          : contentClass === "story_metadata"
            ? "story metadata"
            : "research queries";
      return `Your privacy settings do not allow ${what} to be sent to ${profile.providerId}.`;
    }
  }
  return null;
}
