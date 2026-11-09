import { describe, expect, it } from "vitest";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { businessWhere } from "@/lib/db/queries/search";
import { businessPredicateSql } from "@/lib/search/predicate-sql";
import { parseSearchQuery } from "@/lib/search/query";

/**
 * The control on T2.2's second predicate.
 *
 * `businessWhere` is the one function every count, chip and facet on a results
 * page shares, and that is deliberate: a facet count that does not respect the
 * other active filters is the classic mistake, and the only durable fix is that
 * there is one function. Ordering the ranking in the database needed a second
 * one in SQL, so the single-function property is now a *tested* property rather
 * than a structural one.
 *
 * Both predicates are run over the same database and their matched id sets
 * asserted equal. Ids, not counts: two filters can match the same number of
 * rows and not the same rows, and the first symptom of that would be a list
 * whose own chips disagree with it.
 *
 * It is worth running against the 41,000-row harness, where the sets are large
 * enough for a wrong `OR` to show. It is correct against the curated seed too,
 * which is what CI has, and a clause nobody exercises is reported rather than
 * passed over — see the `exercised` assertion at the end.
 */

/** Pinned, so a filter that reads `getFullYear()` cannot race the calendar. */
const NOW = new Date("2026-11-09T12:00:00.000Z");

interface Case {
  name: string;
  params: Record<string, string | string[]>;
  /** The page's category set, where the surface has one. */
  categoryIds?: readonly string[];
}

async function sampleCategories(): Promise<string[]> {
  const rows = await prisma.category.findMany({
    where: { children: { none: {} } },
    orderBy: [{ slug: "asc" }, { id: "asc" }],
    take: 3,
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

async function sampleArea(): Promise<{ slug: string; emirate: string } | null> {
  const row = await prisma.area.findFirst({
    where: { locations: { some: { published: true } } },
    orderBy: [{ slug: "asc" }, { id: "asc" }],
    select: { slug: true, emirate: true },
  });
  return row;
}

/** Every id the Prisma predicate matches, in one order both sides can use. */
async function viaPrisma(testCase: Case): Promise<string[]> {
  const query = parseSearchQuery(testCase.params);
  const rows = await prisma.business.findMany({
    where: businessWhere(query, testCase.categoryIds ? [...testCase.categoryIds] : undefined),
    orderBy: [{ id: "asc" }],
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** Every id the SQL predicate matches. */
async function viaSql(testCase: Case): Promise<string[]> {
  const query = parseSearchQuery(testCase.params);
  const predicate = businessPredicateSql(query, testCase.categoryIds, NOW);
  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT b.id FROM business b WHERE ${predicate} ORDER BY b.id ASC`,
  );
  return rows.map((row) => row.id);
}

describe("the SQL predicate matches exactly what businessWhere matches", () => {
  it("agrees on every filter shape the results page can produce", async () => {
    const categories = await sampleCategories();
    const area = await sampleArea();

    const cases: Case[] = [
      { name: "no filter at all — every public listing", params: {} },
      { name: "a category set, primary or additional (N14)", params: {}, categoryIds: categories },
      { name: "one word", params: { q: "valves" } },
      { name: "two words, which must both match", params: { q: "chilled water" } },
      { name: "a code, matched whole and never as a substring", params: { q: "DN100" } },
      { name: "a code and a word", params: { q: "valves DN50" } },
      /*
         Both predicates treat these as wildcards, because Prisma's `contains`
         does not escape them. That is a defect in the product and it is pinned
         here rather than fixed, so that whoever fixes it moves both predicates
         and every count that shares them.
      */
      { name: "a percent, which LIKE reads as a wildcard", params: { q: "50%" } },
      { name: "an underscore, the other wildcard", params: { q: "a_b" } },
      { name: "verified only", params: { tier: "2" } },
      { name: "claimed-and-checked plus a word", params: { q: "pumps", tier: "2" } },
      { name: "a reply-time filter", params: { replyWithinHours: "24" } },
      { name: "years trading, which reads the calendar", params: { yearsTrading: "5" } },
      { name: "one emirate", params: { emirate: "dubai" } },
      { name: "a free zone, which narrows rather than replaces", params: { freeZone: "1" } },
      { name: "an emirate and a free zone together", params: { emirate: "dubai", freeZone: "1" } },
      { name: "a viewport, where an unpinned branch drops out", params: { bounds: "24.8,55.0,25.4,55.5" } },
      { name: "availability", params: { availability: "in_stock" } },
      { name: "two availabilities", params: { availability: ["in_stock", "made_to_order"] } },
      { name: "everything at once", params: { q: "valves", tier: "1", emirate: "dubai", availability: "in_stock", replyWithinHours: "48" } },
      ...(area
        ? [
            { name: "one area", params: { area: area.slug } },
            { name: "an area inside its emirate", params: { area: area.slug, emirate: area.emirate } },
            { name: "an area and a word", params: { area: area.slug, q: "fittings" } },
          ]
        : []),
    ];

    const matched: Record<string, number> = {};
    for (const testCase of cases) {
      const [prismaIds, sqlIds] = await Promise.all([viaPrisma(testCase), viaSql(testCase)]);
      /*
         The whole arrays, not the counts and not a sample. A diff here prints
         the ids that differ, which is the only report that says which clause
         drifted.
      */
      expect(sqlIds, testCase.name).toEqual(prismaIds);
      matched[testCase.name] = prismaIds.length;
    }

    /*
       A predicate nothing matches proves nothing. This does not fail on an
       empty case — a seeded database legitimately has no free-zone listing in
       some emirate — but it does fail if *every* case is empty, which is what a
       broken fixture looks like and would otherwise read as a pass.
    */
    const nonEmpty = Object.values(matched).filter((count) => count > 0).length;
    expect(nonEmpty, `cases that matched something: ${JSON.stringify(matched, null, 1)}`).toBeGreaterThan(
      cases.length / 2,
    );
  });

  it("applies a spec facet to one product rather than across several", async () => {
    /*
       The property `specWhere`'s own comment argues for: a supplier stocking a
       DN100 brass valve and a DN50 cast-iron one does not stock a DN100
       cast-iron valve. Both predicates have to agree on that, and a facet is
       the one clause where "all constraints inside a single EXISTS" is easy to
       get wrong in SQL by writing one EXISTS per field.
    */
    const field = await prisma.specField.findFirst({
      where: { isFilterable: true },
      orderBy: [{ key: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!field) return;

    const product = await prisma.product.findFirst({
      where: { status: { not: "draft" }, specValues: { path: [field.id], not: Prisma.DbNull } },
      orderBy: [{ id: "asc" }],
      select: { specValues: true },
    });
    const raw = (product?.specValues ?? null) as Record<string, unknown> | null;
    const value = raw?.[field.id];
    const chosen = Array.isArray(value) ? value[0] : value;
    if (typeof chosen !== "string") return;

    const testCase: Case = { name: "one spec facet", params: { [field.id]: chosen } };
    const [prismaIds, sqlIds] = await Promise.all([viaPrisma(testCase), viaSql(testCase)]);
    expect(sqlIds).toEqual(prismaIds);
    expect(prismaIds.length).toBeGreaterThan(0);
  });
});
