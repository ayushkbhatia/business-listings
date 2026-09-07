import { describe, expect, it } from "vitest";
import {
  daysUntil,
  EXPIRED_LICENCE_TIER,
  licenceExpired,
  licenceStage,
  LICENCE_NOTICE_DAYS,
  LICENCE_URGENT_DAYS,
  TOP_ACHIEVABLE_TIER,
  trustScore,
  VERIFIED_TIER,
} from "./verification";
import { TIERS } from "@/components/domain/verification";

/** Midnight Dubai, written as the offset so the intent is on the page. */
const dubai = (iso: string) => new Date(`${iso}+04:00`);

describe("daysUntil", () => {
  it("counts Dubai calendar days, not elapsed milliseconds", () => {
    // 23:00 Dubai on the 13th to midnight on the 14th is one hour. It is also
    // one day, and one day is what a seller reads on their own wall.
    expect(daysUntil(dubai("2027-04-14T00:00:00"), dubai("2027-04-13T23:00:00"))).toBe(1);
  });

  it("does not change across a UTC midnight that is not a Dubai one", () => {
    // 21:00 and 23:00 UTC on the 12th are 01:00 and 03:00 Dubai on the 13th —
    // the same Dubai day, so the same count. Naive arithmetic gives 2 and 1.
    const a = daysUntil(new Date("2027-04-14T00:00:00+04:00"), new Date("2027-04-12T21:00:00Z"));
    const b = daysUntil(new Date("2027-04-14T00:00:00+04:00"), new Date("2027-04-12T23:00:00Z"));
    expect(a).toBe(b);
  });

  it("is zero on the day itself and negative after", () => {
    expect(daysUntil(dubai("2027-04-14T00:00:00"), dubai("2027-04-14T09:00:00"))).toBe(0);
    expect(daysUntil(dubai("2027-04-14T00:00:00"), dubai("2027-04-20T09:00:00"))).toBe(-6);
  });

  it("gives the render's own figure", () => {
    // The board draws `14 Apr 2027 · 220 days`, hardcoded. Computed, from the
    // day that arithmetic lands on, it is the same number.
    expect(daysUntil(dubai("2027-04-14T00:00:00"), dubai("2026-09-06T00:00:00"))).toBe(220);
  });
});

describe("licenceStage", () => {
  const expiry = dubai("2027-04-14T00:00:00");

  it("says nothing outside the notice window", () => {
    expect(licenceStage(expiry, dubai("2026-09-06T09:00:00"))).toBe("current");
  });

  it("opens the sequence at sixty days", () => {
    const at = dubai("2027-02-13T09:00:00");
    expect(daysUntil(expiry, at)).toBe(LICENCE_NOTICE_DAYS);
    expect(licenceStage(expiry, at)).toBe("notice");
  });

  it("turns urgent at fourteen", () => {
    const at = dubai("2027-03-31T09:00:00");
    expect(daysUntil(expiry, at)).toBe(LICENCE_URGENT_DAYS);
    expect(licenceStage(expiry, at)).toBe("urgent");
  });

  it("is still urgent on the last day, and lapsed the moment it passes", () => {
    expect(licenceStage(expiry, dubai("2027-04-13T23:59:00"))).toBe("urgent");
    expect(licenceStage(expiry, dubai("2027-04-14T00:01:00"))).toBe("lapsed");
  });

  it("agrees with licenceExpired by construction", () => {
    // One comparison, two callers: the render and the nightly sweep. A second
    // definition is how a badge outlives its licence in one of the two places
    // somebody remembered to check.
    for (const at of ["2027-04-13T23:59:00", "2027-04-14T00:01:00", "2028-01-01T09:00:00"]) {
      expect(licenceStage(expiry, dubai(at)) === "lapsed").toBe(licenceExpired(expiry, dubai(at)));
    }
  });
});

describe("the two tiers the expiry rule turns on", () => {
  it("drops below the badge threshold, which is the whole point", () => {
    // The schema said "drops to 2" while 2 *was* licence verification, so a
    // lapsed listing kept the badge the expiry exists to withdraw. Asserted
    // rather than commented, because the pair is the rule.
    expect(EXPIRED_LICENCE_TIER).toBeLessThan(VERIFIED_TIER);
  });
});

describe("trustScore", () => {
  it("gives the top achievable rung the full signal", () => {
    // It divided by 4 in two places — `lib/search/ranking.ts` and
    // `lib/enquiry/fanout.ts` — which was right when the ladder ran to four and
    // has been wrong since site visits were withdrawn. A licence-verified
    // supplier, the best a supplier can be, scored 0.75 of the verification
    // component in the ranking that orders search and in the fan-out that picks
    // who receives an enquiry.
    expect(trustScore(TOP_ACHIEVABLE_TIER)).toBe(1);
    expect(trustScore(0)).toBe(0);
    expect(trustScore(EXPIRED_LICENCE_TIER)).toBe(0.5);
  });

  it("does not let a legacy row above the ladder out-score a verified one", () => {
    // A row stored at 3 or 4 predates the cut. It is a listing nobody
    // re-checked, not a stronger claim.
    expect(trustScore(3)).toBe(1);
    expect(trustScore(4)).toBe(1);
  });
});

describe("the ceiling, defined twice and asserted equal", () => {
  it("agrees with the highest rung on the ladder", () => {
    // `lib/verification.ts` states it so the two scorers can import it without
    // reaching into `components`; `TIERS` is where the rungs actually live.
    // Adding a rung has to move both, and this is what says so.
    //
    // It read `TIERS.filter((spec) => !spec.reserved)` while trade references
    // sat on the ladder drawn but unbuilt. That rung is cut, so every rung in
    // `TIERS` is now reachable and the top of the array is the ceiling — but
    // the pin stays, because two numbers that must be equal and are written in
    // two files is exactly the drift this file exists to catch.
    expect(TOP_ACHIEVABLE_TIER).toBe(TIERS.at(-1)!.tier);
  });

  it("is the ceiling the tier service will actually write", () => {
    // `setVerificationTier` refuses anything above `TOP_ACHIEVABLE_TIER`, and
    // the `business_verification_tier_range` CHECK refuses it underneath. A
    // rung the ladder does not draw but an ops lead can still set is the state
    // the eight legacy rows were in — drawn as unreached on the seller's own
    // screen while the header read the tier back to them.
    expect(TIERS.map((spec) => spec.tier)).toEqual([0, 1, 2]);
    expect(TOP_ACHIEVABLE_TIER).toBe(2);
  });
});
