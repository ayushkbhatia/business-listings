import { describe, expect, it } from "vitest";
import {
  DEFAULT_FANOUT,
  MAX_RECIPIENTS,
  atMonthlyCap,
  monthStart,
  scoreCandidate,
  selectRecipients,
  type FanoutCandidate,
  type FanoutRequest,
} from "./fanout";

const CATEGORY = "cat_valves";

function candidate(over: Partial<FanoutCandidate> & { businessId: string }): FanoutCandidate {
  return {
    slug: over.businessId,
    displayName: over.businessId,
    categoryIds: [CATEGORY],
    primaryCategoryId: CATEGORY,
    emirate: "dubai",
    verificationTier: 2,
    responseTimeMedianMs: 4 * 3_600_000,
    matchedLineCount: 3,
    inStockLineCount: 2,
    enquiriesPerMonth: null,
    enquiriesThisMonth: 0,
    rankingMultiplier: 1,
    ...over,
  };
}

const REQUEST: FanoutRequest = {
  categoryId: CATEGORY,
  categoryIds: [CATEGORY],
  emirate: "dubai",
  lineCount: 3,
  want: DEFAULT_FANOUT,
};

describe("the monthly cap", () => {
  it("is reached when a free plan has spent its three", () => {
    expect(atMonthlyCap(candidate({ businessId: "a", enquiriesPerMonth: 3, enquiriesThisMonth: 3 })))
      .toBe(true);
    expect(atMonthlyCap(candidate({ businessId: "a", enquiriesPerMonth: 3, enquiriesThisMonth: 2 })))
      .toBe(false);
  });

  it("never applies to an unlimited plan", () => {
    expect(atMonthlyCap(candidate({ businessId: "a", enquiriesPerMonth: null, enquiriesThisMonth: 900 })))
      .toBe(false);
  });

  it("takes a capped seller out of matching, not out of delivery", () => {
    // Acceptance criterion 6. The buyer's list has one fewer option and they
    // are never told why, because a seller who cannot reply is worse than one
    // fewer option.
    const capped = candidate({ businessId: "capped", enquiriesPerMonth: 3, enquiriesThisMonth: 3 });
    const { recipients, skipped } = selectRecipients(
      [capped, candidate({ businessId: "open" })],
      { ...REQUEST, want: 5 },
    );

    expect(recipients.map((r) => r.businessId)).toEqual(["open"]);
    expect(skipped).toEqual([{ businessId: "capped", reason: "at_monthly_cap" }]);
  });

  it("skips a capped seller even when the buyer pinned them", () => {
    const capped = candidate({ businessId: "capped", enquiriesPerMonth: 3, enquiriesThisMonth: 3 });
    const { recipients } = selectRecipients([capped], { ...REQUEST, pinned: ["capped"] });
    expect(recipients).toEqual([]);
  });
});

describe("the cap on recipients", () => {
  it("never sends to more than eight", () => {
    const many = Array.from({ length: 30 }, (_, i) => candidate({ businessId: `b${i}` }));
    expect(selectRecipients(many, { ...REQUEST, want: 30 }).recipients).toHaveLength(MAX_RECIPIENTS);
  });

  it("never sends to fewer than one when somebody is eligible", () => {
    const { recipients } = selectRecipients([candidate({ businessId: "a" })], { ...REQUEST, want: 0 });
    expect(recipients).toHaveLength(1);
  });

  it("sends to nobody when nobody is eligible, rather than inventing a recipient", () => {
    expect(selectRecipients([], REQUEST).recipients).toEqual([]);
  });
});

