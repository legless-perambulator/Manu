import type { AgentPermission } from "../permissions";

/**
 * The specialist registry.
 *
 * An agent here is **not a chat persona with a different role prompt**. It is a
 * configuration: which tools it can reach, which permissions it holds, which
 * context recipe it compiles, what shape its output takes, and which model
 * class suits the work. Two specialists differ because those differ — and the
 * runtime enforces every one of them.
 *
 * The tool list becomes the `allowedTools` of the permission grant, so a Copy
 * Editor that tries to call `analyse_story_refactor` is denied by the executor
 * before the tool is reached. It is not a matter of the prompt asking it not to
 * (docs/AGENT_RUNTIME.md).
 */

export const SPECIALIST_IDS = [
  "story_architect",
  "scene_director",
  "drafter",
  "continuity_editor",
  "character_editor",
  "dialogue_editor",
  "prose_editor",
  "developmental_editor",
  "copy_editor",
] as const;

export type SpecialistId = (typeof SPECIALIST_IDS)[number];

/**
 * What kind of model the work wants. The router resolves this to a configured
 * model; a specialist never names a provider or a version
 * ([MODEL_ROUTER.md](../../../docs/MODEL_ROUTER.md)).
 */
export const MODEL_CLASSES = ["reasoning", "drafting", "fast"] as const;
export type ModelClass = (typeof MODEL_CLASSES)[number];

/** The shape a specialist returns. Different work, different answer. */
export const OUTPUT_SHAPES = [
  "structure_assessment",
  "scene_plan",
  "prose_proposal",
  "continuity_report",
  "character_assessment",
  "dialogue_notes",
  "line_notes",
  "developmental_critique",
  "mechanical_corrections",
] as const;
export type OutputShape = (typeof OUTPUT_SHAPES)[number];

export interface AgentDefinition {
  readonly id: SpecialistId;
  readonly name: string;
  /** One line: what this specialist is for. */
  readonly role: string;
  readonly responsibilities: readonly string[];
  /** Exactly the tools it may call. Enforced as `allowedTools`. */
  readonly tools: readonly string[];
  readonly permissions: readonly AgentPermission[];
  /** The Context Compiler recipe it works from, when it works on a target. */
  readonly contextRecipe: "scene_inspection" | "scene_rewrite" | "chapter_inspection" | null;
  readonly outputShape: OutputShape;
  readonly modelClass: ModelClass;
  /** Specialists this one commonly hands off to, for recommendations. */
  readonly handsOffTo: readonly SpecialistId[];
  /** What this specialist deliberately does not do. */
  readonly outOfScope: readonly string[];
}

const READ_ONLY: readonly AgentPermission[] = ["read_manuscript", "read_canon"];

/** Reading the structured record without reading prose. */
const CANON_TOOLS = [
  "get_project",
  "get_chapter",
  "get_scene",
  "get_character",
  "get_location",
  "get_plot_thread",
];

