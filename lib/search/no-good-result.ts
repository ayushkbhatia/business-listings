import "server-only";
import { prisma } from "@/lib/db/client";
import { searchBusinesses } from "@/lib/db/queries/search";
import { parseSearchQuery } from "@/lib/search/query";
import { FIRST_PAGE, holdsGoodResult, NO_GOOD_RESULT_CANDIDATES, NO_GOOD_RESULT_SHOWN } from "./no-good-result-rule";

export { FIRST_PAGE, holdsGoodResult, NO_GOOD_RESULT_CANDIDATES, NO_GOOD_RESULT_SHOWN };

/**
 * Searches with no good result — board 4a's third rail card, and the owner's
 * answer to D-NOGOOD (1 Oct 2026).
 *
 * `10c` logs a search that returned nothing. That is the narrowest failure, and
 * it misses the commoner one: a search that returns twenty unclaimed licence
 * records, none of which can answer an enquiry. So the rule is wider:
 *
 * > **A search has no good result when the first page of suppliers it returns
 * > holds no claimed, licence-verified supplier.**
 *
 * Claimed is `publiclyClaimed` — a disputed listing reads as unclaimed — and
 * licence-verified is `VERIFIED_TIER`, the badge's own threshold.
 *
 * ## Checked against today's directory
 *
 * The log records how many results a search found, not who was on the first
 * page, and adding that would be a migration. So the period's most-searched
 * queries are run again, now, through the search buyers use. The card says what
 * a buyer would find *today* for what buyers asked *in the period* — which is
 * the question recruitment needs answered: a gap somebody has since filled is
 * not a gap worth a call.
 *
 * Every query is grouped on its normalised form, the same key the home page's
 * popular chips group on, across every tab it was searched from.
 */

/** Searches run at once while checking. */
const BATCH = 4;

export interface NoGoodResultQuery {
  /** As a buyer typed it, the most recent spelling of the normalised form. */
  query: string;
  normalised: string;
  /** Searches for it in the window. */
  searches: number;
  /** Suppliers the search returns today, in total. */
  suppliersToday: number;
}

export interface NoGoodResultReport {
  /** The queries with no good result, most-searched first, at most `NO_GOOD_RESULT_SHOWN`. */
  rows: NoGoodResultQuery[];
  /** How many top searches were checked. Zero when nobody searched in the window. */
  checked: number;
}

export async function noGoodResultQueries(from: Date, to: Date): Promise<NoGoodResultReport> {
  const top = await prisma.searchQueryLog.groupBy({
    by: ["normalised"],
    where: { createdAt: { gte: from, lt: to } },
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: [{ _count: { normalised: "desc" } }, { normalised: "asc" }],
    take: NO_GOOD_RESULT_CANDIDATES,
  });
  if (top.length === 0) return { rows: [], checked: 0 };

  const spellings = await prisma.searchQueryLog.findMany({
    where: { normalised: { in: top.map((row) => row.normalised) }, createdAt: { gte: from, lt: to } },
    select: { normalised: true, query: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const spelling = new Map<string, string>();
  for (const row of spellings) if (!spelling.has(row.normalised)) spelling.set(row.normalised, row.query);

  /*
     Most-searched first, a few at a time, stopping once the card is full: the
     searches are real ones and twenty of them at once is a load spike nobody
     asked for. `checked` is what was actually run, so the card's rule sentence
     can say how many it looked at.
  */
  const rows: NoGoodResultQuery[] = [];
  let checked = 0;
  for (let start = 0; start < top.length && rows.length < NO_GOOD_RESULT_SHOWN; start += BATCH) {
    const batch = top.slice(start, start + BATCH);
    const results = await Promise.all(
      batch.map((candidate) =>
        searchBusinesses(parseSearchQuery({ q: candidate.normalised }), { pageSize: FIRST_PAGE }),
      ),
    );
    batch.forEach((candidate, index) => {
      const result = results[index]!;
      checked += 1;
      if (rows.length >= NO_GOOD_RESULT_SHOWN || holdsGoodResult(result.rows)) return;
      rows.push({
        query: spelling.get(candidate.normalised) ?? candidate.normalised,
        normalised: candidate.normalised,
        searches: candidate._count._all,
        suppliersToday: result.total,
      });
    });
  }
  return { rows, checked };
}
