import { describe, expect, it } from "vitest";
import {
  EDITABLE_DAYS,
  PROVENANCE,
  provenanceOf,
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
const REPLIED = "biz_replied";
const SILENT = "biz_never_answered";
const NOW = new Date("2026-08-24T12:00:00+04:00");

function enquiry(over: Partial<EnquiryForReview> = {}): EnquiryForReview {
  return {
    id: "enq_1",
    buyerId: BUYER,
    contactReleasedToBusinessId: BUSINESS,
    contactReleasedAt: new Date("2026-08-20T10:00:00+04:00"),
    repliedBusinessIds: [BUSINESS],
    alreadyReviewed: false,
    ...over,
  };
}

describe("board 1m criterion 3 — the gate, and the two rungs it admits", () => {
  it("lets a buyer review the supplier whose quote they accepted", () => {
    expect(canReview(BUYER, enquiry())).toEqual({
      ok: true,
      businessId: BUSINESS,
      provenance: "accepted_quote",
    });
  });

  it("lets a buyer review a supplier who answered, with no quote accepted", () => {
    /*
     * The second rung. Board 1m: "a review requires a confirmed enquiry or an
     * accepted quote", and the grey `Verified enquiry` badge on the page is a
     * label nothing could carry while this returned no.
     */
    const replied = enquiry({
      contactReleasedToBusinessId: null,
      repliedBusinessIds: [REPLIED],
    });
    expect(canReview(BUYER, replied)).toEqual({
      ok: true,
      businessId: REPLIED,
      provenance: "verified_enquiry",
    });
  });

  it("refuses a supplier who received the enquiry and never replied", () => {
    // Delivery is not confirmation of anything. Eight suppliers get a fan-out;
    // a buyer who heard from two of them has met two suppliers.
    const replied = enquiry({ contactReleasedToBusinessId: null, repliedBusinessIds: [REPLIED] });
    expect(canReview(BUYER, replied, SILENT)).toEqual({
      ok: false,
      reason: "no_confirmed_enquiry",
    });
  });

  it("refuses when nobody accepted and nobody replied", () => {
    expect(
      canReview(BUYER, enquiry({ contactReleasedToBusinessId: null, repliedBusinessIds: [] })),
    ).toEqual({ ok: false, reason: "no_confirmed_enquiry" });
  });

  it("asks which supplier when several replied and none was accepted", () => {
    // One review per enquiry, so the subject has to be named rather than
    // guessed. Guessing would file a review against the wrong storefront.
    const fanout = enquiry({
      contactReleasedToBusinessId: null,
      repliedBusinessIds: [REPLIED, "biz_other"],
    });
    expect(canReview(BUYER, fanout)).toEqual({ ok: false, reason: "ambiguous_subject" });
    expect(canReview(BUYER, fanout, REPLIED)).toEqual({
      ok: true,
      businessId: REPLIED,
      provenance: "verified_enquiry",
    });
  });

  it("keeps the accepted rung when the accepted supplier is also named", () => {
    expect(canReview(BUYER, enquiry(), BUSINESS)).toEqual({
      ok: true,
      businessId: BUSINESS,
      provenance: "accepted_quote",
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

describe("board 1m criterion 1 — the provenance ladder", () => {
  it("names the accepted rung when the enquiry released contact to this seller", () => {
    expect(
      provenanceOf({ businessId: BUSINESS, enquiry: { contactReleasedToBusinessId: BUSINESS } }),
    ).toBe("accepted_quote");
  });

  it("names the enquiry rung otherwise, including a quote accepted elsewhere", () => {
    expect(
      provenanceOf({ businessId: REPLIED, enquiry: { contactReleasedToBusinessId: null } }),
    ).toBe("verified_enquiry");
    expect(
      provenanceOf({ businessId: REPLIED, enquiry: { contactReleasedToBusinessId: BUSINESS } }),
    ).toBe("verified_enquiry");
  });

  it("has exactly two rungs — there is no unverified review", () => {
    expect(PROVENANCE).toEqual(["accepted_quote", "verified_enquiry"]);
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
