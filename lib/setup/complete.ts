import "server-only";
import { prisma } from "@/lib/db/client";
import { liveWeights } from "@/lib/search/settings";
import { WEIGHT_KEYS, type RankingWeights } from "@/lib/search/ranking";
import { readBaseline, specFacetCount } from "./baseline";

/**
 * Board 8e — everything the completion screen asserts, and where each figure
 * comes from.
 *
 * The screen has no inputs. Almost all of its specification is about **what
 * each number is actually reading**, because every one of them is a claim made
 * to a seller who has just finished forty minutes of work and is entitled to
 * believe it.
 *
 * Nothing is computed on the screen and nothing is computed here that another
 * module already owns: the score is `Business.profileStrength`, the weights are
 * `liveWeights()`, the counts are counts. This module's whole job is to fetch
 * them together and refuse to return the ones it cannot stand behind.
 *
 * ## Every clause drops independently
 *
 * §2 and §5 set the pattern with the baseline — "if that snapshot is missing,
 * drop the clause rather than guess" — and it is applied to all four
 * comparisons. A missing baseline drops the rise, a missing facet baseline
 * drops the callout, an unmeasured score drops the meter's subtitle. None of
 * them substitutes a zero, because a zero is a number and the seller will read
 * it as one.
 */

/** A tick line under the meter. Real counts, never the threshold that was met. */
export interface DoneTick {
  key: "photos" | "products" | "team";
  /** The measured figure the line states. */
  count: number;
  /** Photos only: whether a cover is set, which the line names separately. */
  cover?: boolean;
}

/** One bar in the ranking card. */
export interface RankingFactor {
  key: (typeof WEIGHT_KEYS)[number];
  weight: number;
  /**
   * Did this session move it?
   *
   * §4: mark only what changed. Verification and spec completeness are marked
   * because the licence and the products moved them; relevance is never marked
   * because it is query-dependent and nothing the seller did changes it.
   */
  moved: boolean;
  /**
   * The one the seller still controls from here.
   *
   * Response time, and it is called out rather than merely unmarked, because it
   * is the argument for the routing they set on board 8d.
   */
  open: boolean;
}

export interface SetupCompletion {
  businessId: string;
  slug: string;
  /** The score, computed live by the caller — never the cached column. */
  score: number;
  /**
   * The score when the hub was first opened, **only where it actually rose**.
   *
   * Null drops the "up from" clause entirely. Two ways to get null and both
   * matter: no snapshot at all — §2 says drop the clause rather than guess a
   * baseline — and a snapshot the score has not risen above, because "up from
   * 70%" over 60% is a fall told in a sentence that promises a rise.
   */
  baselineScore: number | null;
  /**
   * Is the score a full hundred?
   *
   * It gates the meter's "every setup task complete" subtitle, and §5's fifth
   * row is why that needs its own flag rather than being assumed from the three
   * ticks: a seat removed after completing leaves all three closed over a score
   * of 96. The screen then shows the real number and drops the clause. Printing
   * 100 there would be the one lie this screen cannot tell.
   *
   * Only the score is checked here. That the tasks are closed is the route's
   * precondition — anything open and it 302s — so this module is not the place
   * to restate it.
   */
  fullScore: boolean;
  ticks: DoneTick[];
  /**
   * Distinct spec filters gained since the baseline. Null hides the callout —
   * §6 is explicit that a total must not stand in for a delta.
   */
  specFilterGain: number | null;
  factors: RankingFactor[];
  /** Hours from first hub view to completion. §7's one number worth watching. */
  hoursToComplete: number | null;
}

/**
 * Which factors this session moved.
 *
 * Fixed rather than computed, and that is a deliberate limit. Working out
 * whether verification actually rose would need a before-and-after of the tier,
 * which nothing stores — and the two named here are the two the three setup
 * tasks demonstrably feed: products raise spec completeness directly, and the
 * licence check that gates a live listing is what put verification where it is.
 *
 * Relevance is excluded on §4's instruction. Distance and plan are excluded
 * because nothing in setup touches either.
 */
const MOVED: ReadonlySet<string> = new Set(["verificationTier", "specCompleteness"]);

/** The factor the seller can still change, and the reason 8d's routing matters. */
const STILL_OPEN = "responseTime";

