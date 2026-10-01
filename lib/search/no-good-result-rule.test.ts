import { describe, expect, it } from "vitest";
import { holdsGoodResult } from "./no-good-result-rule";

/**
 * D-NOGOOD, board 4a: a search has no good result when its first page of
 * suppliers holds no claimed, licence-verified supplier.
 */

describe("a good result", () => {
  it("is a claimed supplier at the badge's tier", () => {
    expect(holdsGoodResult([{ claimStatus: "claimed", verificationTier: 2 }])).toBe(true);
  });

  it("is not twenty unclaimed licence records, however many", () => {
    expect(holdsGoodResult(Array.from({ length: 20 }, () => ({ claimStatus: "unclaimed", verificationTier: 2 })))).toBe(false);
  });

  it("is not a claimed supplier whose licence nobody has checked", () => {
    expect(holdsGoodResult([{ claimStatus: "claimed", verificationTier: 1 }])).toBe(false);
  });

  it("is not a disputed listing, which every public surface reads as unclaimed", () => {
    expect(holdsGoodResult([{ claimStatus: "disputed", verificationTier: 2 }])).toBe(false);
  });

  it("is absent from an empty page", () => {
    expect(holdsGoodResult([])).toBe(false);
  });
});
