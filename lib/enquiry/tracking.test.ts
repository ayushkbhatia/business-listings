import { describe, expect, it } from "vitest";
import {
  canAddRecipients,
  latencyMs,
  canNudge,
  compareBlockedBy,
  effectiveState,
  headerState,
  sortRecipients,
  type TrackedRecipient,
} from "./tracking";

/**
 * Board 1i's rules, where they are decisions rather than markup.
 *
 * The spec names the defect this page is most likely to ship with — "the badge,
 * the h1 and the row states must always agree" — so the header is derived from
 * the rows here and these pin that it cannot drift.
 */

const DELIVERED = new Date("2026-09-01T08:00:00.000Z");
const CLOSES = new Date("2026-09-08T08:00:00.000Z");
const NOW = new Date("2026-09-03T08:00:00.000Z");

function row(over: Partial<TrackedRecipient> = {}): TrackedRecipient {
  return {
    businessId: "b1",
    slug: "supplier-one",
    displayName: "Supplier One",
    state: "delivered",
    openedAt: null,
    buyerNudgedAt: null,
    deliveredAt: DELIVERED,
    quotedAt: null,
    quotedLines: 0,
    totalLines: 3,
    declineReason: null,
    superseded: false,
    quotedAgainstRevision: 1,
    ...over,
  };
}

describe("the header is read off the rows", () => {
  it("counts what was sent before anybody replies", () => {
    const rows = [row(), row({ businessId: "b2" }), row({ businessId: "b3" })];
    expect(headerState(rows, { accepted: false, closesAt: CLOSES, now: NOW })).toEqual({
      quoted: 0,
      sent: 3,
      mode: "sent",
    });
  });

  it("switches to counting quotes from the first one", () => {
    const rows = [
      row({ state: "quoted", quotedAt: NOW, quotedLines: 3 }),
      row({ businessId: "b2", state: "opened", openedAt: NOW }),
      row({ businessId: "b3" }),
    ];
    const header = headerState(rows, { accepted: false, closesAt: CLOSES, now: NOW });
    expect(header).toMatchObject({ quoted: 1, sent: 3, mode: "quoted" });
  });

  it("cannot disagree with the rows, because it is computed from them", () => {
    /*
       The defect the spec warns about. There is no separate counter to fall
       behind: change a row's state and the header changes with it.
    */
    const rows = [
      row({ state: "quoted", quotedAt: NOW }),
      row({ businessId: "b2", state: "quoted", quotedAt: NOW }),
    ];
    const before = headerState(rows, { accepted: false, closesAt: CLOSES, now: NOW });
    expect(before.quoted).toBe(2);

    const after = headerState([rows[0]!, row({ businessId: "b2", state: "declined" })], {
      accepted: false,
      closesAt: CLOSES,
      now: NOW,
    });
    expect(after.quoted).toBe(1);
  });

  it("calls it all-declined only when nobody quoted", () => {
    const allOut = [row({ state: "declined" }), row({ businessId: "b2", state: "declined" })];
    expect(headerState(allOut, { accepted: false, closesAt: CLOSES, now: NOW }).mode).toBe(
      "all_declined",
    );

    /*
       One quote alongside four declines is a page with something on it. Framing
       that as a failure would bury the reply the buyer is waiting for.
    */
    const oneIn = [row({ state: "quoted", quotedAt: NOW }), row({ businessId: "b2", state: "declined" })];
    expect(headerState(oneIn, { accepted: false, closesAt: CLOSES, now: NOW }).mode).toBe("quoted");
  });

  it("an accepted enquiry is a record, whatever the rows say", () => {
    const rows = [row({ state: "quoted", quotedAt: NOW })];
    expect(headerState(rows, { accepted: true, closesAt: CLOSES, now: NOW }).mode).toBe("accepted");
  });
});

