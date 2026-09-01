import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { detectIdentityLeak } from "@/lib/enquiry/redaction";
/*
   The uncached readers, not the cached exports the page uses.

   `unstable_cache` reaches for Next's incremental cache and throws outside a
   request context, so these are the only versions callable from node — and
   they are the right target: these tests are about the selection rules, and a
   cached read would answer from a previous test's fixtures anyway.
*/
import {
  readEmirateChips as getEmirateChips,
  readHomePlans as getHomePlans,
  readHomeSectors as getHomeSectors,
  readHomeStats as getHomeStats,
  readNewCatalogueProducts as getNewCatalogueProducts,
  readOpenRfqTeasers as getOpenRfqTeasers,
  readPopularQueries as getPopularQueries,
  readRecentlyVerified as getRecentlyVerified,
} from "@/lib/db/queries/home";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * Board 1a's acceptance criteria, against a real database.
 *
 * These are the ones that cannot be checked from the markup: whether a count
 * came from a query, whether a section dropped rather than padded, whether the
 * RFQ panel is capable of leaking a buyer. Each `it` names the criterion it
 * covers, because in six months the rule is what matters and not the assertion.
 */

const PREFIX = "home-test-";

async function removeFixtures() {
  await prisma.enquiry.deleteMany({ where: { ref: { startsWith: "ENQ-HOMETEST" } } });
  await prisma.searchQueryLog.deleteMany({ where: { query: { startsWith: PREFIX } } });
}

afterAll(removeFixtures);

describe("criterion 1 — every count comes from a query", () => {
  it("counts listings, sectors and subcategories against the tables", async () => {
    const stats = await getHomeStats();

    const [listings, sectors, subcategories] = await Promise.all([
      prisma.business.count({ where: { suspendedAt: null, publishedAt: { not: null } } }),
      prisma.category.count({ where: { parentId: null } }),
      prisma.category.count({ where: { parentId: { not: null } } }),
    ]);

    expect(stats.listings).toBe(listings);
    expect(stats.sectors).toBe(sectors);
    expect(stats.subcategories).toBe(subcategories);
    // The whole proposition is that we know what is out there. A zero here
    // would mean the page is telling a visitor the directory is empty.
    expect(stats.listings).toBeGreaterThan(0);
  });

  it("never counts a suspended or unpublished listing", async () => {
    const before = await getHomeStats();
    const victim = await prisma.business.findFirstOrThrow({
      where: { suspendedAt: null, publishedAt: { not: null } },
      select: { id: true, suspendedAt: true },
    });
    await prisma.business.update({ where: { id: victim.id }, data: { suspendedAt: new Date() } });
    try {
      expect((await getHomeStats()).listings).toBe(before.listings - 1);
    } finally {
      await prisma.business.update({ where: { id: victim.id }, data: { suspendedAt: null } });
    }
  });
});

