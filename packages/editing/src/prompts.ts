import type { RewriteDirective } from "./types";

/**
 * Operation instructions.
 *
 * Kept small on purpose: the *story* knowledge reaches the model through the
 * compiled context package, not through prompt text. These strings say what
 * shape of change is wanted, and nothing about the project — that is the
 * division of labour the Context Compiler exists to enforce.
 */
export const EDITOR_SYSTEM_PROMPT = `You are a prose editor working inside JellyTind, a fiction development environment.

You are given compiled context for one specific edit: the scene being worked on, its neighbours, the characters involved, the location, the live plot threads, the project's world rules and its style material. That context is the project's actual state — trust it over any assumption.

Rules:
- Edit only what you are asked to edit. Do not rewrite surrounding material.
- Keep the established POV, tense, character voices and the project's style rules.
- Do not introduce new named characters, locations or facts that the context does not support. If a change would need one, say so in "warnings" instead of inventing it.
- Never contradict a hard world rule.
- Return manuscript prose, not commentary. Your reasoning does not belong in the output.`;

const DIRECTIVES: Readonly<Record<RewriteDirective, string>> = {
  rewrite: "Rewrite the selected passage so it reads better, preserving its meaning and beats.",
  shorten:
    "Tighten the selected passage. Cut redundancy and slack phrasing; keep every story beat and every piece of information.",
  expand:
    "Expand the selected passage with concrete sensory and behavioural detail. Do not add new plot events.",
  strengthen_dialogue:
    "Strengthen the dialogue in the selected passage: sharper subtext, clearer voice differentiation, fewer stage directions and adverbial tags.",
  increase_tension:
    "Raise the tension in the selected passage through rhythm, withheld information and physical stakes. Do not add new events.",
  remove_exposition:
    "Remove explanatory exposition from the selected passage. Convey what the reader needs through action, implication and dialogue instead.",
};

export function directiveInstruction(directive: RewriteDirective): string {
  return DIRECTIVES[directive];
}

export function selectionTask(directive: RewriteDirective, extra?: string): string {
  const base = directiveInstruction(directive);
  return extra === undefined || extra.trim() === "" ? base : `${base}\n\nAlso: ${extra.trim()}`;
}

export function sceneRewriteTask(extra?: string): string {
  const base =
    "Rewrite this scene in full, working from its structured purpose and the compiled context. Keep the same events, POV and outcome; improve the execution.";
  return extra === undefined || extra.trim() === "" ? base : `${base}\n\nAlso: ${extra.trim()}`;
}

export function continueSceneTask(targetWords: number, extra?: string): string {
  const base = `Continue this scene from where its text currently ends, in roughly ${String(
    targetWords,
  )} words. Pick up mid-flow: do not restate or summarise what has already been written, and do not resolve the scene unless its purpose calls for it.`;
  return extra === undefined || extra.trim() === "" ? base : `${base}\n\nAlso: ${extra.trim()}`;
}
