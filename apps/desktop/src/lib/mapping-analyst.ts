import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import type {
  MappingAnalyst,
  MappingExcerpt,
  SemanticMappingFinding,
  SemanticMappingKind,
} from "@jellytind/story-mapper";
import { createRoutedModel } from "./routing";

/**
 * The desktop's MappingAnalyst: one bounded excerpt per call, routed through
 * the `manuscript_mapping` operation so policy, pins, privacy and budgets all
 * apply, and every call lands in the usage ledger. Returns null when no model
 * can be routed — the mapper then skips semantic steps with a stated reason.
 */

const FINDINGS_SCHEMA = {
  name: "mapping_findings",
  parse(value: unknown): SemanticMappingFinding[] {
    const list = Array.isArray(value)
      ? value
      : typeof value === "object" &&
          value !== null &&
          Array.isArray((value as { findings?: unknown }).findings)
        ? (value as { findings: unknown[] }).findings
        : [];
    const out: SemanticMappingFinding[] = [];
    for (const item of list) {
      if (typeof item !== "object" || item === null) continue;
      const held = item as Record<string, unknown>;
      const summary = typeof held["summary"] === "string" ? held["summary"].trim() : "";
      if (summary === "") continue;
      const confidence =
        held["confidence"] === "high" || held["confidence"] === "medium"
          ? held["confidence"]
          : "low";
      out.push({
        summary,
        confidence,
        ...(typeof held["quote"] === "string" && held["quote"] !== ""
          ? { quote: held["quote"] }
          : {}),
        ...(typeof held["payload"] === "object" && held["payload"] !== null
          ? { payload: held["payload"] as Record<string, unknown> }
          : {}),
      });
    }
    return out.slice(0, 12); // A flood of findings is noise, not mapping.
  },
};

export async function createMappingAnalyst(
  repo: StoryRepository,
  secrets: SecretStore,
): Promise<MappingAnalyst | null> {
  try {
    const { model } = await createRoutedModel(repo, secrets, "manuscript_mapping");
    return {
      async analyse(
        kind: SemanticMappingKind,
        excerpt: MappingExcerpt,
        briefing: string,
      ): Promise<readonly SemanticMappingFinding[]> {
        return model.generateStructured({
          system:
            "You reconstruct structured story data from a manuscript excerpt. " +
            "Report only what the excerpt supports; never invent. Reply as JSON: " +
            '{"findings":[{"summary":string,"confidence":"low"|"medium"|"high","quote"?:string,"payload"?:object}]}',
          messages: [
            {
              role: "user",
              content:
                `Task (${kind}): ${briefing}\n\n` +
                `Chapter: ${excerpt.chapterTitle}` +
                (excerpt.parts > 1 ? ` (part ${excerpt.part} of ${excerpt.parts})` : "") +
                `\n\n---\n${excerpt.text}`,
            },
          ],
          maxOutputTokens: 1200,
          schema: FINDINGS_SCHEMA,
        });
      },
    };
  } catch {
    return null;
  }
}