describe("who ranks first", () => {
  it("prefers the seller who can fill more of the enquiry", () => {
    const partial = candidate({ businessId: "partial", matchedLineCount: 1, inStockLineCount: 1 });
    const full = candidate({ businessId: "full", matchedLineCount: 3, inStockLineCount: 3 });
    expect(scoreCandidate(full, REQUEST)).toBeGreaterThan(scoreCandidate(partial, REQUEST));
  });

  it("prefers stock over a lead time, all else equal", () => {
    const toOrder = candidate({ businessId: "order", inStockLineCount: 0 });
    const exStock = candidate({ businessId: "stock", inStockLineCount: 3 });
    expect(scoreCandidate(exStock, REQUEST)).toBeGreaterThan(scoreCandidate(toOrder, REQUEST));
  });

  it("prefers the same emirate, which is a delivery difference and not a nicety", () => {
    const far = candidate({ businessId: "far", emirate: "abu_dhabi" });
    const near = candidate({ businessId: "near", emirate: "dubai" });
    expect(scoreCandidate(near, REQUEST)).toBeGreaterThan(scoreCandidate(far, REQUEST));
  });

  it("scores an unmeasured reply time as unknown, not as slow", () => {
    // Defaulting a new listing to slow would make cold start permanent.
    const unmeasured = candidate({ businessId: "new", responseTimeMedianMs: null });
    const slow = candidate({ businessId: "slow", responseTimeMedianMs: 40 * 3_600_000 });
    expect(scoreCandidate(unmeasured, REQUEST)).toBeGreaterThan(scoreCandidate(slow, REQUEST));
  });

  it("puts a pinned seller first whatever the ranking says", () => {
    // The storefront the buyer was standing on when they wrote the enquiry.
    const weak = candidate({ businessId: "weak", matchedLineCount: 0, inStockLineCount: 0, verificationTier: 0 });
    // Tier 2, the top rung. It read 4, a rung the ladder lost with site visits.
    const strong = candidate({ businessId: "strong", verificationTier: 2 });
    const { recipients } = selectRecipients([strong, weak], { ...REQUEST, want: 2, pinned: ["weak"] });
    expect(recipients[0]!.businessId).toBe("weak");
  });
});

describe("what the plan can and cannot buy", () => {
  it("buys no place on a fan-out at all", () => {
    /*
       It used to reorder two similar suppliers, and this test asserted that.
       The recipient card on `/rfq/new` tells the buyer how the list was
       chosen — "we pick them on what they stock, where they are and how fast
       they reply, never on what they pay us" — and the multiplier made that
       sentence false by up to 35%, which is more than the whole trust term can
       move a supplier.

       Search keeps the multiplier, where a paid boost is disclosed as sponsored
       placement and always labelled. Eight RFQ slots are scarce and the buyer is
       asking rather than browsing, so the promise governs here.
    */
    const plain = candidate({ businessId: "plain", rankingMultiplier: 1 });
    const paid = candidate({ businessId: "paid", rankingMultiplier: 1.35 });
    expect(scoreCandidate(paid, REQUEST)).toBe(scoreCandidate(plain, REQUEST));
  });

  it("cannot promote a supplier who cannot fill the order", () => {
    // The line the multiplier must never cross.
    const paidButEmpty = candidate({
      businessId: "paid",
      rankingMultiplier: 1.35,
      matchedLineCount: 0,
      inStockLineCount: 0,
    });
    const plainAndStocked = candidate({ businessId: "plain", rankingMultiplier: 1 });
    expect(scoreCandidate(plainAndStocked, REQUEST)).toBeGreaterThan(scoreCandidate(paidButEmpty, REQUEST));
  });

  it("is bounded, so a future plan cannot buy its way past the cap", () => {
    const absurd = candidate({ businessId: "absurd", rankingMultiplier: 99 });
    expect(scoreCandidate(absurd, REQUEST)).toBeLessThanOrEqual(1);
  });
});

describe("stability", () => {
  it("picks the same suppliers for the same enquiry twice", () => {
    const pool = Array.from({ length: 12 }, (_, i) => candidate({ businessId: `b${i}` }));
    const first = selectRecipients(pool, REQUEST).recipients.map((r) => r.businessId);
    const second = selectRecipients([...pool].reverse(), REQUEST).recipients.map((r) => r.businessId);
    expect(second).toEqual(first);
  });
});

describe("monthStart", () => {
  it("is the first of the month in the UAE, not in UTC", () => {
    // 31 Aug 21:00 UTC is 1 Sep 01:00 in Dubai, so the cap has already reset.
    expect(monthStart(new Date("2026-08-31T21:00:00Z")).toISOString()).toBe("2026-08-31T20:00:00.000Z");
    expect(monthStart(new Date("2026-08-30T21:00:00Z")).toISOString()).toBe("2026-07-31T20:00:00.000Z");
  });
});
