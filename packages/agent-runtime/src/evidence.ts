import { entityKindOf } from "@jellytind/domain";

/**
 * Evidence: what an agent actually retrieved.
 *
 * The audit found the one place this codebase's "structure it, don't prompt it"
 * discipline lapsed. The answer schema accepted `sources` as an array of
 * strings and nothing compared those strings against anything; the enforcement
 * mechanism was the sentence "Do not invent IDs" in a system prompt
 * (MANU-007). A fabricated citation is worse than an uncited guess, because it
 * looks verified.
 *
 * The fix is a ledger. Every tool result that passes its own output schema is
 * scanned for the identifiers it contains, and each one becomes a handle. An
 * agent may cite a reference only if a handle exists for it. That turns a
 * prompt promise into an invariant the runtime can check.
 */

export type EvidenceKind = "entity" | "file";

/** One retrievable thing, and the tool call that produced it. */
export interface EvidenceHandle {
  /** Stable within a run: `EV_0001`. */
  readonly id: string;
  /** The activity event for the tool call this came back from. */
  readonly toolCallId: string;
  readonly tool: string;
  readonly kind: EvidenceKind;
  /** The citable string itself: `SCENE_0012`, `manuscript/CHAPTER_0002.md`. */
  readonly reference: string;
  /** For entities, the kind the ID prefix denotes: `scene`, `character`, … */
  readonly entityKind?: string;
  readonly recordedAt: string;
}

/** A reference found in a tool result, before it is given a handle. */
export interface EvidenceRef {
  readonly kind: EvidenceKind;
  readonly reference: string;
  readonly entityKind?: string;
}

/**
 * How a cited source relates to what was retrieved.
 *
 * `unknown` and `malformed` are deliberately different answers. "SCENE_0099"
 * is a well-formed reference to something the tools never returned — the model
 * has invented a plausible ID. "the vault scene" is not a reference at all —
 * the model has misunderstood the field. The first is a grounding failure; the
 * second is a formatting failure, and they want different repairs.
 */
export type SourceVerdict = "verified" | "unknown" | "malformed";

const ID_PATTERN = /\b[A-Z]{2,12}_[A-Za-z0-9]+\b/g;
const PATH_PATTERN = /^[\w][\w.\-/]*\.(md|json|txt|ya?ml|csv)$/i;

/** True when a string is shaped like something Manu could cite. */
export function isWellFormedReference(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  return entityKindOf(trimmed) !== null || PATH_PATTERN.test(trimmed);
}

/**
 * Pull every citable identifier out of a validated tool result.
 *
 * Two passes with different strictness, because the two kinds of reference
 * behave differently. Entity IDs are scanned for *inside* strings as well as at
 * their edges: a chapter's prose that mentions `SCENE_0012` genuinely was
 * retrieved, and refusing to let the agent cite it would be its own kind of
 * dishonesty. File paths are matched whole, because a path fragment inside
 * prose is far more likely to be a coincidence than a retrieval.
 */
export function collectEvidence(output: unknown): EvidenceRef[] {
  const found = new Map<string, EvidenceRef>();

  const visit = (value: unknown, depth: number): void => {
    if (depth > 12) return;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (PATH_PATTERN.test(trimmed)) {
        found.set(trimmed, { kind: "file", reference: trimmed });
      }
      for (const match of trimmed.match(ID_PATTERN) ?? []) {
        const kind = entityKindOf(match);
        if (kind !== null && !found.has(match)) {
          found.set(match, { kind: "entity", reference: match, entityKind: kind });
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const item of Object.values(value)) visit(item, depth + 1);
    }
  };

  visit(output, 0);
  return [...found.values()];
}

/**
 * The evidence set for one agent run.
 *
 * Per-run rather than per-executor: one task's retrievals must not ground
 * another task's claims, and a ledger that outlived a run would do exactly
 * that.
 */
export class EvidenceLedger {
  private readonly byReference = new Map<string, EvidenceHandle>();
  private sequence = 0;

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  /**
   * Record what a tool call returned.
   *
   * A reference seen twice keeps its first handle: the earliest retrieval is
   * the one that established it, and re-minting would make the ledger's size
   * a measure of chattiness rather than of what is known.
   */
  absorb(
    toolCallId: string,
    tool: string,
    refs: readonly EvidenceRef[],
  ): readonly EvidenceHandle[] {
    const minted: EvidenceHandle[] = [];
    for (const ref of refs) {
      if (this.byReference.has(ref.reference)) continue;
      this.sequence += 1;
      const handle: EvidenceHandle = {
        id: `EV_${String(this.sequence).padStart(4, "0")}`,
        toolCallId,
        tool,
        kind: ref.kind,
        reference: ref.reference,
        ...(ref.entityKind === undefined ? {} : { entityKind: ref.entityKind }),
        recordedAt: this.now(),
      };
      this.byReference.set(ref.reference, handle);
      minted.push(handle);
    }
    return minted;
  }

  resolve(reference: string): EvidenceHandle | undefined {
    return this.byReference.get(reference.trim());
  }

  has(reference: string): boolean {
    return this.byReference.has(reference.trim());
  }

  /** Every handle, in the order it was first retrieved. */
  handles(): readonly EvidenceHandle[] {
    return [...this.byReference.values()];
  }

  references(): readonly string[] {
    return [...this.byReference.keys()];
  }

  get size(): number {
    return this.byReference.size;
  }

  /** Classify one cited source. */
  verdict(source: string): SourceVerdict {
    if (this.has(source)) return "verified";
    return isWellFormedReference(source) ? "unknown" : "malformed";
  }
}