describe("criteria 2 and 3 — the open-requests panel", () => {
  it("shows no requirement that identifies anybody", async () => {
    const rows = await getOpenRfqTeasers();
    for (const row of rows) {
      expect(detectIdentityLeak(row.requirement).leaks, row.requirement).toBe(false);
    }
  });

  it("suppresses a requirement carrying a phone number or a company name", async () => {
    const buyer = await prisma.user.findFirstOrThrow({
      where: { roles: { has: "buyer" } },
      select: { id: true },
    });
    const seller = await prisma.business.findFirstOrThrow({
      where: { claimStatus: "claimed", suspendedAt: null, publishedAt: { not: null } },
      select: { id: true },
    });

    // Newer than anything the seed made, so it is inside the four the panel
    // reads. If suppression were off, this is the row that would show.
    const leaky = await prisma.enquiry.create({
      data: {
        ref: "ENQ-HOMETEST-1",
        buyerId: buyer.id,
        requirement: "Gate valves DN100. Call Ahmed on 0506412288, Gulf Crest Trading LLC.",
        closesAt: new Date(Date.now() + 7 * 24 * 3_600_000),
        createdAt: new Date(),
      },
    });
    await prisma.enquiryRecipient.create({
      data: { enquiryId: leaky.id, businessId: seller.id, state: "delivered" },
    });

    const rows = await getOpenRfqTeasers();
    expect(rows.map((row) => row.id)).not.toContain(leaky.id);
  });

  it("carries no buyer identity at any granularity finer than an emirate", async () => {
    const rows = await getOpenRfqTeasers();
    expect(rows.length).toBeGreaterThan(0);

    /*
       A shape assertion, not a spot check. The panel's protection is that the
       query selects no buyer column at all, so the way to prove it is to show
       there is no field here that could hold one — every key is accounted for.
    */
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "categoryName",
        "createdAt",
        "emirate",
        "id",
        "quoteCount",
        "requirement",
      ]);
      // An emirate or nothing. Never an area, never a free-text address.
      if (row.emirate !== null) {
        expect(await prisma.area.count({ where: { name: row.emirate } })).toBe(0);
      }
    }
  });

  it("never pads, and never returns more than it was asked for", async () => {
    expect((await getOpenRfqTeasers(2)).length).toBeLessThanOrEqual(2);
    // Asking for more than exists returns what exists rather than filler.
    const many = await getOpenRfqTeasers(4);
    const open = await prisma.enquiry.count({ where: { closesAt: { gt: new Date() } } });
    expect(many.length).toBeLessThanOrEqual(Math.min(4, open));
  });

  it("shows nothing that has not been sent yet", async () => {
    /*
       `closesAt` and `createdAt` are different dates and only one of them says
       the request has been made. A future `createdAt` renders as "in 11 h ago"
       under a heading that says LIVE — reachable whenever a clock is skewed or
       a fixture is dated ahead, which the seed's noon-today clock does on any
       run before midday.
    */
    const buyer = await prisma.user.findFirstOrThrow({
      where: { roles: { has: "buyer" } },
      select: { id: true },
    });
    const seller = await prisma.business.findFirstOrThrow({
      where: { claimStatus: "claimed", suspendedAt: null, publishedAt: { not: null } },
      select: { id: true },
    });
    const future = await prisma.enquiry.create({
      data: {
        ref: "ENQ-HOMETEST-2",
        buyerId: buyer.id,
        requirement: "Ducting for a riser, drawn and installed.",
        closesAt: new Date(Date.now() + 30 * 24 * 3_600_000),
        createdAt: new Date(Date.now() + 6 * 3_600_000),
      },
    });
    await prisma.enquiryRecipient.create({
      data: { enquiryId: future.id, businessId: seller.id, state: "delivered" },
    });

    const rows = await getOpenRfqTeasers();
    expect(rows.map((row) => row.id)).not.toContain(future.id);
    for (const row of rows) {
      expect(row.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
    }
  });

  it("reports a real quote count", async () => {
    for (const row of await getOpenRfqTeasers()) {
      expect(row.quoteCount).toBe(await prisma.quote.count({ where: { enquiryId: row.id } }));
    }
  });
});

describe("criterion 4 — verified this week", () => {
  it("contains only businesses whose tier actually rose", async () => {
    const rows = await getRecentlyVerified();

    for (const business of rows) {
      const events = await prisma.auditEvent.findMany({
        where: { action: "tier_change", subject: `Business:${business.id}` },
      });
      const rose = events.some((event) => {
        const before = (event.before as { verificationTier?: number } | null)?.verificationTier;
        const after = (event.after as { verificationTier?: number } | null)?.verificationTier;
        return typeof before === "number" && typeof after === "number" && after > before;
      });
      expect(rose, business.displayName).toBe(true);
    }
  });

  it("is ordered by tier descending — a site visit outranks a licence check", async () => {
    const tiers = (await getRecentlyVerified()).map((row) => row.verificationTier);
    expect([...tiers].sort((a, b) => b - a)).toEqual(tiers);
  });

  it("returns nothing rather than reaching into general listings", async () => {
    /*
       The failure this guards against is the tempting one: fill the row from
       `getFeaturedBusinesses` when the window is thin. With every tier_change
       row gone there is no candidate, and the correct answer is an empty array
       — the page drops the whole section.
    */
    const saved = await prisma.auditEvent.findMany({ where: { action: "tier_change" } });
    await prisma.auditEvent.deleteMany({ where: { action: "tier_change" } });
    try {
      expect(await getRecentlyVerified()).toEqual([]);
    } finally {
      for (const event of saved) {
        await prisma.auditEvent.create({
          data: {
            id: event.id,
            actorId: event.actorId,
            action: event.action,
            subject: event.subject,
            reason: event.reason,
            before: event.before ?? undefined,
            after: event.after ?? undefined,
            createdAt: event.createdAt,
          },
        });
      }
    }
  });
});

describe("criterion 5 — no product on this page renders a price", () => {
  it("selects no price, because there is no price column to select", async () => {
    const products = await getNewCatalogueProducts();
    for (const product of products) {
      expect(Object.keys(product)).not.toContain("price");
      expect(Object.keys(product)).not.toContain("unitPrice");
    }
  });

  it("takes products only from verified sellers, one per seller", async () => {
    const products = await getNewCatalogueProducts();
    const sellers = products.map((product) => product.businessId);
    expect(new Set(sellers).size).toBe(sellers.length);
    for (const product of products) {
      expect(product.business.verificationTier).toBeGreaterThanOrEqual(VERIFIED_TIER);
    }
  });
});

describe("criterion 6 — plan prices match the Plan table", () => {
  it("reads every tile from a row, so the band cannot drift from /pricing", async () => {
    const plans = await getHomePlans();
    expect(plans.length).toBeGreaterThan(0);
    for (const plan of plans) {
      const row = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
      expect(plan.monthlyPriceAed).toBe(row.monthlyPriceAed);
      expect(plan.name).toBe(row.name);
    }
  });
});

