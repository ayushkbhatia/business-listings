import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  REVIEWS_PAGE_SIZE,
  REVIEW_FILTERS,
  getBusinessBySlug,
  getReviewBoard,
  isReviewFiltered,
  parseReviewQuery,
  reviewCounts,
  toReviewParams,
  type ReviewFilter,
  type ReviewQuery,
} from "@/lib/db/queries";
import { CRITICAL_AT_OR_BELOW, provenanceOf } from "@/lib/reviews/eligibility";

/**
 * Board 1m's data requirements, against the seeded database.
 *
 * The page's argument is that its numbers are true, so the numbers are what is
 * asserted here: every count is a query, every query excludes removed and held
 * rows, and the figure in the sub-line is the same figure as the chip beside it.
 *
 * `al-waha-industrial-supplies` is the fixture — the one seller with a review
 * history deep enough to page, filter and sort.
 */
const SLUG = "al-waha-industrial-supplies";

let businessId: string;

const query = (over: Partial<ReviewQuery> = {}): ReviewQuery => ({
  filter: "all",
  sort: "recent",
  page: 1,
  ...over,
});

beforeAll(async () => {
  const business = await getBusinessBySlug(SLUG);
  if (!business) throw new Error(`the board 1m fixture ${SLUG} is not in this seed`);
  businessId = business.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("criterion 2 — one figure, one label", () => {
  it("counts the accepted rung once, and the sub-line and the chip read it", async () => {
    const board = await getReviewBoard(businessId, query());
    const counts = await reviewCounts(businessId);

    // The sub-line says "N reviews · M from accepted quotes"; the chip says
    // "Accepted quote M". Two renderings of one query, never two queries.
    expect(board.counts).toEqual(counts);
    expect(board.counts.all).toBe(board.summary.count);
    expect(board.counts.accepted).toBeGreaterThan(0);
    expect(board.counts.accepted).toBeLessThan(board.counts.all);
  });

  it("derives each row's rung from the same fact the chip counts", async () => {
    const board = await getReviewBoard(businessId, query({ filter: "accepted", page: 3 }));
    expect(board.reviews.length).toBe(board.counts.accepted);
    for (const review of board.reviews) {
      expect(provenanceOf(review)).toBe("accepted_quote");
    }
  });

  it("puts everything else on the enquiry rung — there is no third", async () => {
    const board = await getReviewBoard(businessId, query({ page: 4 }));
    const rungs = new Set(board.reviews.map((review) => provenanceOf(review)));
    expect([...rungs].sort()).toEqual(["accepted_quote", "verified_enquiry"]);
  });
});

describe("criterion 6 — removed and held are out of every figure", () => {
  it("excludes them from the count, the average and the distribution", async () => {
    const board = await getReviewBoard(businessId, query());

    const publishedRows = await prisma.review.count({
      where: { businessId, removedAt: null, heldAt: null },
    });
    const everything = await prisma.review.count({ where: { businessId } });

    expect(board.summary.count).toBe(publishedRows);
    expect(everything).toBeGreaterThan(publishedRows);

    const distributed = board.summary.distribution.reduce((sum, row) => sum + row.count, 0);
    expect(distributed).toBe(board.summary.count);

    const average =
      board.summary.distribution.reduce((sum, row) => sum + row.rating * row.count, 0) /
      board.summary.count;
    expect(board.summary.average).toBeCloseTo(average, 6);
  });

  it("shadows the stored rating column with the measured one", async () => {
    // `Business.ratingOverall` is written by a job. A public read that trusted
    // it would print an average the list below it disagrees with, in the same
    // request, the moment a review is held.
    const business = await getBusinessBySlug(SLUG);
    const board = await getReviewBoard(businessId, query());
    expect(business?.ratingOverall).toBeCloseTo(board.summary.average ?? 0, 6);
    expect(business?._count.reviews).toBe(board.summary.count);
  });

  it("counts held rows inside the current filter, not across the page", async () => {
    /*
     * The held line explains a gap between the count above the list and the
     * rows in it. Under a filter the held review is not in, there is no gap to
     * explain and the line would be accounting for a row that is not there.
     */
    const held = await prisma.review.findFirst({
      where: { businessId, heldAt: { not: null } },
      select: { id: true, overall: true, media: { select: { id: true } } },
    });
    expect(held, "the seed carries one held review").toBeTruthy();
    if (!held) return;

    const critical = await getReviewBoard(businessId, query({ filter: "critical" }));
    const photos = await getReviewBoard(businessId, query({ filter: "photos" }));

    expect(held.overall).toBeLessThanOrEqual(CRITICAL_AT_OR_BELOW);
    expect(held.media).toHaveLength(0);
    expect(critical.heldCount).toBe(1);
    expect(photos.heldCount).toBe(0);
  });
});

describe("criterion 9 — the Critical filter is always there", () => {
  it("counts every rung at or below three, and never disappears", async () => {
    const counts = await reviewCounts(businessId);
    const expected = await prisma.review.count({
      where: { businessId, removedAt: null, heldAt: null, overall: { lte: CRITICAL_AT_OR_BELOW } },
    });
    expect(counts.critical).toBe(expected);
    // Board 1m: a visible zero is more credible than a missing control, so the
    // count is a number rather than an optional.
    expect(typeof counts.critical).toBe("number");
  });

  it("returns exactly the rows the chip counted, for every chip", async () => {
    const counts = await reviewCounts(businessId);
    for (const filter of REVIEW_FILTERS) {
      const board = await getReviewBoard(businessId, query({ filter, page: 10 }));
      expect(board.total, filter).toBe(counts[filter as ReviewFilter]);
      expect(board.reviews.length, filter).toBe(counts[filter as ReviewFilter]);
    }
  });
});

describe("criterion 11 — the page size and the label are one decision", () => {
  it("returns a page at a time, cumulatively", async () => {
    const first = await getReviewBoard(businessId, query());
    const second = await getReviewBoard(businessId, query({ page: 2 }));

    expect(first.reviews).toHaveLength(REVIEWS_PAGE_SIZE);
    expect(second.reviews).toHaveLength(REVIEWS_PAGE_SIZE * 2);
    // Page two is page one plus ten, in the same order. A "Load more" that
    // reshuffles what is already on screen is a different control.
    expect(second.reviews.slice(0, REVIEWS_PAGE_SIZE).map((row) => row.id)).toEqual(
      first.reviews.map((row) => row.id),
    );
  });

  it("stops at the total rather than running past it", async () => {
    const board = await getReviewBoard(businessId, query({ page: 99 }));
    expect(board.reviews).toHaveLength(board.total);
  });
});

describe("the four sorts", () => {
  it("orders by date, by rating both ways, and by how much was written", async () => {
    const recent = await getReviewBoard(businessId, query({ sort: "recent" }));
    const highest = await getReviewBoard(businessId, query({ sort: "highest" }));
    const lowest = await getReviewBoard(businessId, query({ sort: "lowest" }));
    const detailed = await getReviewBoard(businessId, query({ sort: "detailed" }));

    const monotonic = <T>(rows: T[], read: (row: T) => number, direction: 1 | -1) =>
      rows.every((row, index) =>
        index === 0 ? true : direction * (read(row) - read(rows[index - 1]!)) <= 0,
      );

    expect(monotonic(recent.reviews, (r) => r.createdAt.getTime(), 1)).toBe(true);
    expect(monotonic(highest.reviews, (r) => r.overall, 1)).toBe(true);
    expect(monotonic(lowest.reviews, (r) => r.overall, -1)).toBe(true);
    expect(monotonic(detailed.reviews, (r) => r.body.length, 1)).toBe(true);
  });

  it("pages a sort the database owns without repeating a row", async () => {
    // `length(body)` has no Prisma expression, so this sort is ordered in SQL.
    // Ties break on createdAt so two clicks of "Load more" cannot show one
    // review twice.
    const board = await getReviewBoard(businessId, query({ sort: "detailed", page: 4 }));
    const ids = board.reviews.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the query string", () => {
  it("falls back to the canonical view rather than throwing on nonsense", async () => {
    expect(parseReviewQuery({ show: "everything", sort: "cheapest", page: "-3" })).toEqual({
      filter: "all",
      sort: "recent",
      page: 1,
    });
  });

  it("round-trips, and writes nothing for the canonical view", () => {
    expect(toReviewParams(query())).toBe("");
    expect(isReviewFiltered(query())).toBe(false);

    const narrowed = query({ filter: "critical", sort: "lowest", page: 3 });
    const round = parseReviewQuery(
      Object.fromEntries(new URLSearchParams(toReviewParams(narrowed))),
    );
    expect(round).toEqual(narrowed);
    expect(isReviewFiltered(narrowed)).toBe(true);
  });

  it("resets the page when the filter or the sort changes", () => {
    // Otherwise a buyer on page four of "All" lands on page four of "Critical",
    // which has seven rows.
    expect(toReviewParams(query({ page: 4 }), { filter: "critical", page: 1 })).toBe(
      "show=critical",
    );
  });
});
