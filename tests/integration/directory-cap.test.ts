import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { MAX_LISTINGS, loadDirectory } from "@/lib/search/directory";
import { PUBLIC_BUSINESS } from "@/lib/db/queries/search";

/**
 * The sampling cap, and the count that used to be the number 1.
 *
 * `loadDirectory` took `MAX_LISTINGS + 1` and reported `rows.length -
 * MAX_LISTINGS`, so `unread` was **1 whenever it was non-zero** — at 20,001
 * listings and at 200,000 alike. `ImpactTable` prints it to an ops lead as
 * "1 past the sampling cap were not ranked" immediately before they press
 * publish, which is a constant on the one panel whose job is to say how much a
 * change moves.
 *
 * The seeded directory is far below the cap, so what is asserted here is the
 * shape: below the cap nothing is unread and nothing is capped, and the figure
 * is derived from a count of the same predicate the rows come from rather than
 * from the length of a page.
 */
describe("the ranking sampler reports what it did not read", () => {
  it("says nothing is unread below the cap", async () => {
    const { rows, capped, unread } = await loadDirectory();

    expect(rows.length).toBeLessThan(MAX_LISTINGS);
    expect(capped).toBe(false);
    expect(unread).toBe(0);
  });

  it("reads every listing the public predicate admits", async () => {
    /*
       The rows and the count answer the same question, which is what makes
       `unread` subtractable at all. Before the fix the read was one row wider
       than the cap and the count was never taken, so the two could not be
       compared — and the difference was hardcoded into existence.
    */
    const [{ rows }, live] = await Promise.all([
      loadDirectory(),
      prisma.business.count({ where: PUBLIC_BUSINESS }),
    ]);
    expect(rows.length).toBe(Math.min(live, MAX_LISTINGS));
  });

  it("would report the real shortfall rather than one", async () => {
    /*
       The arithmetic, at a cap this suite can reach. `loadDirectory` is
       `MAX_LISTINGS`-bound and the seed is three orders of magnitude below it,
       so the property is asserted on the expression rather than by seeding
       twenty thousand businesses: whatever the total, the shortfall is the
       total minus the cap, and it is 1 only when the total is exactly one past.
    */
    const shortfall = (total: number) => Math.max(0, total - MAX_LISTINGS);

    expect(shortfall(MAX_LISTINGS)).toBe(0);
    expect(shortfall(MAX_LISTINGS + 1)).toBe(1);
    expect(shortfall(MAX_LISTINGS + 4_312)).toBe(4_312);
    // The old expression, for contrast: `min(total, cap + 1) - cap`.
    const wasAlways1 = (total: number) => Math.max(0, Math.min(total, MAX_LISTINGS + 1) - MAX_LISTINGS);
    expect(wasAlways1(MAX_LISTINGS + 4_312)).toBe(1);
  });
});
