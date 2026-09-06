import { describe, expect, it } from "vitest";
import {
  CHECKED_BY_US_KINDS,
  credentialState,
  isCheckedByUs,
  isCredential,
  isOnStorefront,
} from "./credentials";
import { PUBLISHABLE_DOCUMENT_KINDS } from "@/lib/storefront/section-types";

const dubai = (iso: string) => new Date(`${iso}+04:00`);
const now = dubai("2026-09-06T09:00:00");

describe("the two document classes", () => {
  it("never overlap", () => {
    // The whole design of board 3e rests on this: a document that sets the tier
    // is a document we hold, and a document the seller shows is one we have not
    // checked. A kind in both lists would be a certificate claiming a check.
    for (const kind of CHECKED_BY_US_KINDS) {
      expect(PUBLISHABLE_DOCUMENT_KINDS as readonly string[]).not.toContain(kind);
    }
  });

  it("puts the licence and the TRN on the side that sets the tier", () => {
    expect(isCheckedByUs("trade_licence")).toBe(true);
    expect(isCheckedByUs("vat_certificate")).toBe(true);
    expect(isCheckedByUs("certificate")).toBe(false);
  });

  it("puts a certificate on the side that sets nothing", () => {
    expect(isCredential("certificate")).toBe(true);
    expect(isCredential("trade_licence")).toBe(false);
  });
});

describe("credentialState", () => {
  const base = { isPublic: false, reviewedAt: null, validUntil: null };

  it("is on file when there is nothing to say", () => {
    expect(credentialState({ ...base, reviewedAt: dubai("2026-01-01T00:00:00") }, now)).toBe("on_file");
  });

  it("counts a document with no expiry as on file forever", () => {
    expect(credentialState({ ...base, validUntil: null, isPublic: false }, now)).toBe("on_file");
  });

  it("is expiring inside the notice window and on file outside it", () => {
    // The render's own case: Civil Defence, 28 Sep 2026, 22 days out.
    expect(credentialState({ ...base, validUntil: dubai("2026-09-28T00:00:00") }, now)).toBe("expiring");
    // And ISO 9001, March 2027, which is not urgent and does not say so.
    expect(credentialState({ ...base, validUntil: dubai("2027-03-01T00:00:00") }, now)).toBe("on_file");
  });

  it("is in review while the seller has asked to publish and nobody has looked", () => {
    expect(credentialState({ ...base, isPublic: true, reviewedAt: null }, now)).toBe("in_review");
  });

  it("stops being in review once somebody has", () => {
    expect(
      credentialState({ ...base, isPublic: true, reviewedAt: dubai("2026-09-01T00:00:00") }, now),
    ).toBe("on_file");
  });

  it("reads lapsed rather than in review, because that is the state with the consequence", () => {
    expect(
      credentialState({ isPublic: true, reviewedAt: null, validUntil: dubai("2026-08-01T00:00:00") }, now),
    ).toBe("lapsed");
  });
});

describe("isOnStorefront", () => {
  it("needs both decisions", () => {
    const reviewed = dubai("2026-09-01T00:00:00");
    expect(isOnStorefront({ isPublic: true, reviewedAt: reviewed, validUntil: null })).toBe(true);
    // The seller asked and nobody has looked.
    expect(isOnStorefront({ isPublic: true, reviewedAt: null, validUntil: null })).toBe(false);
    // Somebody looked and the seller has since withdrawn the ask.
    expect(isOnStorefront({ isPublic: false, reviewedAt: reviewed, validUntil: null })).toBe(false);
  });
});
