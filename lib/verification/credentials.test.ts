import { describe, expect, it } from "vitest";
import {
  CHECKED_BY_US_KINDS,
  credentialState,
  isCheckedByUs,
  isCredential,
  PUBLISHABLE_DOCUMENT_KINDS,
} from "./credentials";

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
  const base = { validUntil: null };

  it("counts a document with no expiry as on file forever", () => {
    expect(credentialState(base, now)).toBe("on_file");
  });

  it("is expiring inside the notice window and on file outside it", () => {
    // The render's own case: Civil Defence, 28 Sep 2026, 22 days out.
    expect(credentialState({ validUntil: dubai("2026-09-28T00:00:00") }, now)).toBe("expiring");
    // And ISO 9001, March 2027, which is not urgent and does not say so.
    expect(credentialState({ validUntil: dubai("2027-03-01T00:00:00") }, now)).toBe("on_file");
  });

  it("is lapsed once its validity has passed", () => {
    expect(credentialState({ validUntil: dubai("2026-08-01T00:00:00") }, now)).toBe("lapsed");
  });
});
