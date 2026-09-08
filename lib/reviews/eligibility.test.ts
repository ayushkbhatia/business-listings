import { describe, expect, it } from "vitest";
import { ReviewDisputeGround } from "@/lib/db/generated/enums";
import {
  DISPUTE_GROUNDS,
  EDITABLE_DAYS,
  PROVENANCE,
  provenanceOf,
  REMOVAL_GROUNDS,
  REPLY_WINDOW_DAYS,
  REQUEST_WINDOW_DAYS,
  canDisputeReview,
  canRequestReview,
  canReview,
  cardStateOf,
  editableUntil,
  isDisputeGround,
  isEditable,
  isRemovalGround,
  ratingsAreValid,
  replyWindowEnds,
  replyWindowOpen,
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

describe("the four grounds a seller may cite", () => {
  it("are exactly four, in the order the rail lists them", () => {
    // Criterion 6: the rail lists exactly what the dispute flow accepts. Both
    // read this array, and the Postgres enum declares the same four in the same
    // order so a queue grouped by ground reads in the same sequence.
    expect([...DISPUTE_GROUNDS]).toEqual([
      "no_traceable_enquiry",
      "abuse",
      "private_information",
      "provably_false",
    ]);
  });

  it("do not include a seller disliking it", () => {
    // The README is explicit: "It is unfair" is not one of them.
    for (const notAGround of ["unfair", "competitor", "bad_for_business", "disputed"]) {
      expect(isDisputeGround(notAGround), notAGround).toBe(false);
      expect(isRemovalGround(notAGround), notAGround).toBe(false);
    }
  });

  it("cannot be used to dispute a review as incentivised", () => {
    /*
       Board 11c `B6`. Staff remove an incentivised review on a ground of their
       own; no supplier files a dispute reporting themselves, and offering the
       ground on the rail would be inviting one to.
    */
    expect(isDisputeGround("incentivised")).toBe(false);
    expect(isRemovalGround("incentivised")).toBe(true);
  });

  it("is the same list Postgres holds, in the same order", () => {
    /*
       Criterion 6, at the level below the screen. The rail renders
       `DISPUTE_GROUNDS`, the form accepts it, the queue groups by it and the
       column stores `review_dispute_ground` — and declaration order is sort
       order in Postgres, so a queue grouped by ground and the rail listing them
       01–04 read in the same sequence without either sorting by hand.
    */
    expect(Object.values(ReviewDisputeGround)).toEqual([...DISPUTE_GROUNDS]);
  });

  it("are a prefix of the grounds staff can remove on", () => {
    // One list derived from the other, so a ground can never become removable
    // and undisputable — or the reverse — by somebody editing one array.
    expect([...REMOVAL_GROUNDS].slice(0, DISPUTE_GROUNDS.length)).toEqual([...DISPUTE_GROUNDS]);
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

// ─────────────────────────────────────────────────────────────────────────────
// Board 11c — the reply window, the card states, and disputing
// ─────────────────────────────────────────────────────────────────────────────

const POSTED = new Date("2026-08-28T09:00:00+04:00");
const OPEN_ROW = {
  createdAt: POSTED,
  sellerReply: null,
  removedAt: null,
  heldAt: null,
} as const;

describe("the reply window", () => {
  it("is twenty-eight days from the review, for every plan", () => {
    // Q6: one rule, no per-plan variation. Q5 is the same decision one step
    // out — reviews are reputation, and gating a reply punishes the buyer.
    expect(REPLY_WINDOW_DAYS).toBe(28);
    expect(replyWindowEnds(POSTED).toISOString()).toBe(
      new Date("2026-09-25T05:00:00.000Z").toISOString(),
    );
  });

  it("is open the day before it closes and shut the day after", () => {
    expect(replyWindowOpen(OPEN_ROW, new Date("2026-09-24T09:00:00+04:00"))).toBe(true);
    expect(replyWindowOpen(OPEN_ROW, new Date("2026-09-26T09:00:00+04:00"))).toBe(false);
  });

  it("is shut once the seller has used their one reply", () => {
    expect(
      replyWindowOpen(
        { ...OPEN_ROW, sellerReply: "Thank you" },
        new Date("2026-08-29T09:00:00+04:00"),
      ),
    ).toBe(false);
  });

  it("is shut on a held review, whatever the date says", () => {
    /*
       A held review is off the public page and may never come back. A reply
       written against something the seller cannot see is a reply they cannot
       mean, and it is the one thing on this record that cannot be taken back.
    */
    expect(replyWindowOpen({ ...OPEN_ROW, heldAt: POSTED }, POSTED)).toBe(false);
    expect(replyWindowOpen({ ...OPEN_ROW, removedAt: POSTED }, POSTED)).toBe(false);
  });
});

describe("which state a card is in", () => {
  const base = { ...OPEN_ROW, hasOpenDispute: false };
  const inWindow = new Date("2026-09-01T09:00:00+04:00");
  const afterWindow = new Date("2026-10-01T09:00:00+04:00");

  it("is awaiting a reply inside the window and closed outside it", () => {
    expect(cardStateOf(base, inWindow)).toBe("awaiting_reply");
    expect(cardStateOf(base, afterWindow)).toBe("window_closed");
  });

  it("is replied once there is a reply, in the window or out of it", () => {
    const replied = { ...base, sellerReply: "Fair point" };
    expect(cardStateOf(replied, inWindow)).toBe("replied");
    expect(cardStateOf(replied, afterWindow)).toBe("replied");
  });

  it("puts an open dispute in front of a reply", () => {
    /*
       Precedence, and it is not alphabetical. A seller who replied and then
       disputed is waiting on us, and "replied" would hide the thing that is
       actually in flight.
    */
    expect(
      cardStateOf({ ...base, sellerReply: "Fair point", hasOpenDispute: true }, inWindow),
    ).toBe("under_dispute");
  });

  it("puts a hold in front of a dispute, and a removal in front of everything", () => {
    expect(cardStateOf({ ...base, heldAt: POSTED, hasOpenDispute: true }, inWindow)).toBe("held");
    expect(
      cardStateOf({ ...base, removedAt: POSTED, heldAt: POSTED, hasOpenDispute: true }, inWindow),
    ).toBe("removed");
  });
});

describe("who may dispute what", () => {
  const review = {
    businessId: "biz_1",
    removedAt: null,
    heldAt: null,
    hasOpenDispute: false,
  } as const;

  it("allows a seller to dispute a review on their own listing", () => {
    expect(canDisputeReview(review, "biz_1")).toEqual({ ok: true });
  });

  it("refuses somebody else's review", () => {
    expect(canDisputeReview(review, "biz_2")).toEqual({ ok: false, reason: "not_yours" });
  });

  it("refuses a second open dispute on one review", () => {
    // The same case decided twice, on the queue whose promise is a single
    // answer in two working days. The partial unique index is under this.
    expect(canDisputeReview({ ...review, hasOpenDispute: true }, "biz_1")).toEqual({
      ok: false,
      reason: "already_disputed",
    });
  });

  it("refuses a decision already made or in progress", () => {
    expect(canDisputeReview({ ...review, removedAt: POSTED }, "biz_1")).toEqual({
      ok: false,
      reason: "already_removed",
    });
    expect(canDisputeReview({ ...review, heldAt: POSTED }, "biz_1")).toEqual({
      ok: false,
      reason: "already_held",
    });
  });

  it("has no deadline, unlike the reply", () => {
    /*
       Deliberate. A public conversation held eleven months late is not a
       conversation, which is why the reply window closes; none of the four
       grounds expires the same way. A review naming somebody's mobile number is
       a private-information problem on the day it is written and on the same
       day next year.
    */
    expect(canDisputeReview(review, "biz_1")).toEqual({ ok: true });
  });
});
