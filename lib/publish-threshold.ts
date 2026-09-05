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
  /**
   * Listings required per 1,000 monthly searches for the scope — board 6f.
   *
   * The second half of the listings condition. A page needs the absolute floor
   * OR the demand-relative figure, whichever is higher, so a trade nobody
   * searches for publishes at the floor and "AC repair in Business Bay" at
   * 3,940 searches a month needs 99. The reasoning is that a page competing for
   * real attention has to be worth arriving at, and sixty listings against four
   * thousand searches is a page that will be out-ranked and deserves to be.
   *
   * It bites only where a demand figure exists. See `PublishInput.monthlySearches`.
   */
  demandPerThousand: number;
  /**
   * The fraction of the need a page that is ALREADY live keeps holding at.
   *
   * Board 6f asks for hysteresis: publish at 60, unpublish at 48. Without a
   * band, a scope sitting on the floor flaps — published on Monday when a
   * licence renews, unpublished on Tuesday when one lapses, and every flap is a
   * URL entering and leaving the sitemap. Search engines read that as a site
   * that cannot be relied on, which is the same thing thin pages say.
   *
   * A share rather than a second integer, because the need is no longer one
   * number: at the default 0.8 it reproduces the board's 60 and 48 exactly, and
   * a scope whose demand raises the need to 99 holds at 80 rather than at an
   * absolute 48 that would leave a fifty-listing page live against four
   * thousand searches for ever.
   */
  holdShare: number;
}

export const DEFAULT_THRESHOLDS: PublishThresholds = {
  minListings: 60,
  minVerifiedShare: 0.3,
  minIntroWords: 250,
  minFaqRows: 4,
  minScopeSpecificFaqRows: 2,
  demandPerThousand: 25,
  holdShare: 0.8,
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
  /**
   * Searches a month for this scope, where anybody has recorded one.
   *
   * Optional for the same reason `faqRows` is, and the absence matters more
   * here. Only the two landing classes have a scope a keyword figure can be
   * attached to: a `/c/:slug` category page is a trade with no place, and
   * "monthly searches for valves" has no meaning that would decide whether the
   * page may exist.
   *
   * **Absent is not zero.** A default of nought would make the demand-relative
   * need `25 × 0 / 1000 = 0`, so every page with no figure would pass the new
   * condition for the wrong reason — and most scopes will have no figure for
   * the foreseeable future. Absent means the absolute floor alone, which is
   * exactly the rule that was in force before this existed.
   */
  monthlySearches?: number;
}

/**
 * Which rule produced the listings number a page was measured against.
 *
 * `hold` is the band: `evaluateHold` measures a live page against a lower floor
 * than the one it published at, and a refusal that said "it publishes at 80"
 * about a scope that publishes at 99 would be a sentence nobody could
 * reconcile with the matrix.
 */
export type ListingsBasis = "absolute" | "demand" | "hold";

export type PublishFailure =
  /**
   * `basis` says which half of the listings rule set the number.
   *
   * A field on the existing variant rather than a sixth `reason`, deliberately:
   * `refusalMessage` in lib/seo/area.ts switches over the five reasons with no
   * default, under `strict` but not `noImplicitReturns`, so a sixth reason
   * would infer `string | undefined` and render as an empty string — a refusal
   * a staff member reads with the reason silently missing.
   */
  | { reason: "listings"; have: number; need: number; basis: ListingsBasis }
  | { reason: "verified_share"; have: number; need: number }
  | { reason: "intro_words"; have: number; need: number }
  | { reason: "faq_rows"; have: number; need: number }
  | { reason: "faq_scope_specific"; have: number; need: number };

export interface PublishDecision {
  publishable: boolean;
  failures: PublishFailure[];
}

/**
 * How many listings this scope actually needs, and which rule set the number.
 *
 * The higher of the absolute floor and the demand-relative figure. Exported
 * because the matrix prints it per row: board 6f's whole screen is the
 * difference between "78 of 60" and "78 of 99", and a screen that showed the
 * floor while the gate used the other number would be lying twice over.
 */
export function listingsNeeded(
  input: Pick<PublishInput, "monthlySearches">,
  thresholds: PublishThresholds = DEFAULT_THRESHOLDS,
): { need: number; basis: "absolute" | "demand" } {
  const searches = input.monthlySearches;
  if (searches === undefined) return { need: thresholds.minListings, basis: "absolute" };
  const demand = Math.ceil((thresholds.demandPerThousand * searches) / 1_000);
  return demand > thresholds.minListings
    ? { need: demand, basis: "demand" }
    : { need: thresholds.minListings, basis: "absolute" };
}

/**
 * The floor a page that is already live keeps holding at.
 *
 * Never above the publish need, and never below one: a scope with a demand
 * figure of nought would otherwise hold at nought, which is a page with no
 * listings on it staying in the sitemap.
 */
export function holdFloor(
  input: Pick<PublishInput, "monthlySearches">,
  thresholds: PublishThresholds = DEFAULT_THRESHOLDS,
): number {
  const { need } = listingsNeeded(input, thresholds);
  return Math.max(1, Math.min(need, Math.ceil(need * thresholds.holdShare)));
}

/**
 * Enforced in code, not by editorial discipline — routes.md says so outright.
 *
 * Whether this scope may be published **now**. Board 6f split what used to be
 * one question in two: `evaluateHold` decides whether a page that is already
 * live may stay. The pair is deliberate and it is the one asymmetry in the
 * gate — see `PublishThresholds.holdShare` for why a band exists at all.
 *
 * Still no stored flag. Both take the current numbers, because between supply
 * dropping and a job running, a stored verdict is a thin page that is live and
 * indexable.
 */
export function evaluatePublish(
  input: PublishInput,
  thresholds: PublishThresholds = DEFAULT_THRESHOLDS,
): PublishDecision {
  return decide(input, thresholds, listingsNeeded(input, thresholds));
}

/**
 * Whether a page that is already live may stay live.
 *
 * Identical to `evaluatePublish` but for the listings floor. The other three
 * conditions get no band on purpose: copy and questions do not decay on their
 * own — they change when an editor deletes them, and a page whose intro was
 * emptied should stop being served in that request, not after a grace. The
 * verified share is measured against the listings that are actually there, so
 * it moves with the same supply the band already covers.
 */
export function evaluateHold(
  input: PublishInput,
  thresholds: PublishThresholds = DEFAULT_THRESHOLDS,
): PublishDecision {
  return decide(input, thresholds, { need: holdFloor(input, thresholds), basis: "hold" });
}

function decide(
  input: PublishInput,
  thresholds: PublishThresholds,
  listings: { need: number; basis: ListingsBasis },
): PublishDecision {
  const failures: PublishFailure[] = [];

  if (input.listings < listings.need) {
    failures.push({
      reason: "listings",
      have: input.listings,
      need: listings.need,
      basis: listings.basis,
    });
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

export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}
