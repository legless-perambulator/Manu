/**
 * @jellytind/character-sim — is this behaviour plausible, here?
 *
 * Not "chat with your character". The question is whether a proposed action
 * follows from what this person knows, wants and fears **at this point in the
 * story** — which means the state is reconstructed at the boundary entering the
 * scene, and a character is never handed a fact they have not been given
 * (docs/SIMULATIONS.md).
 */

export { snapshotAt, renderSnapshot } from "./snapshot";
export type { CharacterSnapshot } from "./snapshot";

export {
  testBehaviour,
  whatWouldTheyDo,
  establishedFactors,
  hardContradictions,
  heuristicBand,
} from "./behaviour";
export type { BehaviourTestOptions } from "./behaviour";

export { auditAgency } from "./agency";
export type { AgencyAudit, AgencyOptions } from "./agency";

export { behaviourEvidence, motivationBriefing } from "./debugger";

export { CharacterSimError } from "./types";
export type { CharacterAnalyst, CharacterSimErrorCode } from "./types";
