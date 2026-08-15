import { parseCommandLine } from "./parser";
import type { CommandRegistry } from "./registry";
import type { Invocation } from "./types";

/**
 * Bounded command chains (§11).
 *
 * `/build then /continuity-audit then /dialogue-pass` is a short, validated
 * sequence of Manu commands — not a script. Every step must be a registered,
 * chainable command; the whole chain parses before any step runs; and there
 * are no conditionals, no loops, no variables and no shell. A step that opens
 * an approval-gated workflow ends the chain there, because approval belongs
 * to the writer, not to step three.
 */

export const MAX_CHAIN_STEPS = 8;

export interface CommandChain {
  readonly steps: readonly Invocation[];
}

export type ChainResult =
  | { readonly ok: true; readonly chain: CommandChain }
  | { readonly ok: false; readonly error: string };

/** True when the line contains more than one step. */
export function isChain(line: string): boolean {
  return splitSteps(line).length > 1;
}

export function parseChain(line: string, registry: CommandRegistry): ChainResult {
  const parts = splitSteps(line);
  if (parts.length > MAX_CHAIN_STEPS) {
    return { ok: false, error: `A chain runs at most ${MAX_CHAIN_STEPS} steps.` };
  }
  const steps: Invocation[] = [];
  for (const part of parts) {
    const parsed = parseCommandLine(part, registry);
    if (!parsed.ok) {
      return { ok: false, error: `In "${part}": ${parsed.error}` };
    }
    if (parts.length > 1 && !parsed.invocation.spec.chainable) {
      return {
        ok: false,
        error: `/${parsed.invocation.spec.id} cannot run inside a chain — run it on its own.`,
      };
    }
    steps.push(parsed.invocation);
  }
  if (steps.length === 0) return { ok: false, error: "Type a command, e.g. /help." };
  return { ok: true, chain: { steps } };
}

/**
 * Steps are separated by newlines or by the word `then` between commands.
 * `then` only separates when the next word starts a command, so prose like
 * `/debug why Marcus then betrays Elias` stays one command.
 */
function splitSteps(line: string): string[] {
  return line
    .split(/\n+|\s+then\s+(?=\/)/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}
