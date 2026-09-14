import { describe, expect, it } from "vitest";
import { decidedReason, quoteFence, type QuoteFenceState } from "./fence";

/**
 * Board `7c`'s fence, as a rule rather than a screen.
 *
 * The defect was two lists — the lead screen's three read-only conditions and
 * the service's one — that claimed to be the same list. These pin the single
 * list both now read, and the order it answers in.
 */

const NOW = new Date("2026-09-14T09:00:00Z");
const LATER = new Date("2026-09-20T09:00:00Z");

const open: QuoteFenceState = {
  businessId: "b-me",
  contactReleasedToBusinessId: null,
  recipientState: "opened",
  outcome: null,
  suspended: false,
  closesAt: LATER,
};

describe("quoteFence", () => {
  it("lets an open enquiry be quoted", () => {
    expect(quoteFence(open, NOW)).toBeNull();
  });

  it("refuses once the buyer accepted another supplier — the defect", () => {
    expect(quoteFence({ ...open, contactReleasedToBusinessId: "b-other" }, NOW)).toBe("accepted_elsewhere");
  });

  it("refuses the winner too: the accepted quote is the last row written", () => {
    expect(quoteFence({ ...open, contactReleasedToBusinessId: "b-me" }, NOW)).toBe("accepted_yours");
  });

  it("refuses a declined recipient, a marked lead, a suspended listing and a closed enquiry", () => {
    expect(quoteFence({ ...open, recipientState: "declined" }, NOW)).toBe("declined");
    expect(quoteFence({ ...open, outcome: "lost" }, NOW)).toBe("marked");
    expect(quoteFence({ ...open, suspended: true }, NOW)).toBe("suspended");
    expect(quoteFence({ ...open, closesAt: NOW }, NOW)).toBe("closed");
  });

  it("says accepted before anything else, because it is the terminal state", () => {
    const everything: QuoteFenceState = {
      businessId: "b-me",
      contactReleasedToBusinessId: "b-other",
      recipientState: "declined",
      outcome: "lost",
      suspended: true,
      closesAt: NOW,
    };
    expect(quoteFence(everything, NOW)).toBe("accepted_elsewhere");
  });

  it("puts the listing ahead of the seller's own mark and the calendar", () => {
    expect(quoteFence({ ...open, suspended: true, outcome: "won", closesAt: NOW }, NOW)).toBe("suspended");
    expect(quoteFence({ ...open, outcome: "won", closesAt: NOW }, NOW)).toBe("marked");
  });

  it("treats the closing instant as closed, as the lead screen does", () => {
    expect(quoteFence({ ...open, closesAt: new Date(NOW.getTime() + 1) }, NOW)).toBeNull();
    expect(quoteFence({ ...open, closesAt: new Date(NOW.getTime()) }, NOW)).toBe("closed");
  });
});

describe("decidedReason", () => {
  it("ignores the calendar and the listing, which extending a window does not care about", () => {
    expect(decidedReason({ ...open })).toBeNull();
    expect(decidedReason({ ...open, contactReleasedToBusinessId: "b-other" })).toBe("accepted_elsewhere");
    expect(decidedReason({ ...open, recipientState: "declined" })).toBe("declined");
    expect(decidedReason({ ...open, outcome: "won" })).toBe("marked");
  });

  it("tells a supplier's own decline apart from the buyer's (board 3j-s)", () => {
    expect(decidedReason({ ...open, recipientState: "declined", declinedBySeller: true })).toBe("declined_by_you");
    expect(quoteFence({ ...open, recipientState: "declined", declinedBySeller: true }, NOW)).toBe("declined_by_you");
    // An acceptance still outranks it: the enquiry is, first of all, decided.
    expect(
      decidedReason({ ...open, recipientState: "declined", declinedBySeller: true, contactReleasedToBusinessId: "b-other" }),
    ).toBe("accepted_elsewhere");
  });
});