/**
 * @param liveScore the score the hub computed on this same request.
 *
 * Handed in rather than read from `Business.profileStrength`, and the
 * difference is not academic: the hub computes the score live from
 * `profileStrength(facts)`, while the column is a cache that `strength-job.ts`
 * refreshes on a schedule. A seller who finishes the last task and lands here a
 * second later is looking at a column that predates their work.
 *
 * The first run of this screen showed "60%" under "Up from 70% this morning" —
 * a fall, printed in a sentence whose whole grammar promises a rise, because
 * the two figures came from two places. One source, passed down from the caller
 * that already paid for it.
 */
export async function setupCompletion(
  businessId: string,
  liveScore: number,
): Promise<SetupCompletion | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, slug: true },
  });
  if (!business) return null;

  const [media, products, seats, baseline, weights, facetsNow] = await Promise.all([
    prisma.media.findMany({
      where: { businessId, reviewId: null },
      select: { kind: true },
    }),
    /*
       Live, not every row. §2 asks for "products indexed on their own pages",
       and a draft has no page — counting drafts would put a number here that
       the storefront contradicts one click later.
    */
    prisma.product.count({ where: { businessId, status: "live" } }),
    /*
       **Active seats, not invitations sent.** §2 calls this the trap on the
       screen, and it is: board 8d completes its task the moment an invitation
       goes, while the score's team component wants somebody actually seated. A
       seller who invited two people and had neither accept is at three ticks
       and not at a hundred, so a line counting invitations would contradict the
       meter three lines above it.
    */
    prisma.user.count({ where: { businessId } }),
    readBaseline(businessId),
    liveWeights(),
    specFacetCount(businessId).catch(() => null),
  ]);

  const photos = media.filter((item) => item.kind !== "logo" && item.kind !== "cover").length;
  const hasCover = media.some((item) => item.kind === "cover");

  return {
    businessId: business.id,
    slug: business.slug,
    score: liveScore,
    baselineScore: roseFrom(baseline?.baselineScore ?? null, liveScore),
    fullScore: liveScore === 100,
    ticks: [
      { key: "photos", count: photos, cover: hasCover },
      { key: "products", count: products },
      { key: "team", count: seats },
    ],
    specFilterGain: gainOf(facetsNow, baseline?.baselineFacets ?? null),
    factors: factorsFrom(weights),
    hoursToComplete: hoursBetween(baseline?.firstSeenAt ?? null, baseline?.completedAt ?? null),
  };
}

/**
 * The baseline, but only when the score actually went up.
 *
 * Equal is dropped as well as lower. "Up from 70%" over 70% is not a lie so
 * much as an empty sentence, and a completion screen has no room for one.
 */
function roseFrom(baseline: number | null, now: number): number | null {
  if (baseline === null) return null;
  return now > baseline ? baseline : null;
}

/**
 * The delta, or nothing.
 *
 * Null whenever either side is missing, and null again when the gain is zero or
 * negative. §5: hide the callout rather than render "0 spec filters" — a seller
 * told they gained nothing has been shown a sentence whose whole grammar
 * promises they gained something.
 *
 * Negative is possible and is not an error: a seller who unpublished a product
 * between the two reads has fewer filters than they started with. It is still
 * not a sentence this screen can say, so it hides.
 */
function gainOf(now: number | null, before: number | null): number | null {
  if (now === null || before === null) return null;
  const gain = now - before;
  return gain > 0 ? gain : null;
}

/**
 * The six bars, read from the same config search ranks by.
 *
 * §4 is explicit: "read the weights from the same config as search. They are
 * editable in admin; hardcoding them here guarantees drift the day someone
 * tunes ranking." `liveWeights()` is that config, falling back to
 * `DEFAULT_WEIGHTS` when the row is absent — so this screen and the results
 * page cannot disagree about what a factor is worth.
 *
 * Ordered by weight, descending, because the card's argument is which factors
 * matter most and a fixed order would stop being that the first time somebody
 * retunes them.
 */
function factorsFrom(weights: RankingWeights): RankingFactor[] {
  return WEIGHT_KEYS.map((key) => ({
    key,
    weight: weights[key],
    moved: MOVED.has(key),
    open: key === STILL_OPEN,
  })).sort((a, b) => b.weight - a.weight);
}

/** Whole hours, floored, for the funnel. Null unless both ends are known. */
function hoursBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null;
  const ms = to.getTime() - from.getTime();
  return ms >= 0 ? Math.floor(ms / 3_600_000) : null;
}
