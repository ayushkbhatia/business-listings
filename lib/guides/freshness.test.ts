import { describe, expect, it } from "vitest";
import { freshness } from "./freshness";

/**
 * Board 10b criterion 6, and board 6d's rule that overdue does not unpublish.
 *
 * The public index and the admin queue read this same function, so a guide the
 * queue calls overdue is a guide the page says is overdue. The alternative — an
 * admin queue quietly flagging an article whose own page presents as current —
 * is the version of the rule that is not defensible.
 */
const NOW = new Date("2026-09-06T00:00:00.000Z");

describe("freshness", () => {
  it("is never overdue without a cadence, however old", () => {
    // An article about how to write a good RFQ makes no claim about the world.
    const old = freshness(
      {
        publishedAt: new Date("2019-01-01T00:00:00.000Z"),
        regulatoryCheckedAt: new Date("2019-01-01T00:00:00.000Z"),
        reviewCadenceMonths: null,
      },
      NOW,
    );
    expect(old.overdue).toBe(false);
    expect(old.dueAt).toBeNull();
    // The date still renders. Not overdue is not the same as not dated.
    expect(old.checkedAt).toEqual(new Date("2019-01-01T00:00:00.000Z"));
  });

  it("measures a never-checked article from publication, not from nothing", () => {
    // Treating "never checked" as infinitely overdue would put every new
    // article in the queue the moment it published.
    const fresh = freshness(
      {
        publishedAt: new Date("2026-08-01T00:00:00.000Z"),
        regulatoryCheckedAt: null,
        reviewCadenceMonths: 6,
      },
      NOW,
    );
    expect(fresh.overdue).toBe(false);
    expect(fresh.dueAt).toEqual(new Date("2027-02-01T00:00:00.000Z"));
    // And the reader is told nobody has re-checked it, rather than shown the
    // publication date as if it were a check.
    expect(fresh.checkedAt).toBeNull();
  });

  it("goes overdue on the day it falls due, not the day after", () => {
    const due = freshness(
      {
        publishedAt: new Date("2025-01-01T00:00:00.000Z"),
        regulatoryCheckedAt: new Date("2026-03-06T00:00:00.000Z"),
        reviewCadenceMonths: 6,
      },
      NOW,
    );
    expect(due.dueAt).toEqual(new Date("2026-09-06T00:00:00.000Z"));
    expect(due.overdue).toBe(true);
  });

  it("does not roll a month-end check into the following month", () => {
    // `setMonth` turns 31 August plus six months into 3 March, because
    // February has no 31st — and the article would read as three days less
    // overdue than it is.
    const endOfMonth = freshness(
      {
        publishedAt: null,
        regulatoryCheckedAt: new Date("2025-08-31T00:00:00.000Z"),
        reviewCadenceMonths: 6,
      },
      NOW,
    );
    expect(endOfMonth.dueAt).toEqual(new Date("2026-02-28T00:00:00.000Z"));
  });

  it("survives an article with no dates at all", () => {
    const nothing = freshness(
      { publishedAt: null, regulatoryCheckedAt: null, reviewCadenceMonths: 6 },
      NOW,
    );
    expect(nothing.overdue).toBe(false);
    expect(nothing.dueAt).toBeNull();
  });
});
