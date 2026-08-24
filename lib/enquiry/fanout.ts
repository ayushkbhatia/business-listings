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

export const MIN_RECIPIENTS = 1;
export const MAX_RECIPIENTS = 8;

/** The default the composer offers: "also send to N similar suppliers". */
export const DEFAULT_FANOUT = 5;

export interface FanoutCandidate {
  businessId: string;
  slug: string;
  displayName: string;
  /** Subcategory ids this business is listed under. */
  categoryIds: readonly string[];
  primaryCategoryId: string;
  emirate: string;
  /** 0..4. Platform-owned. */
  verificationTier: number;
  /** Median enquiry-to-first-reply. Null when there is not enough to measure. */
  responseTimeMedianMs: number | null;
  /** How many of the enquiry's lines this seller has something for. */
  matchedLineCount: number;
  /** Of those, how many are in stock rather than made to order. */
  inStockLineCount: number;
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
export function atMonthlyCap(candidate: FanoutCandidate): boolean {
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
  const coverage = Math.min(1, candidate.matchedLineCount / lines);
  const stock = Math.min(1, candidate.inStockLineCount / lines);

  const category = candidate.categoryIds.includes(request.categoryId)
    ? candidate.primaryCategoryId === request.categoryId
      ? 1
      : 0.7
    : 0;

  // Same emirate is a real delivery difference in the UAE, not a nicety.
  const locality = request.emirate === null ? 0.5 : candidate.emirate === request.emirate ? 1 : 0.35;

  // Platform-owned, so it is safe to rank on. 0..4 normalised.
  const trust = candidate.verificationTier / 4;

  /*
   * Measured, never claimed. An unmeasured seller scores the midpoint rather
   * than zero: a new listing with no history is unknown, not slow, and
   * defaulting it to slow would make the cold-start problem permanent.
   */
  const speed =
    candidate.responseTimeMedianMs === null
      ? 0.5
      : Math.max(0, 1 - candidate.responseTimeMedianMs / (24 * 3_600_000));

  const base =
    coverage * 0.34 + stock * 0.2 + category * 0.18 + locality * 0.12 + trust * 0.1 + speed * 0.06;

  // The plan's nudge, applied last and bounded, so it can reorder two similar
  // suppliers and never promote one who cannot fill the order.
  return Math.min(1, base * Math.min(1.35, Math.max(1, candidate.rankingMultiplier)));
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
