import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * Every claim search, written down. Board 2a's data requirements.
 *
 * *"Log every query, because a search that returns nothing is a supplier we do
 * not have, and that is the same recruitment signal as `zero_result_query` on
 * `1c`."*
 *
 * Two tables, for the same reason the buyer search writes to two:
 *
 *   - `SearchQueryLog` takes every query with its result count. It is the
 *     volume record — how many suppliers came looking, and how often we could
 *     answer.
 *   - `ZeroResultQuery` takes the misses only. That is the table board 12d's
 *     recruitment queue reads, and a supplier who searched for their own
 *     business and found nothing is the most direct recruitment signal there
 *     is: they came to us, and we did not hold them.
 *
 * `tab` marks both as `claim` so neither is mistaken for a buyer's search. That
 * matters on the first of them: the home page's "Popular:" chips group
 * `SearchQueryLog` by normalised query, and without the marker a supplier's own
 * trade name would surface on the directory home as something buyers search
 * for. `readPopularQueries` filters to the buyer tabs, and this is the half of
 * that pair that makes the filter meaningful.
 */

/** What `tab` says on both rows. Read by the home page's exclusion. */
export const CLAIM_SEARCH_TAB = "claim";

/**
 * Never throws.
 *
 * A logging failure must not turn a search into an error page. The supplier in
 * front of it is the one we are trying not to lose.
 */
export async function recordClaimSearch(query: string, resultCount: number): Promise<void> {
  const text = query.trim();
  if (!text) return;

  const normalised = text.toLowerCase().replace(/\s+/g, " ").slice(0, 200);

  try {
    await prisma.searchQueryLog.create({
      data: {
        query: text.slice(0, 200),
        normalised,
        resultCount,
        tab: CLAIM_SEARCH_TAB,
      },
    });
  } catch (error) {
    console.error("[search_query_log] claim search write failed", error);
  }

  if (resultCount > 0) return;

  try {
    await prisma.zeroResultQuery.create({
      data: {
        query: text.slice(0, 200),
        tab: CLAIM_SEARCH_TAB,
        /*
           No category and no emirate, and not an omission. A supplier typing
           their own trade name has not told us what they sell or where they
           are — that is the thing we do not know about them, and guessing it
           from a name would put a fabricated trade into the queue a recruiter
           calls from.
        */
        filters: { source: "onboarding_claim" },
      },
    });
  } catch (error) {
    console.error("[zero_result_query] claim search write failed", error);
  }
}
