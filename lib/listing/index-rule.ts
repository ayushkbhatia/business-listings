import type { Prisma } from "@/lib/db/generated/client";
import { licenceExpired } from "@/lib/verification";

/**
 * Which unclaimed listings a search engine is asked to index — board 10g Q4,
 * and the owner's answer of 1 Oct 2026.
 *
 * About 30,000 pages, the largest page class on the site and most of what a
 * crawler sees, and until this it had no rule: every one was `index` and every
 * one was in the sitemap, lapsed or not. 6a's warning applies here more than
 * anywhere — a template that renders well with real supply behind it and badly
 * with thin supply behind it gets the whole domain read as doorway pages.
 *
 * An unclaimed listing is indexed while its licence is current and no `closed`
 * report about it is open. Lapsed, or reported closed and not yet decided by
 * 4h, it is `noindex` and out of the sitemap; a removed listing has no page to
 * index at all. Categorised is the handoff's third condition and needs no
 * test here: `primaryCategoryId` is NOT NULL, and the importer holds back a
 * record it could not categorise (`12a` B3).
 *
 * The accepted cost: anybody can file a `closed` report without an account, so
 * one report takes a page out of the index for up to the 72 hours `closed`
 * reports are answered in. The page itself is unchanged for a reader.
 *
 * Claimed listings are not this rule's business and stay as they were.
 *
 * Two forms of one rule — a predicate for the page's own metadata and a
 * `where` for the sitemap — and `tests/integration/unclaimed-listing.test.ts`
 * holds them equal as sets, the way 6a's sitemap test does.
 */

export interface IndexFacts {
  licenceExpiry: Date;
  /** A `closed` report on this listing with no outcome yet. */
  closedReportOpen: boolean;
}

export function unclaimedIndexable(facts: IndexFacts, now: Date): boolean {
  return !licenceExpired(facts.licenceExpiry, now) && !facts.closedReportOpen;
}

/** A report saying the business has closed, not yet decided. */
export const OPEN_CLOSED_REPORT = {
  kind: "closed",
  outcome: null,
} as const satisfies Prisma.SupplierReportWhereInput;

/**
 * The rule as a `where` over published listings: claimed ones, and unclaimed
 * ones the predicate above would index. `licenceExpired` is `expiry < now`, so
 * "current" is `expiry >= now` and the two forms agree on the boundary too.
 */
export function indexableListingWhere(now: Date): Prisma.BusinessWhereInput {
  return {
    OR: [
      { claimStatus: "claimed" },
      { licenceExpiry: { gte: now }, reports: { none: OPEN_CLOSED_REPORT } },
    ],
  };
}
