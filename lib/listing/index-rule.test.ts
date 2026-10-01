import { describe, expect, it } from "vitest";
import { indexableListingWhere, OPEN_CLOSED_REPORT, unclaimedIndexable } from "./index-rule";

const NOW = new Date("2026-10-01T09:00:00+04:00");
const CURRENT = new Date("2027-01-31T00:00:00+04:00");
const LAPSED = new Date("2026-09-30T00:00:00+04:00");

describe("board 10g Q4 — which unclaimed pages are indexed", () => {
  it("indexes a current licence with no closed report open", () => {
    expect(unclaimedIndexable({ licenceExpiry: CURRENT, closedReportOpen: false }, NOW)).toBe(true);
  });

  it("does not index a lapsed licence", () => {
    expect(unclaimedIndexable({ licenceExpiry: LAPSED, closedReportOpen: false }, NOW)).toBe(false);
  });

  it("does not index a listing reported closed while 4h decides", () => {
    expect(unclaimedIndexable({ licenceExpiry: CURRENT, closedReportOpen: true }, NOW)).toBe(false);
  });

  it("puts the boundary where `licenceExpired` does", () => {
    expect(unclaimedIndexable({ licenceExpiry: NOW, closedReportOpen: false }, NOW)).toBe(true);
  });
});

describe("the sitemap's form of the same rule", () => {
  it("keeps every claimed listing and the unclaimed ones the predicate indexes", () => {
    expect(indexableListingWhere(NOW)).toEqual({
      OR: [
        { claimStatus: "claimed" },
        { licenceExpiry: { gte: NOW }, reports: { none: { kind: "closed", outcome: null } } },
      ],
    });
  });

  it("counts a report as open until it has an outcome, duplicates included", () => {
    // A duplicate is resolved with `outcome: "duplicate"`, so only an
    // undecided report holds the page out of the index.
    expect(OPEN_CLOSED_REPORT).toEqual({ kind: "closed", outcome: null });
  });
});
