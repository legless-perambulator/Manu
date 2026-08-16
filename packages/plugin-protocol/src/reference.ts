import type { PluginManifest } from "./types";

/**
 * The reference plugin (§24): Writing Statistics.
 *
 * First-party, harmless, and complete: a manifest, one permission, a typed
 * tool, a command and a panel — enough to demonstrate the whole protocol
 * without any external service. It ships as data, exactly as a third-party
 * plugin would arrive.
 */
export const WRITING_STATISTICS_PLUGIN: PluginManifest = {
  id: "com.manu.writing-statistics",
  name: "Writing Statistics",
  version: "1.0.0",
  description: "Word counts, chapter averages and dialogue share for the open book.",
  protocolVersion: "1.0",
  permissions: ["read_manuscript", "register_agent_tools", "register_commands", "register_panels"],
  contributes: {
    tools: [
      {
        name: "writing_statistics",
        description: "Compute word counts, averages and dialogue share for the manuscript.",
        input: { fields: {} },
        output: {
          fields: {
            chapters: { kind: "number", required: true },
            totalWords: { kind: "number", required: true },
            averageChapterWords: { kind: "number", required: true },
            averageSentenceWords: { kind: "number", required: true },
            dialoguePercent: { kind: "number", required: true },
          },
          rows: {
            name: "perChapter",
            fields: {
              chapter: { kind: "string", required: true },
              words: { kind: "number", required: true },
            },
          },
        },
        implementation: { kind: "computed", operation: "manuscript_statistics" },
      },
    ],
    commands: [
      {
        name: "writing-stats",
        summary: "Word counts, chapter averages and dialogue share",
        action: { kind: "run_tool", tool: "writing_statistics" },
      },
    ],
    panels: [
      {
        id: "writing-statistics",
        title: "Writing Statistics",
        purpose: "How the manuscript measures, chapter by chapter",
        rendering: { kind: "tool_report", tool: "writing_statistics" },
      },
    ],
  },
};
