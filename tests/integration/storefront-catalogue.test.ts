import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { sweepAlerts, watchProduct } from "@/lib/alerts/service";
import {
  freshStock,
  getCatalogueView,
  isFiltered,
  parseCatalogueQuery,
  toCatalogueParams,
  CATALOGUE_PAGE_SIZE,
  STOCK_FRESH_DAYS,
  type CatalogueQuery,
} from "@/lib/db/queries";

/**
 * Board 1e's catalogue query, against a real seller.
 *
 * The rail is the part worth testing at this layer: a facet that counts itself
 * out of existence is the classic mistake, and it is invisible until somebody
 * ticks a box and the other options all read zero.
 */

const query = (over: Partial<CatalogueQuery> = {}): CatalogueQuery => ({
  q: "",
  availability: [],
  spec: {},
  sort: "availability",
  page: 1,
  ...over,
});

async function seller() {
  return prisma.business.findFirstOrThrow({
    where: { products: { some: { status: { not: "draft" } } } },
    select: { id: true, slug: true },
    orderBy: { products: { _count: "desc" } },
  });
}

afterAll(() => prisma.$disconnect());

describe("the query string", () => {
  it("treats anything unreserved as a spec facet", () => {
    // The rail is generated from the template, so the query string is open the
    // same way — a new filterable field must not need a change here.
    const parsed = parseCatalogueQuery({ f_size: "DN100", sort: "name" });
    expect(parsed.spec).toEqual({ f_size: ["DN100"] });
    expect(parsed.sort).toBe("name");
  });

  it("falls back rather than 404s on an unknown sort", () => {
    expect(parseCatalogueQuery({ sort: "price" }).sort).toBe("availability");
  });

  it("keeps defaults out of the URL", () => {
    // Or the unfiltered catalogue's canonical would differ from the page.
    expect(toCatalogueParams(query())).toBe("");
  });

  it("survives a round trip", () => {
    const original = query({ subcategory: "gate-valves", availability: ["in_stock"], sort: "name", page: 3 });
    const parsed = parseCatalogueQuery(
      Object.fromEntries(new URLSearchParams(toCatalogueParams(original))),
    );
    expect(parsed).toMatchObject({
      subcategory: "gate-valves",
      availability: ["in_stock"],
      sort: "name",
      page: 3,
    });
  });

  it("counts the store search as a filter", () => {
    // Criterion 11 hangs off this too: a search result inside one catalogue is
    // not a page worth indexing separately from the catalogue.
    expect(isFiltered(query({ q: "valve" }))).toBe(true);
  });

  it("knows when a view is filtered", () => {
    // Criterion 11 hangs off this: a filtered view is noindex and canonicalises
    // to the unfiltered catalogue.
    expect(isFiltered(query())).toBe(false);
    expect(isFiltered(query({ sort: "name", page: 4 }))).toBe(false);
    expect(isFiltered(query({ availability: ["in_stock"] }))).toBe(true);
    expect(isFiltered(query({ spec: { f: ["x"] } }))).toBe(true);
  });
});

describe("freshStock", () => {
  const now = new Date("2026-09-03T00:00:00Z");
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);

  it("states a recent count", () => {
    expect(freshStock(240, daysAgo(3), now)).toBe(240);
  });

  it("withholds one that has gone stale", () => {
    // Criterion 8. "240 units" from three months ago is a promise the seller
    // never made; the band alone is true.
    expect(freshStock(240, daysAgo(STOCK_FRESH_DAYS + 1), now)).toBeNull();
  });

  it("treats never-recorded and stale the same", () => {
    // They mean the same thing to a buyer: we cannot tell you a number.
    expect(freshStock(240, null, now)).toBeNull();
    expect(freshStock(null, daysAgo(1), now)).toBeNull();
  });
});