describe("no_response never appears while the window is open", () => {
  it("reads as delivered or opened until closesAt", () => {
    /*
       Criterion 6, and the reason is fairness: a supplier with twelve hours
       left has not failed to respond, they have not responded yet.
    */
    const stale = row({ state: "no_response" });
    expect(effectiveState(stale, CLOSES, NOW)).toBe("delivered");
    expect(effectiveState({ ...stale, openedAt: NOW }, CLOSES, NOW)).toBe("opened");
  });

  it("becomes no_response once the window has closed", () => {
    const after = new Date(CLOSES.getTime() + 1000);
    expect(effectiveState(row(), CLOSES, after)).toBe("no_response");
    expect(effectiveState(row({ state: "opened", openedAt: NOW }), CLOSES, after)).toBe("no_response");
  });

  it("leaves a quote and a decline alone after closing", () => {
    // Closing the window does not invalidate what already came back.
    const after = new Date(CLOSES.getTime() + 1000);
    expect(effectiveState(row({ state: "quoted", quotedAt: NOW }), CLOSES, after)).toBe("quoted");
    expect(effectiveState(row({ state: "declined" }), CLOSES, after)).toBe("declined");
  });
});

describe("the order a buyer reads them in", () => {
  it("puts replies at the top, endings at the bottom", () => {
    const rows = [
      row({ businessId: "d", state: "declined", displayName: "Declined Co" }),
      row({ businessId: "a", state: "delivered", displayName: "Delivered Co" }),
      row({ businessId: "q", state: "quoted", quotedAt: NOW, displayName: "Quoted Co" }),
      row({ businessId: "o", state: "opened", openedAt: NOW, displayName: "Opened Co" }),
    ];
    expect(sortRecipients(rows).map((r) => r.businessId)).toEqual(["q", "o", "a", "d"]);
  });

  it("puts the fastest quote first, because that is what a buyer weighs", () => {
    const slow = row({ businessId: "slow", state: "quoted", quotedAt: new Date(DELIVERED.getTime() + 20 * 3_600_000) });
    const fast = row({ businessId: "fast", state: "quoted", quotedAt: new Date(DELIVERED.getTime() + 3_600_000) });
    expect(sortRecipients([slow, fast]).map((r) => r.businessId)).toEqual(["fast", "slow"]);
  });
});

describe("nudge is one per recipient, and not straight away", () => {
  it("waits twenty-four hours", () => {
    /*
       "A nudge sent an hour after delivery reads as impatience, and the median
       first reply is under two hours anyway."
    */
    const anHourLater = new Date(DELIVERED.getTime() + 3_600_000);
    expect(canNudge(row(), anHourLater)).toBe(false);
    expect(canNudge(row(), new Date(DELIVERED.getTime() + 24 * 3_600_000))).toBe(true);
  });

  it("is spent once used", () => {
    expect(canNudge(row({ buyerNudgedAt: NOW }), NOW)).toBe(false);
  });

  it("is only for a supplier who has not opened it", () => {
    // One who has opened it is already reading; one who declined has answered.
    expect(canNudge(row({ state: "opened", openedAt: NOW }), NOW)).toBe(false);
    expect(canNudge(row({ state: "declined" }), NOW)).toBe(false);
    expect(canNudge(row({ state: "quoted", quotedAt: NOW }), NOW)).toBe(false);
  });
});

describe("the two limits on the action row", () => {
  it("hides add-more at the cap rather than disabling it", () => {
    expect(canAddRecipients(7)).toBe(true);
    expect(canAddRecipients(8)).toBe(false);
  });

  it("refuses to call one quote a comparison, and says why", () => {
    const labels = { none: "none yet", one: "one more" };
    expect(compareBlockedBy(0, labels)).toBe("none yet");
    expect(compareBlockedBy(1, labels)).toBe("one more");
    expect(compareBlockedBy(2, labels)).toBeNull();
  });
});

describe("a latency the data got wrong", () => {
  it("floors at zero rather than throwing the page away", () => {
    /*
       A quote cannot precede its own delivery, but the data can say it did —
       a backfill, a clock skew, a fixture built in the wrong order. The
       formatter throws on a negative, and one odd row used to take the whole
       tracking page down with a 500: the last page that should break, since a
       buyer opens it to find out whether anybody replied.
    */
    const backwards = row({
      state: "quoted",
      deliveredAt: new Date("2026-09-03T00:00:00.000Z"),
      quotedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(latencyMs(backwards)).toBe(0);
  });
});
