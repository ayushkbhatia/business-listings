import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/client";
import { STRONG_ENOUGH } from "./profile-strength";

/**
 * "Listings above 80% get 2.4× more enquiries."
 *
 * CLAUDE.md's interface honesty section: **every number is a query**. This is
 * that query, and the more important half of this module is what it does when it
 * cannot answer.
 *
 * The comparison: median enquiries per listing-month for listings at or above
 * the strength threshold against those below it, over a ninety-day window, with
 * a floor of forty listings on each side. A ratio computed from nine listings
 * and four is noise wearing a decimal point, and a cold-start directory has
 * exactly that.
 *
 * **At launch this returns null**, and board 2c says plainly what happens then:
 * the callout is *replaced*, not blanked, with the mechanism instead of the
 * outcome — "Buyers filter on photos and specs. A listing with neither is
 * invisible to those filters." That is true on day one because it describes the
 * filter behaviour on `1c` rather than a measured result. The measured line
 * arrives when the query does. Neither is ever a placeholder for the other.
 *
 * Same category is deliberately *not* a condition. It reads as more rigorous and
 * is worse: cutting by category multiplies the cohort floor by the number of
 * trades, so the answer never arrives. Whole-directory is the honest comparison
 * this data can support, and the sentence claims no more than that.
 */

/** Forty a side. Below it the ratio is noise. */
export const COHORT_MINIMUM = 40;
const WINDOW_DAYS = 90;
const HOUR_S = 3600;

export interface EnquiryLift {
  /** `2.4` in "2.4× more enquiries". Rounded to one decimal. */
  multiple: number;
  strongListings: number;
  weakListings: number;
  windowDays: number;
  threshold: number;
}

async function readEnquiryLift(now: Date = new Date()): Promise<EnquiryLift | null> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  /*
     Every published listing that existed for the whole window, with what it
     received in it. A listing published halfway through the window would drag
     the side it lands on down for a reason that has nothing to do with its
     profile.
  */
  const listings = await prisma.business.findMany({
    where: {
      suspendedAt: null,
      publishedAt: { not: null, lte: since },
      claimStatus: "claimed",
      profileStrength: { not: null },
    },
    select: {
      profileStrength: true,
      _count: { select: { recipients: { where: { createdAt: { gte: since } } } } },
    },
  });

  const strong: number[] = [];
  const weak: number[] = [];
  for (const listing of listings) {
    const perMonth = (listing._count.recipients * 30) / WINDOW_DAYS;
    ((listing.profileStrength ?? 0) >= STRONG_ENOUGH ? strong : weak).push(perMonth);
  }

  if (strong.length < COHORT_MINIMUM || weak.length < COHORT_MINIMUM) return null;

  const strongMedian = median(strong);
  const weakMedian = median(weak);

  /*
     A zero on the weaker side is not an infinite lift, it is a directory too
     young to have an answer. Reporting one would put "∞× more enquiries" on a
     seller's screen, which is the most obviously false thing this page could
     say.
  */
  if (weakMedian <= 0) return null;

  const multiple = Math.round((strongMedian / weakMedian) * 10) / 10;
  // A lift below 1.1 is not a lever, and rounding could even produce one below
  // 1 — a true finding, and not one this callout is shaped to say.
  if (multiple < 1.1) return null;

  return {
    multiple,
    strongListings: strong.length,
    weakListings: weak.length,
    windowDays: WINDOW_DAYS,
    threshold: STRONG_ENOUGH,
  };
}

/** The middle value, averaging the two middles on an even count. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

export { readEnquiryLift };

/**
 * An hour's cache. The figure moves on the timescale of a quarter, and this is
 * a full scan of the published set behind a screen a seller reloads while
 * writing a description.
 */
export const getEnquiryLift = unstable_cache(readEnquiryLift, ["enquiry-lift-cohort"], {
  revalidate: HOUR_S,
});
