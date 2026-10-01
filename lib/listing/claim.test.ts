import { describe, expect, it } from "vitest";
import { publiclyClaimed } from "@/lib/claims/status";
import { claimHref, invitesClaim } from "./claim";

const NOW = new Date("2026-10-01T09:00:00+04:00");

describe("publiclyClaimed — one answer for every public surface", () => {
  it("reads claimed as claimed", () => {
    expect(publiclyClaimed("claimed")).toBe(true);
  });

  it("reads unclaimed as unclaimed", () => {
    expect(publiclyClaimed("unclaimed")).toBe(false);
  });

  it("reads disputed as unclaimed — board 4c B10, the owner's answer of 1 Oct 2026", () => {
    // The storefront used to test `=== "unclaimed"` and handed a disputed
    // listing the claimed composition; the card never tested at all.
    expect(publiclyClaimed("disputed")).toBe(false);
  });
});

describe("claimHref — board 10g B10", () => {
  it("prefills the licence, which 2a answers with one exact match", () => {
    expect(claimHref("DED-118904")).toBe("/onboarding/claim?licence=DED-118904");
  });

  it("encodes whatever the register wrote", () => {
    expect(claimHref("JAFZA 12/345")).toBe("/onboarding/claim?licence=JAFZA%2012%2F345");
  });
});

describe("invitesClaim — B4, after 13d's rule", () => {
  it("invites a claim on an unclaimed listing with a current licence", () => {
    expect(invitesClaim({ claimStatus: "unclaimed", licenceExpiry: "2027-03-14T00:00:00+04:00" }, NOW)).toBe(true);
  });

  it("still invites one while two are in dispute — 2b's rule, Q2", () => {
    expect(invitesClaim({ claimStatus: "disputed", licenceExpiry: new Date("2027-03-14T00:00:00+04:00") }, NOW)).toBe(
      true,
    );
  });

  it("withdraws it once the register says the licence has lapsed", () => {
    expect(invitesClaim({ claimStatus: "unclaimed", licenceExpiry: "2026-09-30T00:00:00+04:00" }, NOW)).toBe(false);
  });

  it("agrees with `licenceExpired` at the boundary: lapsed only once the instant has passed", () => {
    expect(invitesClaim({ claimStatus: "unclaimed", licenceExpiry: NOW }, NOW)).toBe(true);
    expect(invitesClaim({ claimStatus: "unclaimed", licenceExpiry: new Date(NOW.getTime() - 1) }, NOW)).toBe(false);
  });

  it("never invites one on a claimed listing", () => {
    expect(invitesClaim({ claimStatus: "claimed", licenceExpiry: "2027-03-14T00:00:00+04:00" }, NOW)).toBe(false);
  });
});
