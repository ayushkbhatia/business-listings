/**
 * Choosing who an enquiry goes to.
 *
 * Rule 4 of the engine: "Fan-out is capped and matched. 1–8 recipients, matched
 * on subcategory, emirate and stock signals. Free plan sellers get 3 RFQs a
 * month and then the recipient slot is skipped — the buyer never sees a capped
 * seller in their recipient list, because a seller who cannot reply is worse
 * than one fewer option."
 *
 * That last clause is the important one and it is why the cap is applied here,
 * during matching, rather than at delivery. A capped seller is not shown and
 * declined; they are never a candidate. The buyer gets five options instead of
 * six and is never told why, because it is not their problem.
 *
 * Pure. The query layer fetches candidates, this ranks and cuts.
 */

import { trustScore } from "@/lib/verification";

export const MIN_RECIPIENTS = 1;
export const MAX_RECIPIENTS = 8;

/**
 * What an unmeasured signal scores: the midpoint, never zero.
 *
 * The rule this file already applied to `speed` and applies nowhere else. A
 * seller with no reply history is unknown, not slow; a seller whose stock
 * nobody has counted is unknown, not empty; a seller whose working emirates we
 * never asked for is unknown, not far away. Scoring absence of evidence as
 * evidence of absence makes cold start permanent, and it charges the whole
 * penalty to the listings least able to argue with it.
 */
const UNMEASURED = 0.5;

/** The default the composer offers: "also send to N similar suppliers". */
export const DEFAULT_FANOUT = 5;

export interface FanoutCandidate {
  businessId: string;
  slug: string;
  displayName: string;
  /** Subcategory ids this business is listed under. */
  categoryIds: readonly string[];
  primaryCategoryId: string;
  /**
   * Every emirate this seller serves — their published branches and every
   * emirate they have claimed coverage in.
   *
   * Plural, and it used to be one string. `findFanoutCandidates` took the first
   * published location with `take: 1` and no `orderBy`, so for a supplier with
   * two branches the locality term was whichever row Postgres handed back —
   * a coin flip, re-flipped on every enquiry. And `BusinessCoverage`, whose own
   * schema comment says it is "what `1h` routes on today", was read by nothing:
   * a Sharjah depot that promises next-day Dubai scored as out-of-emirate on
   * every Dubai enquiry.
   *
   * Empty means we do not know where they work, which is not the same as
   * knowing they are elsewhere. See `locality` in `scoreCandidate`.
   */
  emirates: readonly string[];
  /** 0..4. Platform-owned. */
  verificationTier: number;
  /** Median enquiry-to-first-reply. Null when there is not enough to measure. */
  responseTimeMedianMs: number | null;
  /**
   * How many of the enquiry's lines this seller has something for.
   *
   * Null when nobody has matched the lines against a catalogue, which is the
   * only honest answer this layer can give today.
   */
  matchedLineCount: number | null;
  /**
   * Of those, how many are in stock rather than made to order.
   *
   * Null when unmeasured — and it is unmeasured for every candidate on every
   * enquiry, because no caller has ever filled it in. It was a hardcoded `0`,
   * which is not "we did not look": it is a measurement, and it says this
   * seller has nothing on the shelf. `stock` carries 0.2 of the score, so a
   * fifth of the vector multiplied a claim about the whole directory that
   * nobody had ever checked, and no supplier of any kind could rise above.
   */
  inStockLineCount: number | null;
  /** Null means unlimited. */
  enquiriesPerMonth: number | null;
  /** Recipient rows already created for this business this calendar month. */
  enquiriesThisMonth: number;
  /** A ranking nudge the plan buys. Never a trust signal. */
  rankingMultiplier: number;
}

export interface FanoutRequest {
  /** The subcategory the buyer chose, or the category if they did not. */
  categoryId: string;
  /**
   * That category and everything under it.
   *
   * A buyer who picks "Valves & fittings" means the gate-valve suppliers too —
   * `categoryIdsFor` has made search work that way since handoff 1, and the
   * fan-out did not: it matched `categoryId` exactly, so an RFQ to a sector
   * reached none of the suppliers filed under its children. Nothing showed it
   * until the seed had listings under a subcategory to miss.
   *
   * Downward only, deliberately. A buyer who picks "Gate valves" has been
   * specific, and widening that to every generalist valve seller is a different
   * decision from the one they made.
   */
  categoryIds: readonly string[];
  /** Where it is going. Same-emirate suppliers deliver sooner. */
  emirate: string | null;
  /** How many lines the enquiry has, for scoring coverage. */
  lineCount: number;
  /** 1..8. The composer's slider. */
  want: number;
  /** Always included, whatever the ranking says. The storefront the buyer was on. */
  pinned?: readonly string[];
}

export type SkipReason = "at_monthly_cap";

export interface FanoutResult {
  recipients: FanoutCandidate[];
  /**
   * Who was left out for a reason worth recording. Not shown to the buyer —
   * this is for the seller's own "you missed N enquiries this month" nudge and
   * for answering a support question later.
   */
  skipped: { businessId: string; reason: SkipReason }[];
}

/** True when this seller's plan has no room left this month. */
export function atMonthlyCap(
  /*
     The two fields it reads, not the whole candidate.

     Board 6b's RFQ card has to name the eight recipients `1h` would actually
     accept, and it holds list members rather than shaped candidates. Widening
     the parameter to what the function uses lets that page ask this question
     instead of re-deriving it — and a second definition of "at cap" is a second
     thing to keep in step with the plan column.
  */
  candidate: Pick<FanoutCandidate, "enquiriesPerMonth" | "enquiriesThisMonth">,
): boolean {
  return (
    candidate.enquiriesPerMonth !== null &&
    candidate.enquiriesThisMonth >= candidate.enquiriesPerMonth
  );
}