describe("criterion 7 — a category card shows its four largest subcategories", () => {
  it("picks by listing count, not alphabetically", async () => {
    const sectors = await getHomeSectors();
    expect(sectors.length).toBeGreaterThan(0);

    for (const sector of sectors) {
      expect(sector.topSubcategories.length).toBeLessThanOrEqual(4);

      const children = await prisma.category.findMany({
        where: { parentId: sector.id },
        select: {
          name: true,
          _count: {
            select: { primaryFor: { where: { suspendedAt: null, publishedAt: { not: null } } } },
          },
        },
      });
      const largest = children
        .filter((child) => child._count.primaryFor > 0)
        .sort((a, b) => b._count.primaryFor - a._count.primaryFor || a.name.localeCompare(b.name))
        .slice(0, 4)
        .map((child) => child.name);

      expect(sector.topSubcategories).toEqual(largest);
    }
  });

  it("orders the grid by listing count descending", async () => {
    const counts = (await getHomeSectors()).map((sector) => sector.listings);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it("counts a sector's own listings plus its subcategories'", async () => {
    // Half the seed is filed under a subcategory. Counting `primaryFor` alone
    // would show HVAC as a third of its real size, and the number beside the
    // name is the one thing on the card a buyer can check.
    for (const sector of await getHomeSectors()) {
      const own = await prisma.business.count({
        where: {
          primaryCategoryId: sector.id,
          suspendedAt: null,
          publishedAt: { not: null },
        },
      });
      const nested = await prisma.business.count({
        where: {
          primaryCategory: { parentId: sector.id },
          suspendedAt: null,
          publishedAt: { not: null },
        },
      });
      expect(sector.listings).toBe(own + nested);
    }
  });
});

describe("the emirate row", () => {
  it("names all seven, including the ones at zero", async () => {
    const { chips } = await getEmirateChips();
    expect(chips).toHaveLength(7);
    // A country does not lose an emirate because nobody has signed up there.
    expect(new Set(chips.map((chip) => chip.emirate))).toEqual(
      new Set([
        "dubai",
        "abu_dhabi",
        "sharjah",
        "ajman",
        "ras_al_khaimah",
        "fujairah",
        "umm_al_quwain",
      ]),
    );
  });

  it("counts free zones separately rather than as an eighth emirate", async () => {
    const { chips, freeZone } = await getEmirateChips();
    expect(freeZone).toBe(
      await prisma.business.count({
        where: {
          suspendedAt: null,
          publishedAt: { not: null },
          locations: { some: { published: true, area: { isFreeZone: true } } },
        },
      }),
    );
    // A JAFZA company is in Dubai *and* in a free zone, so the free-zone total
    // is not disjoint from the emirate counts and must not be summed with them.
    expect(chips.some((chip) => String(chip.emirate) === "free_zone")).toBe(false);
  });
});

describe("the popular-search chips", () => {
  it("offers only terms that returned something", async () => {
    await prisma.searchQueryLog.createMany({
      data: Array.from({ length: 200 }, () => ({
        query: `${PREFIX}dead term`,
        normalised: `${PREFIX}dead term`,
        resultCount: 0,
        tab: "businesses",
      })),
    });
    try {
      // Two hundred rows is more than any real term in the seed, so if the
      // filter were off this would be the first chip on the home page.
      expect(await getPopularQueries()).not.toContain(`${PREFIX}dead term`);
    } finally {
      await prisma.searchQueryLog.deleteMany({ where: { query: { startsWith: PREFIX } } });
    }
  });

  it("groups spellings together and renders one of them", async () => {
    await prisma.searchQueryLog.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({
        query: i % 2 === 0 ? `${PREFIX}Gate Valve` : `${PREFIX}gate valve`,
        normalised: `${PREFIX}gate valve`,
        resultCount: 5,
        tab: "businesses",
      })),
    });
    try {
      const chips = await getPopularQueries();
      const matching = chips.filter((chip) => chip.toLowerCase() === `${PREFIX}gate valve`);
      // One chip, not two. Grouping on the raw text would split the term
      // across its capitalisations and neither half would rank.
      expect(matching).toHaveLength(1);
    } finally {
      await prisma.searchQueryLog.deleteMany({ where: { query: { startsWith: PREFIX } } });
    }
  });

  it("returns nothing on a fresh install, so the page can fall back", async () => {
    const saved = await prisma.searchQueryLog.findMany();
    await prisma.searchQueryLog.deleteMany();
    try {
      expect(await getPopularQueries()).toEqual([]);
    } finally {
      if (saved.length > 0) await prisma.searchQueryLog.createMany({ data: saved });
    }
  });
});