export const AGENTS: readonly AgentDefinition[] = [
  {
    id: "story_architect",
    name: "Story Architect",
    role: "Works on the shape of the whole book.",
    responsibilities: [
      "macro structure and act division",
      "plot progression and causality",
      "setups, payoffs and the promises they make",
      "climax and resolution",
    ],
    // Reaches the causality and refactor analysis nobody else needs, and never
    // touches prose.
    tools: [
      ...CANON_TOOLS,
      "get_scenes_by_plot_thread",
      "search_project",
      "run_story_build",
      "get_build_diagnostics",
      "analyse_story_refactor",
      "list_branches",
      "compare_branches",
    ],
    permissions: READ_ONLY,
    contextRecipe: "chapter_inspection",
    outputShape: "structure_assessment",
    modelClass: "reasoning",
    handsOffTo: ["scene_director", "developmental_editor"],
    outOfScope: ["writing prose", "line-level craft", "changing the manuscript"],
  },
  {
    id: "scene_director",
    name: "Scene Director",
    role: "Works out what a scene is doing before anyone writes it.",
    responsibilities: [
      "scene objective and conflict",
      "beats, entrances and exits",
      "the reversal, and the emotional change across the scene",
      "how it transitions into the next",
    ],
    tools: [
      ...CANON_TOOLS,
      "get_scenes_by_character",
      "get_scenes_by_location",
      "read_range",
      "search_project",
    ],
    permissions: READ_ONLY,
    contextRecipe: "scene_inspection",
    outputShape: "scene_plan",
    modelClass: "reasoning",
    handsOffTo: ["drafter"],
    outOfScope: ["writing the scene", "structural decisions above the scene"],
  },
  {
    id: "drafter",
    name: "Drafter",
    role: "Writes the prose, from a plan and the voices it must be in.",
    responsibilities: [
      "prose generation against a scene plan",
      "holding the author's voice",
      "holding each character's voice",
      "respecting story state as it stands at this scene",
    ],
    // The rewrite recipe is what carries author voice and character voice.
    tools: [...CANON_TOOLS, "read_file", "read_range", "get_scenes_by_character"],
    permissions: [...READ_ONLY, "edit_manuscript"],
    contextRecipe: "scene_rewrite",
    outputShape: "prose_proposal",
    modelClass: "drafting",
    handsOffTo: ["dialogue_editor", "prose_editor", "continuity_editor"],
    outOfScope: ["deciding what the scene is for", "structural change"],
  },
  {
    id: "continuity_editor",
    name: "Continuity Editor",
    role: "Checks the book against what the project already knows.",
    responsibilities: [
      "running the Story Build and reading its diagnostics",
      "timeline and chronology",
      "who knows what, and when",
      "object and location continuity",
      "world rules",
    ],
    // The only specialist holding the whole deterministic checking surface.
    tools: [
      ...CANON_TOOLS,
      "run_story_build",
      "get_build_diagnostics",
      "run_story_tests",
      "get_failed_story_tests",
      "list_story_tests",
      "run_story_debug",
      "get_debug_report",
      "list_debug_reports",
      "search_project",
    ],
    permissions: READ_ONLY,
    contextRecipe: "scene_inspection",
    outputShape: "continuity_report",
    modelClass: "reasoning",
    handsOffTo: ["drafter", "story_architect"],
    outOfScope: ["judging prose quality", "rewriting anything"],
  },
  {
    id: "character_editor",
    name: "Character Editor",
    role: "Works on whether people behave like themselves.",
    responsibilities: [
      "motivation and psychology",
      "behaviour consistent with what the character wants",
      "emotional arc across the book",
      "relationships as they change",
    ],
    tools: [
      ...CANON_TOOLS,
      "get_scenes_by_character",
      "run_story_debug",
      "get_debug_report",
      "search_project",
    ],
    permissions: READ_ONLY,
    contextRecipe: "scene_inspection",
    outputShape: "character_assessment",
    modelClass: "reasoning",
    handsOffTo: ["dialogue_editor", "developmental_editor"],
    outOfScope: ["prose craft", "continuity checking"],
  },
  {
    id: "dialogue_editor",
    name: "Dialogue Editor",
    role: "Works on what people say and how they say it.",
    responsibilities: [
      "subtext, and not explaining it",
      "each character's voice",
      "exposition carried in dialogue",
      "rhythm on the page",
      "keeping voices distinguishable from each other",
    ],
    tools: [
      "get_scene",
      "get_character",
      "get_scenes_by_character",
      "read_range",
      "search_project",
    ],
    permissions: [...READ_ONLY, "edit_manuscript"],
    // Rewrite recipe: it needs the character voice material specifically.
    contextRecipe: "scene_rewrite",
    outputShape: "dialogue_notes",
    modelClass: "drafting",
    handsOffTo: ["prose_editor"],
    outOfScope: ["narration", "structure", "continuity"],
  },
  {
    id: "prose_editor",
    name: "Prose Editor",
    role: "Works at the level of the sentence.",
    responsibilities: [
      "sentence craft and variation",
      "rhythm",
      "imagery",
      "unintended repetition",
      "clarity",
    ],
    // Deliberately narrow: it does not need to browse canon to fix a sentence.
    tools: ["get_scene", "read_range", "read_file"],
    permissions: [...READ_ONLY, "edit_manuscript"],
    contextRecipe: "scene_rewrite",
    outputShape: "line_notes",
    modelClass: "drafting",
    handsOffTo: ["copy_editor"],
    outOfScope: ["story decisions", "character decisions", "continuity"],
  },
  {
    id: "developmental_editor",
    name: "Developmental Editor",
    role: "Reads the book as an editor would and says what is not working.",
    responsibilities: [
      "story-level critique",
      "structure and stakes",
      "pacing",
      "whether the payoffs land",
      "character arcs across the whole book",
    ],
    tools: [
      ...CANON_TOOLS,
      "get_scenes_by_plot_thread",
      "run_story_build",
      "get_build_diagnostics",
      "list_story_tests",
      "search_project",
      "list_project_files",
    ],
    permissions: READ_ONLY,
    contextRecipe: "chapter_inspection",
    outputShape: "developmental_critique",
    modelClass: "reasoning",
    handsOffTo: ["story_architect", "character_editor"],
    outOfScope: ["rewriting", "line editing", "copy editing"],
  },
  {
    id: "copy_editor",
    name: "Copy Editor",
    role: "Fixes mechanics, and changes nothing else.",
    responsibilities: [
      "grammar",
      "punctuation",
      "spelling",
      "mechanical consistency of names, hyphenation and numbers",
    ],
    // The narrowest surface in the registry. A copy editor has no business
    // reaching the refactor analyser, the causality graph or the build — and
    // here it cannot, whatever a prompt might talk it into.
    tools: ["read_range", "read_file", "search_project"],
    permissions: [...READ_ONLY, "edit_manuscript"],
    contextRecipe: null,
    outputShape: "mechanical_corrections",
    modelClass: "fast",
    handsOffTo: [],
    outOfScope: [
      "rewriting sentences for style",
      "story, character or continuity judgements",
      "anything that changes meaning",
    ],
  },
];