describe("the rail", () => {
  it("counts a facet's own options with that facet's filter removed", async () => {
    /*
     * The mistake this guards. Tick "in stock" and, if the availability counts
     * were computed under that filter, every other band reads zero and the rail
     * stops being a way to change your mind.
     */
    const shop = await seller();
    const unfiltered = await getCatalogueView(shop.id, query());
    const bands = unfiltered.availability.filter((facet) => facet.count > 0);
    if (bands.length < 2) return; // Nothing to prove on a single-band catalogue.

    const filtered = await getCatalogueView(
      shop.id,
      query({ availability: [bands[0]!.value] }),
    );

    const before = new Map(unfiltered.availability.map((f) => [f.value, f.count]));
    for (const facet of filtered.availability) {
      expect(facet.count, `${facet.value} was counted under its own filter`).toBe(
        before.get(facet.value),
      );
    }
    // And the results really did narrow.
    expect(filtered.total).toBeLessThan(unfiltered.total);
  }, 60_000);

  it("counts subcategories without the subcategory filter applied", async () => {
    // A buyer in "Gate valves" still needs to see how many butterfly valves
    // there are, or they cannot switch to them.
    const shop = await seller();
    const all = await getCatalogueView(shop.id, query());
    if (all.subcategories.length < 2) return;

    const narrowed = await getCatalogueView(
      shop.id,
      query({ subcategory: all.subcategories[0]!.slug }),
    );
    expect(narrowed.subcategories.map((s) => s.slug).sort()).toEqual(
      all.subcategories.map((s) => s.slug).sort(),
    );
  }, 60_000);

  it("shows the platform label, never a seller's rename", async () => {
    /*
     * Criterion 5. If one seller calls it "Bore" and another "Nominal size",
     * the filter stops meaning one thing across the directory.
     */
    const shop = await seller();
    const view = await getCatalogueView(shop.id, query());
    if (view.specFilters.length === 0) return;

    const platform = await prisma.specField.findMany({
      where: { id: { in: view.specFilters.map((f) => f.fieldId) } },
      select: { id: true, label: true },
    });
    const labelById = new Map(platform.map((f) => [f.id, f.label]));
    for (const filter of view.specFilters) {
      expect(filter.label).toBe(labelById.get(filter.fieldId));
    }
  }, 60_000);

  it("offers no filter with fewer than two options", async () => {
    // A filter with one option is not a choice.
    const shop = await seller();
    const view = await getCatalogueView(shop.id, query());
    for (const filter of view.specFilters) {
      expect(filter.options.length, filter.label).toBeGreaterThan(1);
    }
  }, 60_000);
});

describe("the grid", () => {
  it("orders availability the way the board reads it", async () => {
    const shop = await seller();
    const view = await getCatalogueView(shop.id, query({ sort: "availability" }));
    const rank = ["in_stock", "made_to_order", "indent", "out_of_stock"];
    const seen = view.products.map((p) => rank.indexOf(p.availability));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  }, 60_000);

  it("pages at 24 and does not repeat a product across pages", async () => {
    const shop = await seller();
    const first = await getCatalogueView(shop.id, query({ page: 1 }));
    expect(first.products.length).toBeLessThanOrEqual(CATALOGUE_PAGE_SIZE);
    if (first.total <= CATALOGUE_PAGE_SIZE) return;

    const second = await getCatalogueView(shop.id, query({ page: 2 }));
    const overlap = first.products
      .map((p) => p.id)
      .filter((id) => second.products.some((p) => p.id === id));
    expect(overlap).toEqual([]);
  }, 60_000);

  it("never reaches outside the seller it was asked about", async () => {
    // The whole page is one buyer in front of one supplier. A query that could
    // cross that boundary would put somebody else's stock in the list they are
    // about to enquire about.
    const shop = await seller();
    const view = await getCatalogueView(shop.id, query());
    const ids = view.products.map((p) => p.id);
    if (ids.length === 0) return;

    const foreign = await prisma.product.count({
      where: { id: { in: ids }, NOT: { businessId: shop.id } },
    });
    expect(foreign).toBe(0);
  }, 60_000);
});

