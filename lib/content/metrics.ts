import "server-only";
import { prisma } from "@/lib/db/client";
import { areaMatrix } from "@/lib/content/matrix";

/**
 * Board 6f §3 — the five cards.
 *
 * Every number on the board's render was hardcoded, and two of them were the
 * same number used for two different conditions: "thin pages · under 60
 * listings" in a card and "142 pages with thin copy · under 250 words" in the
 * backlog. Thin supply and thin copy have different owners and different
 * remedies, so they are two counts here.
 *
 * Two of the five have no source in this product and say so rather than
 * inventing one. There is no analytics or Search Console import — no sessions
 * table, no rank column, nothing that could be summed into "organic sessions
 * vs prior month" without making it up. `value: null` renders as the grey "Not
 * recorded" the interface-honesty rules ask for, beside the reason. A card that
 * showed a plausible figure would be the most quietly damaging thing on a
 * screen whose only asset is that its numbers are true.
 */

export type MetricKey =
  | "pages_live"
  | "organic_sessions"
  | "organic_enquiry"
  | "below_floor"
  | "awaiting_copy";

export interface Metric {
  key: MetricKey;
  /** Null where nothing in this product measures it. Never a stand-in. */
  value: number | null;
  /** The comparison the board draws, where there is one. */
  delta: number | null;
  /** Why there is no number, when there is none. */
  absent?: "no_analytics";
}

export async function contentMetrics(now = new Date()): Promise<Metric[]> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [matrix, publishedThisMonth] = await Promise.all([
    areaMatrix({ perPage: Number.MAX_SAFE_INTEGER }, now),
    prisma.areaPage.count({ where: { firstPublishedAt: { gte: monthStart } } }),
  ]);

  return [
    { key: "pages_live", value: matrix.live, delta: publishedThisMonth },
    /*
       Board 6f's data table asks for "Sessions, rank | analytics + search
       console, imported | daily". No importer exists, no cron slot exists, and
       `SearchQueryLog` carries no area dimension, so there is nothing to read
       and nothing honest to derive.
    */
    { key: "organic_sessions", value: null, delta: null, absent: "no_analytics" },
    { key: "organic_enquiry", value: null, delta: null, absent: "no_analytics" },
    {
      key: "below_floor",
      // Below their need — not "unindexed". They were never generated: there is
      // no URL, no `noindex`, nothing in the sitemap and no crawl budget spent.
      value: matrix.rows.filter((row) => row.shortfall > 0).length,
      delta: null,
    },
    {
      key: "awaiting_copy",
      // The other condition, counted separately: supply is there and the page
      // is not written. A writer's afternoon, not a recruiter's quarter.
      value: matrix.rows.filter((row) => row.status === "queued_copy").length,
      delta: null,
    },
  ];
}
