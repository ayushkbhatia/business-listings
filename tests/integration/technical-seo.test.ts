import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { createAlert, sweepAlerts, tokensOf } from "@/lib/alerts/service";
import { addressesFor, deleteCategory, renameCategory } from "@/lib/taxonomy/rename";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Handoff 5, step 6 — the technical layer.
 *
 * Criterion 7 (301s on a rename, and no delete without one) and criterion 8
 * (the zero-result alert). Criterion 5 is markup and criterion 6 is a header,
 * so both are asserted in `tests/e2e/technical-seo.spec.ts` where a browser can
 * see them.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

const PREFIX = "tech-test-";
let opsLeadId: string;
let areaId: string;
let seq = 0;

function stamp() {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

async function removeFixtures() {
  await prisma.productAlert.deleteMany({ where: { query: { startsWith: "alerttest" } } });
  await prisma.product.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.redirect.deleteMany({ where: { fromPath: { contains: PREFIX } } });
  await prisma.areaPage.deleteMany({ where: { category: { slug: { startsWith: PREFIX } } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX }, parentId: { not: null } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { fullName: { startsWith: "Alert Test" } } });
}

const lead = () => actor(opsLeadId, "staff_ops_lead");

beforeAll(async () => {
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      select: { id: true },
    })
  ).id;
  areaId = (
    await prisma.area.findFirstOrThrow({ where: { emirate: "dubai" }, select: { id: true } })
  ).id;
  await removeFixtures();
}, 120_000);

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

describe("criterion 7 — a rename produces working 301s", () => {
  it("moves the sector, every subcategory under it, and its area pages", async () => {
    /*
       The part that is easy to get wrong. `/c/:category/:sub` carries the
       parent's slug, so renaming a sector moves every child address too — and a
       rename that moved the sector page and left 418 subcategory addresses
       dangling would be worse than no rename at all.
    */
    const sector = await prisma.category.create({
      data: { name: "Tech Sector", slug: `${PREFIX}sector-${stamp()}`, code: "TS", sortOrder: 99 },
      select: { id: true, slug: true },
    });
    const child = await prisma.category.create({
      data: {
        parentId: sector.id,
        name: "Tech Child",
        slug: `${PREFIX}child-${stamp()}`,
        code: "TC",
        sortOrder: 99,
      },
      select: { id: true, slug: true },
    });
    await prisma.areaPage.create({
      data: { areaId, categoryId: sector.id, intro: "Something.", publishedAt: new Date() },
    });

    const target = `${PREFIX}renamed-${stamp()}`;
    const pairs = await addressesFor(sector.id, target);
    expect(pairs.map((pair) => pair.from)).toContain(`/c/${sector.slug}`);
    expect(pairs.map((pair) => pair.from)).toContain(`/c/${sector.slug}/${child.slug}`);
    expect(pairs.some((pair) => pair.from.endsWith(`/${sector.slug}`) && pair.from.startsWith("/dubai/"))).toBe(true);

    const result = await renameCategory(lead(), sector.id, target, "Trade renamed after the merger.");
    expect(result.ok).toBe(true);

    for (const pair of pairs) {
      const row = await prisma.redirect.findUnique({ where: { fromPath: pair.from } });
      expect(row, `no redirect from ${pair.from}`).not.toBeNull();
      expect(row?.toPath).toBe(pair.to);
      expect(row?.statusCode).toBe(301);
    }

    expect((await prisma.category.findUniqueOrThrow({ where: { id: sector.id } })).slug).toBe(target);
  }, 180_000);

  it("does not leave a chain when a category is renamed twice", async () => {
    /*
       A chain is two hops for a visitor and a discount for a crawler. The
       second rename has to repoint the first redirect, not stack on it.
    */
    const category = await prisma.category.create({
      data: { name: "Tech Twice", slug: `${PREFIX}one-${stamp()}`, code: "TW", sortOrder: 99 },
      select: { id: true, slug: true },
    });
    const first = category.slug;
    const second = `${PREFIX}two-${stamp()}`;
    const third = `${PREFIX}three-${stamp()}`;

    expect((await renameCategory(lead(), category.id, second, "First rename.")).ok).toBe(true);
    expect((await renameCategory(lead(), category.id, third, "Second rename.")).ok).toBe(true);

    // The original address goes straight to the newest one.
    const original = await prisma.redirect.findUnique({ where: { fromPath: `/c/${first}` } });
    expect(original?.toPath).toBe(`/c/${third}`);
    // And there is no hop that lands on an address that itself redirects.
    const all = await prisma.redirect.findMany({ where: { fromPath: { contains: PREFIX } } });
    for (const row of all) {
      const onward = await prisma.redirect.findUnique({ where: { fromPath: row.toPath } });
      expect(onward, `${row.fromPath} redirects to ${row.toPath}, which redirects again`).toBeNull();
    }
  }, 180_000);

  it("refuses an address another trade already has, and a malformed one", async () => {
    const taken = await prisma.category.findFirstOrThrow({ select: { slug: true } });
    const category = await prisma.category.create({
      data: { name: "Tech Clash", slug: `${PREFIX}clash-${stamp()}`, code: "TX", sortOrder: 99 },
      select: { id: true },
    });

    expect(await renameCategory(lead(), category.id, taken.slug, "Trying a taken one.")).toMatchObject({
      ok: false,
      error: "slug_taken",
    });
    expect(await renameCategory(lead(), category.id, "Not A Slug", "Trying a bad one.")).toMatchObject({
      ok: false,
      error: "slug_taken",
    });
  }, 120_000);
});

