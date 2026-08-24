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
}

export const DEFAULT_THRESHOLDS: PublishThresholds = {
  minListings: 60,
  minVerifiedShare: 0.3,
  minIntroWords: 250,
};

export interface PublishInput {
  listings: number;
  verified: number;
  introWords: number;
}

export type PublishFailure =
  | { reason: "listings"; have: number; need: number }
  | { reason: "verified_share"; have: number; need: number }
  | { reason: "intro_words"; have: number; need: number };

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
