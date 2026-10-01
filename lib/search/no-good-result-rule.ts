import { publiclyClaimed } from "@/lib/claims/status";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * D-NOGOOD's rule, with no database — the owner's answer, 1 Oct 2026.
 *
 * > A search has no good result when the first page of suppliers it returns
 * > holds no claimed, licence-verified supplier.
 *
 * Pure, so the screen that prints the rule and the unit suite that holds it
 * read the same numbers as `./no-good-result.ts`, which runs it.
 */

/** How many of a period's top searches are run again. Twenty searches is the cost ceiling. */
export const NO_GOOD_RESULT_CANDIDATES = 20;

/** How many the card shows. */
export const NO_GOOD_RESULT_SHOWN = 3;

/**
 * The first page: the twenty suppliers `/search` shows before its pager.
 * `tests/integration/platform-overview.test.ts` holds this equal to the
 * search's own page size, so "the first page" cannot come to mean two things.
 */
export const FIRST_PAGE = 20;

/** Whether a first page of suppliers holds a good result. */
export function holdsGoodResult(rows: readonly { claimStatus: string; verificationTier: number }[]): boolean {
  return rows.some((row) => publiclyClaimed(row.claimStatus) && row.verificationTier >= VERIFIED_TIER);
}