/**
 * Score a candidate against the request. 0..1.
 *
 * Deliberately not the search ranking in lib/search/ranking.ts. Search answers
 * "who should this buyer look at", weighted for relevance and browsing. This
 * answers "who can actually answer this today", so coverage and stock carry
 * most of it and the plan carries almost none — a paid plan should not put a
 * supplier in front of an enquiry they cannot fill.
 */
export function scoreCandidate(candidate: FanoutCandidate, request: FanoutRequest): number {
  const lines = Math.max(1, request.lineCount);

  // Can they answer it at all? The largest term by far.
  const coverage =
    candidate.matchedLineCount === null
      ? UNMEASURED
      : Math.min(1, candidate.matchedLineCount / lines);
  const stock =
    candidate.inStockLineCount === null
      ? UNMEASURED
      : Math.min(1, candidate.inStockLineCount / lines);

  /*
     Exactly what was asked for scores highest; a subcategory of it is close
     behind, because that seller sells precisely this and nothing broader; a
     seller merely listed under it as a secondary trade is behind both.
  */
  const requested = new Set(request.categoryIds);
  const category =
    candidate.primaryCategoryId === request.categoryId
      ? 1
      : requested.has(candidate.primaryCategoryId)
        ? 0.85
        : candidate.categoryIds.some((id) => requested.has(id))
          ? 0.7
          : 0;

  /*
     Same emirate is a real delivery difference in the UAE, not a nicety.

     Any emirate they serve, not the first branch row that happened to load.
     A supplier's coverage rows are the promise a buyer reads on their
     storefront, so scoring them out of an emirate they have publicly said they
     deliver to contradicts their own listing.

     Three outcomes, not two: they serve it, they serve somewhere and not here,
     or we do not know where they serve. The third used to fall through to the
     out-of-emirate penalty, which told a listing with no branch and no coverage
     that it was in the wrong place.
  */
  const locality =
    request.emirate === null || candidate.emirates.length === 0
      ? UNMEASURED
      : candidate.emirates.includes(request.emirate)
        ? 1
        : 0.35;

  /*
     Platform-owned, so it is safe to rank on.

     Normalised against the top rung anybody can reach, which is 2 — not 4. The
     literal divisor here was right when the ladder ran to four and has been
     wrong since site visits were withdrawn: a licence-verified supplier, the
     best a supplier can be, scored 0.75 of this component instead of 1, in the
     function that decides which eight of them receive an enquiry.
  */
  const trust = trustScore(candidate.verificationTier);

  /*
   * Measured, never claimed. An unmeasured seller scores the midpoint rather
   * than zero: a new listing with no history is unknown, not slow, and
   * defaulting it to slow would make the cold-start problem permanent.
   */
  const speed =
    candidate.responseTimeMedianMs === null
      ? UNMEASURED
      : Math.max(0, 1 - candidate.responseTimeMedianMs / (24 * 3_600_000));

  /*
     No plan multiplier here, and that is the whole point.

     `/rfq/new` tells a buyer, in the recipient card, how the list was chosen:
     "We pick them on what they stock, where they are and how fast they reply.
     Never on what they pay us." That sentence shipped, and this function
     multiplied the score by `Plan.rankingMultiplier` — free 1.0, basic 1.15,
     pro 1.35 — so what they paid us moved a supplier by up to 35%, which is
     further than the entire tier-0-to-tier-4 span of the trust term.

     Search keeps the multiplier (`lib/search/ranking.ts`), and a paid boost
     there is disclosed: it renders as sponsored placement and is always
     labelled. A fan-out is different on both counts. There are eight slots and
     they are scarce, the buyer is not browsing but asking, and the page makes
     an explicit promise at the moment of highest intent. A promise the code
     contradicts is worse than no promise.
  */
  return Math.min(
    1,
    coverage * 0.34 + stock * 0.2 + category * 0.18 + locality * 0.12 + trust * 0.1 + speed * 0.06,
  );
}

export function selectRecipients(
  candidates: readonly FanoutCandidate[],
  request: FanoutRequest,
): FanoutResult {
  const want = Math.min(MAX_RECIPIENTS, Math.max(MIN_RECIPIENTS, Math.floor(request.want)));
  const pinned = new Set(request.pinned ?? []);

  const skipped: FanoutResult["skipped"] = [];
  const eligible: FanoutCandidate[] = [];

  for (const candidate of candidates) {
    if (atMonthlyCap(candidate)) {
      // Even a pinned seller. If they cannot reply, putting them on the
      // enquiry costs the buyer a slot and gets them nothing.
      skipped.push({ businessId: candidate.businessId, reason: "at_monthly_cap" });
      continue;
    }
    eligible.push(candidate);
  }

  const ranked = [...eligible].sort((a, b) => {
    const pinnedDelta = Number(pinned.has(b.businessId)) - Number(pinned.has(a.businessId));
    if (pinnedDelta !== 0) return pinnedDelta;
    const scoreDelta = scoreCandidate(b, request) - scoreCandidate(a, request);
    if (scoreDelta !== 0) return scoreDelta;
    // Stable, so two runs of the same enquiry pick the same suppliers.
    return a.businessId.localeCompare(b.businessId);
  });

  return { recipients: ranked.slice(0, want), skipped };
}

/** The first day of the current month, in the UAE. Where a monthly cap resets. */
export function monthStart(now: Date, timeZone = "Asia/Dubai"): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  // +04:00 year-round: the UAE does not observe daylight saving.
  return new Date(`${year}-${month}-01T00:00:00+04:00`);
}
