import { describe, expect, it } from "vitest";
import { groundClaim, groundClaims, groundingSummary } from "./claims";

describe("groundClaim", () => {
  const known = new Set(["E1", "E2"]);

  it("grounds a claim whose every citation resolves", () => {
    const claim = groundClaim("The vault is sealed.", ["E1", "E2"], known);
    expect(claim).toEqual({
      statement: "The vault is sealed.",
      basis: ["E1", "E2"],
      unsupported: [],
      grounded: true,
    });
  });

  it("keeps a citation that resolves to nothing rather than trimming it", () => {
    // Silently dropping the bad citation would leave the claim looking sound.
    const claim = groundClaim("Mara knew.", ["E1", "E9"], known);
    expect(claim.basis).toEqual(["E1"]);
    expect(claim.unsupported).toEqual(["E9"]);
    expect(claim.grounded).toBe(false);
  });

  it("does not ground an uncited claim", () => {
    // It may be a sensible reading. It is not something the project said.
    expect(groundClaim("It feels rushed.", [], known).grounded).toBe(false);
  });

  it("summarises a set of claims", () => {
    const claims = groundClaims(
      [
        { statement: "a", cited: ["E1"] },
        { statement: "b", cited: ["E9"] },
        { statement: "c", cited: [] },
      ],
      known,
    );
    expect(groundingSummary(claims)).toEqual({ total: 3, grounded: 1, unsupported: 1 });
  });
});
