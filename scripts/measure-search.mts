import { performance } from "node:perf_hooks";
import { prisma } from "../lib/db/client.js";
import { businessWhere, searchBusinesses, PAGE_SIZE } from "../lib/db/queries/search.js";
import { parseSearchQuery } from "../lib/search/query.js";

/**
 * What a search costs at 41,000 listings, before anything is changed.
 *
 * Task T2.2 says to move the ranking into SQL. The reason given is that the
 * current path takes 200 rows with no `orderBy`, ranks them in the process and
 * slices a page out of that — so the page is a window on an arbitrary 200 and
 * the total underneath it is a real `count()` of something else.
 *
 * The correctness half of that is not in question and is not a performance
 * argument. What *is* in question is how to fix it, and the two candidates cost
 * very different amounts:
 *
 *   **A · rank the whole matched set in the process.** Correct immediately —
 *   every page is a true page — and O(rows matched) per request.
 *   **B · score and order in SQL, page with LIMIT/OFFSET.** Also correct, and
 *   O(page), but it means a second implementation of `factorScores` in SQL and
 *   a second implementation of `businessWhere`'s predicate, which is a hundred
 *   lines of nested relation filters.
 *
 * B is more work and carries drift risk on the product's most important
 * ordering surface. So this measures A against the real corpus first, because
 * "it will be too slow" is a claim and this prints the number.
 *
 * Run against a scale database — see `prisma/seed-at-scale.mts`:
 *
 *   DATABASE_URL=…/bl_scale DIRECT_URL=…/bl_scale pnpm tsx scripts/measure-search.mts
 */

const RUNS = 5;

interface Case {
  name: string;
  params: Record<string, string>;
}

/**
 * The shapes that actually hit this query, widest first.
 *
 * An empty query is the one that matters most: `/search` with no words is every
 * public listing in the directory, which is the largest matched set the ranking
 * can be handed and the one the 200-row window hid completely.
 */
const CASES: Case[] = [
  { name: "no query, no filter (everything)", params: {} },
  { name: "one emirate", params: { emirate: "dubai" } },
  { name: "one word", params: { q: "valves" } },
  { name: "two words", params: { q: "chilled water" } },
  { name: "a word and an emirate", params: { q: "pumps", emirate: "dubai" } },
  { name: "verified only", params: { tier: "2" } },
  { name: "page 50", params: { page: "50" } },
];

function ms(from: number): number {
  return Math.round((performance.now() - from) * 10) / 10;
}

async function main(): Promise<void> {
  const [total, live] = await Promise.all([
    prisma.business.count(),
    prisma.business.count({ where: { publishedAt: { not: null }, suspendedAt: null } }),
  ]);
  console.log(`corpus: ${total.toLocaleString()} listings, ${live.toLocaleString()} public\n`);

  if (live < 10_000) {
    console.log(
      "⚠ fewer than ten thousand public listings. This is not a scale database —\n" +
        "  run `pnpm db:seed:scale` against one first, or the numbers below mean nothing.\n",
    );
  }

  const header = ["case", "matched", "candidates", "search ms", "count ms", "all-ids ms"];
  const rows: string[][] = [header];

  for (const testCase of CASES) {
    const query = parseSearchQuery(testCase.params);
    const where = businessWhere(query);

    // How many rows the predicate actually matches — the size the ranking would
    // have to sort under candidate A.
    const matched = await prisma.business.count({ where });

    const timings = { search: [] as number[], count: [] as number[], ids: [] as number[] };
    for (let run = 0; run < RUNS; run += 1) {
      let at = performance.now();
      const page = await searchBusinesses(query);
      timings.search.push(ms(at));
      if (run === 0 && page.rows.length > PAGE_SIZE) {
        throw new Error(`a page returned ${String(page.rows.length)} rows`);
      }

      at = performance.now();
      await prisma.business.count({ where });
      timings.count.push(ms(at));

      /*
         Candidate A's cost, measured rather than guessed: every matched row's
         scoring columns, which is what ranking the whole set would have to
         read. The relations are the expensive part — a branch for distance and
         the live services for scope completeness.
      */
      at = performance.now();
      await prisma.business.findMany({
        where,
        orderBy: [{ id: "asc" }],
        select: {
          id: true,
          displayName: true,
          searchText: true,
          verificationTier: true,
          responseTimeMedianMs: true,
          specCompleteness: true,
          primaryCategoryId: true,
          plan: { select: { rankingMultiplier: true } },
          locations: { select: { lat: true, lng: true, geocodePrecision: true } },
        },
      });
      timings.ids.push(ms(at));
    }

    const median = (list: number[]) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)]!;
    rows.push([
      testCase.name,
      matched.toLocaleString(),
      String(Math.min(matched, 200)),
      String(median(timings.search)),
      String(median(timings.count)),
      String(median(timings.ids)),
    ]);
  }

  const widths = header.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  for (const [index, row] of rows.entries()) {
    console.log(row.map((cell, i) => cell.padEnd(widths[i]!)).join("  "));
    if (index === 0) console.log(widths.map((w) => "─".repeat(w)).join("  "));
  }

  console.log(
    "\n`search ms` is today's path: a 200-row window, ranked in the process, sliced.\n" +
      "`all-ids ms` is what candidate A would add — every matched row's scoring columns.\n" +
      "A search page's budget is in docs/production-build-plan.md §13.",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
