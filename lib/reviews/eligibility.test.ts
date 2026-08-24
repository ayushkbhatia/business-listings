import { describe, expect, it } from "vitest";
import {
  EDITABLE_DAYS,
  REMOVAL_GROUNDS,
  REQUEST_WINDOW_DAYS,
  canRequestReview,
  canReview,
  editableUntil,
  isEditable,
  isRemovalGround,
  ratingsAreValid,
  type EnquiryForReview,
} from "./eligibility";

const BUYER = "user_buyer";
const BUSINESS = "biz_accepted";
const NOW = new Date("2026-08-24T12:00:00+04:00");

function enquiry(over: Partial<EnquiryForReview> = {}): EnquiryForReview {
  return {
    id: "enq_1",
    buyerId: BUYER,
    contactReleasedToBusinessId: BUSINESS,
    contactReleasedAt: new Date("2026-08-20T10:00:00+04:00"),
    alreadyReviewed: false,
    ...over,
  };
}

describe("criterion 9 — the gate", () => {
  it("lets a buyer review the supplier whose quote they accepted", () => {
    expect(canReview(BUYER, enquiry())).toEqual({ ok: true, businessId: BUSINESS });
  });

  it("refuses when no quote was ever accepted", () => {
    // An accepted quote is the only confirmation this platform has: it holds no
    // delivery record and no payment.
    expect(canReview(BUYER, enquiry({ contactReleasedToBusinessId: null }))).toEqual({
      ok: false,
      reason: "no_accepted_quote",
    });
  });

  it("refuses somebody else's enquiry, and a missing one, identically", () => {
    expect(canReview("user_other", enquiry())).toEqual({ ok: false, reason: "not_your_enquiry" });
    expect(canReview(BUYER, null)).toEqual({ ok: false, reason: "not_your_enquiry" });
  });

  it("allows one per enquiry, and no more", () => {
    expect(canReview(BUYER, enquiry({ alreadyReviewed: true }))).toEqual({
      ok: false,
      reason: "already_reviewed",
    });
  });
});

describe("ratings", () => {
  const good = { overall: 4, quotedAccurate: 5, onTime: 3, asDescribed: 4, responsiveness: 5 };

  it("accepts one to five on every dimension", () => {
    expect(ratingsAreValid(good)).toBe(true);
  });

  it("refuses a zero, which is a missing answer rather than a bad one", () => {
    expect(ratingsAreValid({ ...good, onTime: 0 })).toBe(false);
  });

  it("refuses a missing dimension", () => {
    const partial = Object.fromEntries(
      Object.entries(good).filter(([key]) => key !== "responsiveness"),
    );
    expect(ratingsAreValid(partial)).toBe(false);
  });

  it("refuses six, and a fraction", () => {
    expect(ratingsAreValid({ ...good, overall: 6 })).toBe(false);
    expect(ratingsAreValid({ ...good, overall: 4.5 })).toBe(false);
  });
});

describe("the editing window", () => {
  it("is fourteen days from writing", () => {
    const created = new Date("2026-08-10T09:00:00+04:00");
    const until = editableUntil(created);
    expect((until.getTime() - created.getTime()) / 86_400_000).toBe(EDITABLE_DAYS);
  });

  it("closes on time", () => {
    expect(isEditable({ editableUntil: new Date("2026-08-25T00:00:00Z"), removedAt: null }, NOW)).toBe(true);
    expect(isEditable({ editableUntil: new Date("2026-08-20T00:00:00Z"), removedAt: null }, NOW)).toBe(false);
  });

  it("is closed on a removed review, whatever the date says", () => {
    expect(
      isEditable({ editableUntil: new Date("2027-01-01T00:00:00Z"), removedAt: NOW }, NOW),
    ).toBe(false);
  });
});

describe("the four grounds for removal", () => {
  it("are exactly four", () => {
    expect([...REMOVAL_GROUNDS]).toEqual([
      "no_traceable_enquiry",
      "abuse",
      "private_information",
      "provably_false",
    ]);
  });

  it("do not include a seller disliking it", () => {
    // The README is explicit: "It is unfair" is not one of them.
    for (const notAGround of ["unfair", "competitor", "bad_for_business", "disputed"]) {
      expect(isRemovalGround(notAGround), notAGround).toBe(false);
    }
  });
});

describe("asking for a review", () => {
  const base = {
    acceptedAt: new Date("2026-08-01T10:00:00+04:00"),
    alreadyAsked: false,
    alreadyReviewed: false,
  };

  it("is allowed once, about a recent accepted quote", () => {
    expect(canRequestReview(base, NOW)).toEqual({ ok: true });
  });

  it("needs an accepted quote, like the review itself", () => {
    expect(canRequestReview({ ...base, acceptedAt: null }, NOW)).toEqual({
      ok: false,
      reason: "no_accepted_quote",
    });
  });

  it("closes after ninety days", () => {
    const old = new Date(NOW.getTime() - (REQUEST_WINDOW_DAYS + 1) * 86_400_000);
    expect(canRequestReview({ ...base, acceptedAt: old }, NOW)).toEqual({
      ok: false,
      reason: "too_old",
    });
  });

  it("is once per buyer ever, not once per enquiry", () => {
    // A seller who may ask once a quarter for five years has learned to nag.
    expect(canRequestReview({ ...base, alreadyAsked: true }, NOW)).toEqual({
      ok: false,
      reason: "already_asked",
    });
  });

  it("does not ask somebody who already wrote one", () => {
    expect(canRequestReview({ ...base, alreadyReviewed: true }, NOW)).toEqual({
      ok: false,
      reason: "already_reviewed",
    });
  });
});