const BY_ID = new Map(AGENTS.map((agent) => [agent.id, agent]));

export function agentById(id: SpecialistId): AgentDefinition {
  const found = BY_ID.get(id);
  /* istanbul ignore next — SpecialistId is closed over AGENTS. */
  if (found === undefined) throw new Error(`Unknown specialist: ${id}`);
  return found;
}

export function isSpecialistId(value: string): value is SpecialistId {
  return (SPECIALIST_IDS as readonly string[]).includes(value);
}

/**
 * The permission grant a specialist runs under.
 *
 * Both halves matter: `permissions` gates what *kind* of thing it may do, and
 * `allowedTools` gates exactly which tools it may reach. A specialist cannot
 * widen either at runtime.
 */
export function grantFor(agent: AgentDefinition): {
  permissions: readonly AgentPermission[];
  allowedTools: readonly string[];
} {
  return { permissions: agent.permissions, allowedTools: agent.tools };
}

/** Specialists that can edit the manuscript, for the interface to mark clearly. */
export function canEdit(agent: AgentDefinition): boolean {
  return agent.permissions.includes("edit_manuscript");
}

/**
 * Suggest a specialist for a request, from the words the writer used.
 *
 * A recommendation, never a redirection: the writer may invoke any specialist
 * directly, and this only offers a shorter route to one.
 */
const HINTS: readonly { id: SpecialistId; words: readonly string[] }[] = [
  { id: "copy_editor", words: ["typo", "grammar", "spelling", "punctuation", "proofread"] },
  { id: "dialogue_editor", words: ["dialogue", "conversation", "says", "speech", "subtext"] },
  { id: "prose_editor", words: ["sentence", "rhythm", "imagery", "repetitive", "clunky", "line"] },
  {
    id: "continuity_editor",
    words: ["continuity", "timeline", "contradiction", "inconsistent", "knows", "build"],
  },
  {
    id: "character_editor",
    words: ["motivation", "why would", "out of character", "arc", "behaviour", "relationship"],
  },
  { id: "scene_director", words: ["scene", "beats", "objective", "conflict", "reversal"] },
  {
    id: "story_architect",
    words: ["structure", "act", "setup", "payoff", "climax", "ending", "plot"],
  },
  {
    id: "developmental_editor",
    words: ["not working", "pacing", "stakes", "critique", "feedback", "boring", "drags"],
  },
];

export function recommendSpecialist(request: string): AgentDefinition | null {
  // Word-initial matching, not substring: "line" must not match inside
  // "timeline" and send a continuity question to the prose editor. A short
  // trailing allowance lets "typos" match "typo" and "contradicts" match
  // "contradict" without opening that door again.
  const words = request.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const text = request.toLowerCase();
  const matches = (hint: string) =>
    words.some((word) => word.startsWith(hint) && word.length - hint.length <= 3);

  let best: { id: SpecialistId; score: number } | null = null;
  for (const hint of HINTS) {
    const score = hint.words.filter((word) =>
      word.includes(" ") ? text.includes(word) : matches(word),
    ).length;
    if (score > 0 && (best === null || score > best.score)) best = { id: hint.id, score };
  }
  return best === null ? null : agentById(best.id);
}