describe("criterion 7 — deleting a page without a redirect is blocked", () => {
  it("refuses while children, listings or published pages depend on it", async () => {
    const sector = await prisma.category.create({
      data: { name: "Tech Parent", slug: `${PREFIX}parent-${stamp()}`, code: "TP", sortOrder: 99 },
      select: { id: true },
    });
    const child = await prisma.category.create({
      data: {
        parentId: sector.id,
        name: "Tech Kid",
        slug: `${PREFIX}kid-${stamp()}`,
        code: "TK",
        sortOrder: 99,
      },
      select: { id: true },
    });

    // Children.
    expect(await deleteCategory(lead(), sector.id, "Tidying up.")).toMatchObject({
      ok: false,
      error: "would_orphan",
    });

    // Listings.
    const business = await prisma.business.create({
      data: {
        tradeName: `Tech Test ${stamp()}`,
        displayName: "Tech Test",
        slug: `${PREFIX}biz-${stamp()}`,
        licenceNumber: `DED-TT${stamp().slice(-6)}`,
        licenceAuthority: "DED",
        licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
        primaryCategoryId: child.id,
        claimStatus: "unclaimed",
        publishedAt: new Date(),
      },
      select: { id: true },
    });
    expect(await deleteCategory(lead(), child.id, "Tidying up.")).toMatchObject({
      ok: false,
      error: "would_orphan",
    });

    // A published area page.
    await prisma.business.delete({ where: { id: business.id } });
    await prisma.areaPage.create({
      data: { areaId, categoryId: child.id, intro: "Something.", publishedAt: new Date() },
    });
    expect(await deleteCategory(lead(), child.id, "Tidying up.")).toMatchObject({
      ok: false,
      error: "would_orphan",
    });
  }, 180_000);

  it("writes the redirect before it deletes, once nothing depends on it", async () => {
    const sector = await prisma.category.create({
      data: { name: "Tech Solo", slug: `${PREFIX}solo-${stamp()}`, code: "TL", sortOrder: 99 },
      select: { id: true, slug: true },
    });

    expect((await deleteCategory(lead(), sector.id, "Never used, folded into another trade.")).ok).toBe(true);

    const row = await prisma.redirect.findUnique({ where: { fromPath: `/c/${sector.slug}` } });
    expect(row, "the address was deleted without a redirect").not.toBeNull();
    expect(row?.toPath).toBe("/categories");
    expect(await prisma.category.findUnique({ where: { id: sector.id } })).toBeNull();
  }, 120_000);
});

