import type { AgentInvoker, CustomAgentDefinition, ProposedEdit } from "./types";

/**
 * The agent test sandbox (§8).
 *
 * "Test Agent" runs the definition against real project material and shows
 * everything: the context it was given, the tools it would be allowed, the
 * result, and any mutations it *proposed*. Nothing is applied — the sandbox
 * has no write port, so there is no code path from a test run to the
 * manuscript, whatever the agent asks for.
 */

export interface SandboxProject {
  chapters(): Promise<ReadonlyArray<{ readonly title: string; readonly text: string }>>;
  characters?(): Promise<readonly string[]>;
  research?(): Promise<readonly string[]>;
  plotThreads?(): Promise<readonly string[]>;
  authorVoice?(): Promise<string | null>;
}

export interface SandboxResult {
  /** The sections the agent was given, in order — inspectable, like Context. */
  readonly contextUsed: readonly string[];
  /** The allowlist the run would enforce. */
  readonly toolsAllowed: readonly string[];
  readonly notes: readonly string[];
  /** Proposed and only proposed. The sandbox cannot apply them. */
  readonly proposedMutations: readonly ProposedEdit[];
  readonly modelId?: string;
  /** Present when the run could not happen; a skipped test is not a passed one. */
  readonly skipped?: string;
}

const EXCERPT_LIMIT = 6_000;

export async function testAgent(
  agent: CustomAgentDefinition,
  options: {
    readonly project: SandboxProject;
    readonly invoker: AgentInvoker | null;
    /** Focus the sample on one chapter title, when given. */
    readonly focusChapter?: string;
  },
): Promise<SandboxResult> {
  const contextUsed: string[] = [];
  const parts: string[] = [];

  const chapters = await options.project.chapters();
  const focus =
    options.focusChapter === undefined
      ? chapters[0]
      : (chapters.find((held) => held.title === options.focusChapter) ?? chapters[0]);
  if (
    (agent.context.currentChapter === true || agent.context.currentScene === true) &&
    focus !== undefined
  ) {
    const label = agent.context.currentScene === true ? "Current scene" : "Current chapter";
    contextUsed.push(`${label}: ${focus.title}`);
    parts.push(`# ${focus.title}\n\n${focus.text.slice(0, EXCERPT_LIMIT)}`);
  }
  if (agent.context.charactersPresent === true && options.project.characters !== undefined) {
    const names = await options.project.characters();
    if (names.length > 0) {
      contextUsed.push("Characters present");
      parts.push(`Characters: ${names.join(", ")}`);
    }
  }
  if (agent.context.relevantResearch === true && options.project.research !== undefined) {
    const items = await options.project.research();
    if (items.length > 0) {
      contextUsed.push("Relevant research");
      parts.push(`Research:\n${items.join("\n")}`);
    }
  }
  if (agent.context.plotThreads === true && options.project.plotThreads !== undefined) {
    const threads = await options.project.plotThreads();
    if (threads.length > 0) {
      contextUsed.push("Plot threads");
      parts.push(`Plot threads: ${threads.join(", ")}`);
    }
  }
  if (agent.context.authorVoice === true && options.project.authorVoice !== undefined) {
    const voice = await options.project.authorVoice();
    if (voice !== null) {
      contextUsed.push("Author Voice");
      parts.push(`Author voice:\n${voice}`);
    }
  }

  if (options.invoker === null) {
    return {
      contextUsed,
      toolsAllowed: agent.tools,
      notes: [],
      proposedMutations: [],
      skipped: "No model is configured, so the test run was skipped — not passed.",
    };
  }

  const result = await options.invoker.invoke({
    definition: agent,
    instruction: agent.instructions,
    material: parts.join("\n\n---\n\n"),
    wantsProposals: agent.output.kind === "proposals",
  });
  return {
    contextUsed,
    toolsAllowed: agent.tools,
    notes: result.notes,
    proposedMutations: result.proposals ?? [],
    ...(result.modelId !== undefined ? { modelId: result.modelId } : {}),
  };
}
