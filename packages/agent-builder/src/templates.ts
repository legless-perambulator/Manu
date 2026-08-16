import { BUILDER_VERSION, type FlowDefinition } from "./types";

/**
 * A few starting points (§21), built from the workflows Manu already ships as
 * fixed passes — enough to show the shapes, deliberately not dozens.
 */

const metadata = (description: string) => ({
  description,
  compatibility: { app: "manu" as const, builder: BUILDER_VERSION },
});

export const CHARACTER_AUDIT_TEMPLATE: FlowDefinition = {
  id: "character-audit",
  name: "Character Audit",
  description: "Everything one character does, wants and says — audited in one pass.",
  inputs: [{ key: "character", label: "Character", entityKind: "character", required: true }],
  steps: [
    {
      kind: "search_project",
      id: "find",
      title: "Find every appearance",
      query: "{input.character}",
    },
    {
      kind: "run_agent",
      id: "assess",
      title: "Assess the character",
      agent: "character_editor",
      instruction:
        "Assess this character's consistency, motivation and arc from the material found.",
      retry: { maxAttempts: 2 },
    },
    { kind: "generate_report", id: "report", title: "Produce the report" },
  ],
  output: "report",
  scope: "project",
  revision: 1,
  metadata: metadata("Template: a focused audit of one character."),
};

export const CONTINUITY_PASS_TEMPLATE: FlowDefinition = {
  id: "continuity-pass",
  name: "Continuity Pass",
  description: "Build first; bring in the Continuity Editor only when something is wrong.",
  inputs: [],
  steps: [
    { kind: "run_story_build", id: "build", title: "Run the Story Build" },
    {
      kind: "branch",
      id: "triage",
      title: "Only dig in when the build found problems",
      condition: { measure: "compiler_errors", comparison: "greater_than", value: 0 },
      then: [
        {
          kind: "run_agent",
          id: "diagnose",
          title: "Diagnose the continuity problems",
          agent: "continuity_editor",
          instruction: "Explain each build error found above and what would resolve it.",
        },
      ],
      otherwise: [],
    },
    { kind: "generate_report", id: "report", title: "Produce the report" },
  ],
  output: "diagnostics",
  scope: "project",
  revision: 1,
  metadata: metadata("Template: deterministic build, conditional diagnosis."),
};

export const DIALOGUE_REVIEW_TEMPLATE: FlowDefinition = {
  id: "dialogue-review",
  name: "Dialogue Review",
  description: "How a chapter's dialogue reads, line by line.",
  inputs: [{ key: "chapter", label: "Chapter", entityKind: "chapter", required: true }],
  steps: [
    {
      kind: "search_project",
      id: "gather",
      title: "Gather the chapter's dialogue",
      query: "{input.chapter}",
    },
    {
      kind: "run_agent",
      id: "review",
      title: "Review the dialogue",
      agent: "dialogue_editor",
      instruction: "Review the dialogue in this material for voice, rhythm and differentiation.",
    },
    { kind: "generate_report", id: "report", title: "Produce the report" },
  ],
  output: "report",
  scope: "project",
  revision: 1,
  metadata: metadata("Template: one chapter, dialogue only."),
};

export const CHAPTER_POLISH_TEMPLATE: FlowDefinition = {
  id: "chapter-polish",
  name: "Chapter Polish",
  description: "Propose line edits for one chapter, apply only what you approve, then re-check.",
  inputs: [{ key: "chapter", label: "Chapter", entityKind: "chapter", required: true }],
  steps: [
    {
      kind: "search_project",
      id: "gather",
      title: "Gather the chapter",
      query: "{input.chapter}",
    },
    {
      kind: "run_agent",
      id: "polish",
      title: "Propose line edits",
      agent: "prose_editor",
      instruction: "Propose specific line-level edits for clarity and rhythm.",
    },
    {
      kind: "request_approval",
      id: "gate",
      title: "Author approval",
      question: "Apply the accepted edits to the manuscript?",
    },
    { kind: "apply_staged_changes", id: "apply", title: "Apply accepted edits" },
    { kind: "run_story_build", id: "verify", title: "Re-run the Story Build" },
    { kind: "generate_report", id: "report", title: "Produce the report" },
  ],
  output: "diff",
  scope: "project",
  revision: 1,
  metadata: metadata("Template: propose, approve, apply, verify."),
};

export const FLOW_TEMPLATES: readonly FlowDefinition[] = [
  CHARACTER_AUDIT_TEMPLATE,
  CONTINUITY_PASS_TEMPLATE,
  DIALOGUE_REVIEW_TEMPLATE,
  CHAPTER_POLISH_TEMPLATE,
];