describe("criterion 7 — a restock watch is about one product", () => {
  const made: string[] = [];
  afterAll(async () => {
    if (made.length > 0) {
      await prisma.productAlert.deleteMany({ where: { id: { in: made } } });
    }
  });

  async function buyer() {
    const user = await prisma.user.findFirstOrThrow({ select: { id: true } });
    return user.id;
  }

  it("watches a product without inventing a search nobody made", async () => {
    /*
     * The query column means "the words the buyer typed", and the gap report
     * counts it as demand expressed through search. Putting the product's name
     * there to satisfy the old constraint would have been a lie in a table
     * somebody reports from.
     */
    const product = await watchable();
    const result = await watchProduct({ productId: product.id, userId: await buyer() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    made.push(result.alertId);

    const row = await prisma.productAlert.findUniqueOrThrow({
      where: { id: result.alertId },
      select: { query: true, productId: true, notifiedAt: true },
    });
    expect(row.query).toBe("");
    expect(row.productId).toBe(product.id);
    expect(row.notifiedAt).toBeNull();
  }, 60_000);

  /**
   * A product a buyer could actually watch, picked deterministically.
   *
   * `findFirstOrThrow` on `status: { not: "draft" }` with no `orderBy` returns
   * whatever Postgres hands back first, and the seed deliberately suspends one
   * listing — so on some orderings these tests asked for a watch on a suspended
   * business and `watchProduct` correctly refused. Ordering by id makes the
   * choice stable, and the filter matches the one the service applies.
   */
  const watchable = () =>
    prisma.product.findFirstOrThrow({
      where: {
        status: { not: "draft" },
        business: { suspendedAt: null, publishedAt: { not: null } },
      },
      orderBy: { id: "asc" },
      select: { id: true },
    });

  it("is idempotent — pressing it twice is not two messages", async () => {
    const product = await watchable();
    const userId = await buyer();
    const first = await watchProduct({ productId: product.id, userId });
    const second = await watchProduct({ productId: product.id, userId });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.alertId).toBe(first.alertId);
      made.push(first.alertId);
    }
  }, 60_000);

  it("refuses a product that is no longer listed", async () => {
    const result = await watchProduct({ productId: "does-not-exist", userId: await buyer() });
    expect(result).toMatchObject({ ok: false, error: "not_found" });
  }, 60_000);

  it("fires when the line comes back, and only then", async () => {
    /*
     * The sweep used to skip any alert with no query tokens, so a watch would
     * have sat open forever. This is the branch that fixes it.
     */
    /*
       Constrained and ordered, because it was neither.

       `watchProduct` refuses `not_found` when the product's business is
       suspended or unpublished, and this picked the first live in-stock product
       with no `orderBy` — an arbitrary row, because Postgres returns heap order
       for an unordered `findFirst` and the seed writes most products in one
       `createMany` with one timestamp. Other files in this suite suspend
       businesses. So whether this test passed depended on which row the heap
       happened to hand back, and any change to the database's write history
       could flip it. It has now failed twice that way, in two different
       sessions, on changes that touched neither products nor alerts.

       The `business` filter is the same one `watchProduct` applies, so the
       fixture cannot be a product the function under test will refuse.
    */
    const product = await prisma.product.findFirstOrThrow({
      where: {
        status: "live",
        availability: { not: "out_of_stock" },
        business: { suspendedAt: null, publishedAt: { not: null } },
      },
      orderBy: { id: "asc" },
      select: { id: true, availability: true },
    });
    const userId = await buyer();

    // Out of stock: the watch stays open.
    await prisma.product.update({
      where: { id: product.id },
      data: { availability: "out_of_stock" },
    });
    const watch = await watchProduct({ productId: product.id, userId });
    expect(watch.ok).toBe(true);
    if (!watch.ok) return;
    made.push(watch.alertId);

    await sweepAlerts(new Date());
    let row = await prisma.productAlert.findUniqueOrThrow({
      where: { id: watch.alertId },
      select: { notifiedAt: true },
    });
    expect(row.notifiedAt, "fired while still out of stock").toBeNull();

    // Back in stock: it fires.
    await prisma.product.update({
      where: { id: product.id },
      data: { availability: product.availability },
    });
    await sweepAlerts(new Date());
    row = await prisma.productAlert.findUniqueOrThrow({
      where: { id: watch.alertId },
      select: { notifiedAt: true },
    });
    expect(row.notifiedAt, "did not fire once back in stock").not.toBeNull();
  }, 120_000);
});
