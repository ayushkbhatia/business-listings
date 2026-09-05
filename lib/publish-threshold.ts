/**
 * Board 6f. Whether a generated landing page is allowed to exist.
 *
 * Area and subcategory landing pages are handoff 5. The guard lives here, in
 * handoff 1, because the risk it protects against is a thin page reaching the
 * index by accident — and by the time the pages exist it is already too late
 * to add the check without a de-indexing exercise.
 *
 * Thin directory pages are the single fastest way to lose a domain's standing:
 * a hundred "Valves in Umm Al Quwain" pages with four listings each teach
 * Google that the site is mostly filler.
 */
export interface PublishThresholds {
  /** Listings needed before the page may publish. */
  minListings: number;
  /** Share of those listings that must be verified. */
  minVerifiedShare: number;
  /** Words of genuine intro copy. */
  minIntroWords: number;
  /**
   * Q&A rows, and how many of them must be answerable only for this scope.
   *
   * Board 6a's fourth condition, and the one that is hardest to satisfy by
   * accident. Four generic questions with the area name substituted in is the
   * doorway page the other three conditions were written to stop, arriving
   * through the one part of the template nobody was counting.
   */
  minFaqRows: number;
  minScopeSpecificFaqRows: number;
}

export const DEFAULT_THRESHOLDS: PublishThresholds = {
  minListings: 60,
  minVerifiedShare: 0.3,
  minIntroWords: 250,
  minFaqRows: 4,
  minScopeSpecificFaqRows: 2,
};

export interface PublishInput {
  listings: number;
  verified: number;
  introWords: number;
  /**
   * The FAQ counts, when the caller has an FAQ to count.
   *
   * Optional, and that is a decision rather than laziness. Board 6a adds this
   * condition to the two **landing** classes — area and emirate — which are the
   * pages a stranger arrives at from a search engine. A `Category` row on the
   * 6f matrix and a guide have no per-scope FAQ and never will: a guide's whole
   * body is the answer, and adding a fourth gate to the taxonomy screen would
   * grey out every category on it for want of a table nothing writes.
   *
   * So an absent count is not a zero. Callers that own an FAQ pass both numbers
   * and are gated on them; callers that do not pass neither and are gated on
   * three conditions, exactly as they were before this existed.
   */
  faqRows?: number;
  scopeSpecificFaqRows?: number;
}

export type PublishFailure =
  | { reason: "listings"; have: number; need: number }
  | { reason: "verified_share"; have: number; need: number }
  | { reason: "intro_words"; have: number; need: number }
  | { reason: "faq_rows"; have: number; need: number }
  | { reason: "faq_scope_specific"; have: number; need: number };

export interface PublishDecision {
  publishable: boolean;
  failures: PublishFailure[];
}

/**
 * Enforced in code, not by editorial discipline — routes.md says so outright.
 *
 * The same function decides publishing and unpublishing. A page that drops
 * below the floor after launch auto-unpublishes, which is why this takes the
 * current numbers rather than a stored flag.
 */
export function evaluatePublish(
  input: PublishInput,
  thresholds: PublishThresholds = DEFAULT_THRESHOLDS,
): PublishDecision {
  const failures: PublishFailure[] = [];

  if (input.listings < thresholds.minListings) {
    failures.push({ reason: "listings", have: input.listings, need: thresholds.minListings });
  }

  const share = input.listings === 0 ? 0 : input.verified / input.listings;
  if (share < thresholds.minVerifiedShare) {
    failures.push({
      reason: "verified_share",
      have: Number(share.toFixed(4)),
      need: thresholds.minVerifiedShare,
    });
  }

  if (input.introWords < thresholds.minIntroWords) {
    failures.push({ reason: "intro_words", have: input.introWords, need: thresholds.minIntroWords });
  }

  /*
     Only where there is an FAQ to count. See `PublishInput.faqRows`: the two
     landing classes pass these and are gated on them, the taxonomy matrix and
     the guides pass neither and keep the three conditions they have always had.
  */
  if (input.faqRows !== undefined) {
    if (input.faqRows < thresholds.minFaqRows) {
      failures.push({ reason: "faq_rows", have: input.faqRows, need: thresholds.minFaqRows });
    }
    const specific = input.scopeSpecificFaqRows ?? 0;
    if (specific < thresholds.minScopeSpecificFaqRows) {
      failures.push({
        reason: "faq_scope_specific",
        have: specific,
        need: thresholds.minScopeSpecificFaqRows,
      });
    }
  }

  return { publishable: failures.length === 0, failures };
}

/** Convenience for the sitemap, which only cares about the answer. */
export function isPublishable(
  input: PublishInput,
  thresholds: PublishThresholds = DEFAULT_THRESHOLDS,
): boolean {
  return evaluatePublish(input, thresholds).publishable;
}

export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}
