import { describe, expect, it } from "vitest";
import { PAYMENT_TERMS, PROPOSAL_PAYMENT_TERMS, parsePaymentTerms, parseProposalPaymentTerms } from "./terms";

/**
 * Board `7c-s` — two picklists over one enum, and the null rule both keep.
 *
 * A proposal's *payment agreed* reads the same `Quote.paymentTerms` column the
 * goods quote does. What differs is what each composer may offer, and a value
 * the other side's list holds must not slip through a form that never showed it.
 */
describe("payment terms", () => {
  it("offers work its own terms and goods its own", () => {
    expect(PROPOSAL_PAYMENT_TERMS).toContain("in_arrears");
    expect(PROPOSAL_PAYMENT_TERMS).toContain("on_completion");
    expect(PROPOSAL_PAYMENT_TERMS).not.toContain("cod");
    expect(PROPOSAL_PAYMENT_TERMS).not.toContain("lc");
    expect(PAYMENT_TERMS).not.toContain("in_arrears");
    expect(PAYMENT_TERMS).not.toContain("on_completion");
  });

  it("reads a proposal's term from its own list only", () => {
    expect(parseProposalPaymentTerms("in_arrears")).toBe("in_arrears");
    expect(parseProposalPaymentTerms("net_30")).toBe("net_30");
    expect(parseProposalPaymentTerms("lc")).toBeNull();
    expect(parseProposalPaymentTerms("")).toBeNull();
    expect(parseProposalPaymentTerms(undefined)).toBeNull();
  });

  it("keeps the goods composer's list closed to the proposal's terms", () => {
    expect(parsePaymentTerms("in_arrears")).toBeNull();
    expect(parsePaymentTerms("cod")).toBe("cod");
  });
});