describe("criterion 8 — a zero-result alert fires when a match is listed", () => {
  let categoryId: string;
  let businessId: string;

  beforeAll(async () => {
    categoryId = (
      await prisma.category.create({
        data: { name: "Tech Alerts", slug: `${PREFIX}alerts-${stamp()}`, code: "TA", sortOrder: 99 },
        select: { id: true },
      })
    ).id;
    businessId = (
      await prisma.business.create({
        data: {
          tradeName: `Alert Supplier ${stamp()}`,
          displayName: "Alert Supplier",
          slug: `${PREFIX}supplier-${stamp()}`,
          licenceNumber: `DED-AL${stamp().slice(-6)}`,
          licenceAuthority: "DED",
          licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
          primaryCategoryId: categoryId,
          claimStatus: "claimed",
          publishedAt: new Date(),
          locations: {
            create: {
              type: "trade_counter",
              emirate: "dubai",
              areaId,
              addressLine: "Unit 5",
              published: true,
            },
          },
        },
        select: { id: true },
      })
    ).id;
  }, 120_000);

  async function alertFor(query: string) {
    const result = await createAlert({
      query,
      categoryId,
      contact: `05${Math.floor(10_000_000 + seq * 7919 + Math.floor(Date.now() % 1_000_000))}`.slice(0, 10),
      fullName: `Alert Test ${stamp()}`,
    });
    return result;
  }

  it("takes a contact and mints a provisional identity, because most have no account", async () => {
    const result = await alertFor("alerttest stainless dn100 valve");
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
  }, 120_000);

  it("does not fire on a product that was already there", async () => {
    /*
       The point is that something changed. A product listed before the alert is
       one the search should have found, and telling them now would admit the
       search was wrong rather than that the market moved.
    */
    await prisma.product.create({
      data: {
        businessId,
        categoryId,
        name: "Older stainless valve",
        slug: `${PREFIX}old-${stamp()}`,
        status: "live",
        availability: "in_stock",
        searchText: "alerttest stainless dn100 valve older",
        createdAt: new Date(Date.now() - 86_400_000),
      },
    });

    const result = await sweepAlerts();
    expect(result.fired.some((f) => f.query.includes("alerttest stainless"))).toBe(false);
  }, 120_000);

  it("does not fire on a product that matches only some of the words", async () => {
    await prisma.product.create({
      data: {
        businessId,
        categoryId,
        name: "Plastic elbow",
        slug: `${PREFIX}elbow-${stamp()}`,
        status: "live",
        availability: "in_stock",
        // Shares "alerttest" and "valve" but not "stainless" or "dn100".
        searchText: "alerttest plastic elbow valve",
      },
    });

    const result = await sweepAlerts();
    expect(result.fired.some((f) => f.query.includes("alerttest stainless"))).toBe(false);
  }, 120_000);

  it("fires exactly once when a real match is listed", async () => {
    const product = await prisma.product.create({
      data: {
        businessId,
        categoryId,
        name: "Stainless gate valve DN100 UL/FM",
        slug: `${PREFIX}match-${stamp()}`,
        status: "live",
        availability: "in_stock",
        searchText: "alerttest stainless dn100 valve ul fm gate",
      },
      select: { id: true },
    });

    const first = await sweepAlerts();
    const hit = first.fired.find((f) => f.query.includes("alerttest stainless"));
    expect(hit, "the alert did not fire on a matching product").toBeDefined();
    expect(hit?.productId).toBe(product.id);

    const row = await prisma.productAlert.findUniqueOrThrow({ where: { id: hit!.alertId } });
    expect(row.notifiedAt).not.toBeNull();
    expect(row.matchedProductId).toBe(product.id);

    // A second notification for the same alert is a subscription nobody asked
    // for. The sweep is idempotent.
    const second = await sweepAlerts();
    expect(second.fired.some((f) => f.alertId === hit!.alertId)).toBe(false);
  }, 180_000);

  it("refuses an alert with nothing to watch for", async () => {
    expect(await createAlert({ query: "a", contact: "0501234567" })).toMatchObject({
      ok: false,
      error: "query_too_short",
    });
  }, 120_000);

  it("refuses an alert with nowhere to send it", async () => {
    expect(await createAlert({ query: "alerttest something real" })).toMatchObject({
      ok: false,
      error: "no_identity",
    });
  }, 120_000);
});

describe("the matcher's tokens", () => {
  it("drops words short enough to appear in anything", () => {
    // A query that matched on "in" or "a" would match everything, and the first
    // false alert is the one that loses the buyer.
    expect(tokensOf("a valve in stock")).toEqual(["valve", "stock"]);
  });

  it("keeps a short standard the buyer wrote in capitals", () => {
    /*
       Length alone is the wrong rule for this trade. "UL" and "FM" are two
       characters and carry more meaning than anything else in the sentence — an
       alert that dropped them would match any stainless DN100, which is exactly
       the false positive the conservative match exists to avoid.
    */
    // `4"` survives too, and should: a nominal size is the most specific thing
    // in the sentence. It is the reason `docs/database.md` chose trigram search
    // over full text — `4"` is not a legal tsquery at all.
    expect(tokensOf('stainless DN100 UL/FM 4"')).toEqual([
      "stainless",
      "dn100",
      "ul",
      "fm",
      '4"',
    ]);
  });

  it("still drops a short lowercase word", () => {
    expect(tokensOf("valves in stock")).toEqual(["valves", "stock"]);
  });
});
