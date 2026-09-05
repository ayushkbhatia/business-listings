import "server-only";
import { prisma } from "@/lib/db/client";
import { openNow } from "@/lib/trade/open-now";
import { readRamadanCalendar } from "@/lib/trade/ramadan-calendar";
import type { RamadanHours, WeekHours } from "@/lib/trade/hours";
import { median } from "@/lib/metrics/response-time";
import { VERIFIED_TIER } from "@/lib/verification";
import { supplyWhere, type LandingScope } from "./scope";

/**
 * Board 6a §3 — the stat line under the H1, and §4's ranking caption.
 *
 * Four facts:
 *
 *   listing count · verified-licence count · open-now count · UPDATED {date}
 *
 * Three are counted here. The date comes from `freshness.ts`, because it is a
 * claim about content rather than about supply.
 *
 * ## "41 open now", and the working week
 *
 * The handoff flags this: *"`open now` in the hero stat line reads the working
 * week, and `3d` owns it and has not been built. This is the third surface in a
 * row to need it after `7d` and `7e`. Use `2d`'s onboarding value, or drop the
 * stat — do not compute a fourth copy of the working week here."*
 *
 * So this computes no working week. `Location.hours` is where board 2d's
 * onboarding step writes one, and `lib/trade/open-now.ts` is the single
 * function that reads it — the same one board 1d's storefront and board 1f's
 * branch rows call, evaluating in Asia/Dubai regardless of where the page is
 * rendered and honouring the Ramadan override. This is the third caller of that
 * function, not a fourth copy of the rule.
 *
 * ## When the stat does not render
 *
 * `openNow` answers `unknown` for a branch with no hours on file, and absent
 * data is not evidence of a shut door. A scope where nobody has filled hours in
 * yields `null` here and the stat comes off the line entirely — it does not
 * render "0 open now", which would be a claim against every supplier on the
 * page, and it does not render "unknown", which is a word taking the place of a
 * fact.
 */

export interface LandingStats {
  listings: number;
  verified: number;
  /**
   * How many suppliers in scope have at least one branch open right now.
   *
   * Null when nobody in scope has hours on file — the stat is dropped, never
   * shown as nought.
   */
  openNow: number | null;
  /** How many of the listings the open-now count could be computed from. */
  openNowMeasurable: number;
  /**
   * The median of the per-business medians, for the intro's live token.
   *
   * Not a mean and not across every enquiry: one supplier answering 400 would
   * otherwise be the whole number.
   */
  replyMedianMs: number | null;
  replyMeasurable: number;
  /** Claimed listings, and the unclaimed remainder the rail card names. */
  unclaimed: number;
}

export async function landingStats(
  scope: LandingScope,
  now = new Date(),
): Promise<LandingStats> {
  const where = supplyWhere(scope);

  const [listings, verified, unclaimed, replies, businesses, calendar] = await Promise.all([
    prisma.business.count({ where }),
    prisma.business.count({ where: { ...where, verificationTier: { gte: VERIFIED_TIER } } }),
    /*
       The rail card's second number. Board 6a's corrections note is explicit
       about what it may then say: unclaimed listings rank last, claiming enters
       the ranking, verification is what lifts it. Never "claim it and you will
       appear above them".
    */
    prisma.business.count({ where: { ...where, claimStatus: "unclaimed" } }),
    prisma.business.findMany({
      where: { ...where, responseTimeMedianMs: { not: null } },
      select: { responseTimeMedianMs: true },
    }),
    prisma.business.findMany({
      where,
      select: {
        id: true,
        locations: {
          where: scope.area
            ? { areaId: scope.area.id, published: true }
            : { emirate: scope.emirate, published: true },
          select: { hours: true, ramadanHours: true },
        },
      },
    }),
    /*
       One settings row for the page rather than one per branch. The same
       calendar every storefront reads — board 2d criterion 15: Ramadan moves
       yearly and 41,000 sellers will not update it.
    */
    readRamadanCalendar(),
  ]);

  let measurable = 0;
  let open = 0;
  for (const business of businesses) {
    let known = false;
    let isOpen = false;
    for (const location of business.locations) {
      const state = openNow(
        location.hours as WeekHours,
        location.ramadanHours as RamadanHours | null,
        now,
        calendar,
      );
      if (state.state === "unknown") continue;
      known = true;
      if (state.state === "open") isOpen = true;
    }
    if (!known) continue;
    measurable += 1;
    if (isOpen) open += 1;
  }

  return {
    listings,
    verified,
    openNow: measurable === 0 ? null : open,
    openNowMeasurable: measurable,
    replyMedianMs: median(replies.map((row) => row.responseTimeMedianMs as number)),
    replyMeasurable: replies.length,
    unclaimed,
  };
}
