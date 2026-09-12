import { describe, expect, it } from "vitest";
import {
  CHECKABLE_KINDS,
  CREDENTIAL_KINDS,
  CREDENTIAL_TARGET,
  SUGGESTION_FLOOR,
  isCheckable,
  isCredentialKind,
  labelFor,
  promiseFor,
  rateOf,
  worthSuggesting,
  type SuggestionRate,
} from "./kinds";
import { normaliseTaan } from "./fta";

/**
 * Board `8b-s` — what a credential may claim, and what it may not.
 *
 * The rule the whole screen rests on is that an unverified claim never renders
 * like a verified one. It is set here and enforced on `1d-s` and `1g-s`, so it
 * is worth a test that does not need either screen to exist.
 */

describe("which kinds a register can answer for", () => {
  it("is exactly one, and the trade licence is not a credential at all", () => {
    /*
       The licence lives on `Business` — number, authority, expiry, `verifiedAt`
       — and it is the one thing the platform has actually checked. A row here
       mirroring it would be a second source of truth for the only verified fact
       on the listing.
    */
    expect(CHECKABLE_KINDS).toEqual(["fta_tax_agent"]);
    expect(CREDENTIAL_KINDS as readonly string[]).not.toContain("trade_licence");
    expect(isCheckable("fta_tax_agent")).toBe(true);
    expect(isCheckable("indemnity_insurance")).toBe(false);
  });

  it("refuses a kind that is not one of the five", () => {
    expect(isCredentialKind("professional_body")).toBe(true);
    expect(isCredentialKind("iso_9001")).toBe(false);
  });
});

describe("what a credential is allowed to say about itself", () => {
  it("never calls a claim verified, whatever its kind", () => {
    // An FTA number nobody checked is still the seller's own word for it.
    expect(labelFor("fta_tax_agent", "seller_claim")).toBe("seller_claim");
    expect(labelFor("indemnity_insurance", "seller_claim")).toBe("seller_claim");
  });

  it("calls a checked row register-verified", () => {
    expect(labelFor("fta_tax_agent", "register_verified")).toBe("register_verified");
  });

  it("promises a check only on the field that can have one", () => {
    /*
       `we_verify_this` is the third label and it is not a state a row can be
       in: it is what the *field* says before anything is submitted. Storing it
       would be a tier nothing could ever write, which is a badge waiting to be
       rendered over nothing.
    */
    expect(promiseFor("fta_tax_agent")).toBe("we_verify_this");
    expect(promiseFor("mof_audit_approval")).toBeNull();
    expect(promiseFor("other")).toBeNull();
  });
});

describe("the suggestion rate — B6, AC6", () => {
  const rates: SuggestionRate[] = [
    { kind: "mof_audit_approval", holders: 68, peers: 100, rate: 0.68 },
    { kind: "professional_body", holders: 40, peers: 100, rate: 0.4 },
    { kind: "indemnity_insurance", holders: 10, peers: 100, rate: 0.1 },
  ];

  it("offers the strongest first and drops anything under the floor", () => {
    const shown = worthSuggesting(rates, []);
    expect(shown.map((row) => row.kind)).toEqual(["mof_audit_approval", "professional_body"]);
    expect(SUGGESTION_FLOOR).toBe(0.25);
  });

  it("never suggests something the firm already holds", () => {
    const shown = worthSuggesting(rates, ["mof_audit_approval"]);
    expect(shown.map((row) => row.kind)).toEqual(["professional_body"]);
  });

  it("suggests nothing at all when there are no peers", () => {
    /*
       The honest cold start, and it is where this directory is today: no
       business holds a credential, so every rate is zero and the screen shows
       no suggestion rather than a plausible one it made up. A suggestion is
       only worth making because it carries a real number.
    */
    const cold = CREDENTIAL_KINDS.map((kind) => ({ kind, holders: 0, peers: 0, rate: 0 }));
    expect(worthSuggesting(cold, [])).toEqual([]);
  });

  it("reads a rate over no peers as zero rather than NaN", () => {
    expect(rateOf(0, 0)).toBe(0);
    expect(rateOf(3, 4)).toBe(0.75);
    // A holder count above the peer count is a query disagreeing with itself.
    // Clamped, because a suggestion reading 140% is a bug report.
    expect(rateOf(5, 4)).toBe(1);
  });
});

describe("the points", () => {
  it("asks for two credentials, which is `8a-s`'s rule and `8b-s` Q1's shape", () => {
    // 1 of 2 banks half of 32; 2 banks all of it. Board `8b-s` B7 defers to
    // `8a-s`, and `8a-s` settled it when the hub shipped.
    expect(CREDENTIAL_TARGET).toBe(2);
  });
});

describe("a tax agent number", () => {
  it("accepts the digits, with or without the spacing a seller types", () => {
    expect(normaliseTaan("20034512")).toBe("20034512");
    expect(normaliseTaan(" 2003 4512 ")).toBe("20034512");
    expect(normaliseTaan("2003-4512")).toBe("20034512");
  });

  it("refuses a shape that is plainly not one", () => {
    // A licence number in the agent field, an address, a sentence.
    expect(normaliseTaan("CN-2298417")).toBeNull();
    expect(normaliseTaan("agent@firm.ae")).toBeNull();
    expect(normaliseTaan("")).toBeNull();
  });

  it("does not pin a length", () => {
    // TAANs in circulation run to different lengths, and a validator that
    // refused a real one would be worse than no validator at all.
    expect(normaliseTaan("1234")).toBe("1234");
    expect(normaliseTaan("123456789012")).toBe("123456789012");
  });
});
