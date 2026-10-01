import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import sitemap from "@/app/sitemap";
import { publiclyClaimed } from "@/lib/claims/status";
import { indexableListingWhere, unclaimedIndexable } from "@/lib/listing/index-rule";
import { nearestVerifiedInTrade, suggestionPlace, type SuggestionSubject } from "@/lib/listing/suggestions";
import { unclaimedFacts } from "@/lib/listing/unclaimed";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * Board 10g — the unclaimed composition's three reads, against a real database.
 *
 *   suggestions  13d's query: who, in what order, and never by what they paid
 *   index        the sitemap is the indexable set, and the page's own robots
 *                rule is the same rule (Q4)
 *   facts        a claim under review and a closed report, read and not stored
 *
 * Every fixture lives under one trade and three areas this file creates, so the
 * seeded directory — and sibling worktrees reseeding it — cannot add a
 * candidate the assertions did not count.
 */

const PREFIX = "unclaimed10g-";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date();

let categoryId: string;
let otherCategoryId: string;
let areaA: string;
let areaB: string;
let areaC: string;
let staffId: string;
let seq = 0;

interface Over {
  claimStatus?: "claimed" | "unclaimed" | "disputed";
  tier?: number;
  replyMs?: number | null;
  area?: string;
  emirate?: "dubai" | "sharjah";
  licence?: string;
  category?: string;
  suspended?: boolean;
  published?: boolean;
  licenceExpiry?: Date;
}

async function firm(label: string, over: Over = {}) {
  seq += 1;
  const slug = `${PREFIX}${label}-${seq}`;
  return prisma.business.create({
    data: {
      tradeName: `${label} ${seq} LLC`,
      displayName: `${label} ${seq}`,
      slug,
      licenceNumber: over.licence ?? `UNCL-${Date.now().toString(36)}-${seq}`,
      licenceAuthority: "DED",
      licenceExpiry: over.licenceExpiry ?? new Date(NOW.getTime() + 300 * DAY),
      primaryCategoryId: over.category ?? categoryId,
      claimStatus: over.claimStatus ?? "claimed",
      verificationTier: over.tier ?? VERIFIED_TIER,
      verifiedAt: (over.tier ?? VERIFIED_TIER) > 0 ? new Date(NOW.getTime() - 30 * DAY) : null,
      responseTimeMedianMs: over.replyMs === undefined ? 2 * HOUR : over.replyMs,
      publishedAt: over.published === false ? null : new Date(NOW.getTime() - 10 * DAY),
      suspendedAt: over.suspended ? new Date() : null,
      locations: {
        create: {
          type: "head_office",
          emirate: over.emirate ?? "dubai",
          areaId: over.area ?? areaA,
          addressLine: `Warehouse ${seq}`,
          published: true,
        },
      },
    },
    select: { id: true, slug: true, licenceNumber: true },
  });
}

async function removeFixtures() {
  const ids = (
    await prisma.business.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } })
  ).map((row) => row.id);
  if (ids.length > 0) {
    await prisma.placementSlot.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.listingBoost.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.supplierReport.deleteMany({ where: { subjectBusinessId: { in: ids } } });
    await prisma.claimSubmission.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.businessCategory.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.location.deleteMany({ where: { businessId: { in: ids } } });
    await prisma.business.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.area.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();
  staffId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;
  const area = (slug: string, emirate: "dubai" | "sharjah", name: string) =>
    prisma.area.create({ data: { emirate, name, slug: `${PREFIX}${slug}`, lat: 25.2, lng: 55.3 }, select: { id: true } });
  areaA = (await area("deira", "dubai", "Deira 10g")).id;
  areaB = (await area("jebel-ali", "dubai", "Jebel Ali 10g")).id;
  areaC = (await area("sajaa", "sharjah", "Al Sajaa 10g")).id;
  categoryId = (
    await prisma.category.create({
      data: { name: "Bearings 10g", slug: `${PREFIX}bearings`, code: "BG", sortOrder: 99 },
      select: { id: true },
    })
  ).id;
  otherCategoryId = (
    await prisma.category.create({
      data: { name: "Seals 10g", slug: `${PREFIX}seals`, code: "SL", sortOrder: 99 },
      select: { id: true },
    })
  ).id;
}, 120_000);

afterAll(async () => {
  await removeFixtures();
});

describe("13d's suggestion query, on 10g — B7", () => {
  let subject: SuggestionSubject;
  const names = async () =>
    (await nearestVerifiedInTrade(subject)).map((row) => row.displayName.replace(/ \d+$/, ""));

  beforeAll(async () => {
    const listing = await firm("deira-bearing-house", { claimStatus: "unclaimed", tier: 0, replyMs: null });
    subject = {
      businessId: listing.id,
      licenceNumber: listing.licenceNumber,
      primaryCategoryId: categoryId,
      areaId: areaA,
      emirate: "dubai",
    };

    // One in the listing's own area, one more in its emirate, one beyond it.
    await firm("gulf-bearing-centre", { area: areaA, replyMs: 3 * HOUR });
    await firm("al-waha", { area: areaB, replyMs: 2 * HOUR });
    await firm("sajaa-bearings", { area: areaC, emirate: "sharjah", replyMs: 1 * HOUR });

    // Every one of these would lead the panel on reply time alone.
    const fast = 30 * 60_000;
    await firm("claimed-not-verified", { tier: 1, replyMs: fast });
    await firm("unclaimed-import", { claimStatus: "unclaimed", tier: 0, replyMs: fast });
    await firm("disputed", { claimStatus: "disputed", replyMs: fast });
    await firm("never-replied", { replyMs: null });
    await firm("slower-than-a-day", { replyMs: 25 * HOUR });
    await firm("same-licence", { licence: listing.licenceNumber, replyMs: fast });
    await firm("suspended", { suspended: true, replyMs: fast });
    await firm("unpublished", { published: false, replyMs: fast });
    // Carries the trade, but is not filed under it.
    const secondary = await firm("secondary-trade", { category: otherCategoryId, replyMs: fast });
    await prisma.businessCategory.create({ data: { businessId: secondary.id, categoryId } });
  }, 120_000);

  it("widens from the area to the emirate to the UAE, then orders the panel by reply", async () => {
    // The board's own case: the Deira firm alone does not fill the panel, the
    // emirate is asked, and the faster reply leads wherever it is.
    expect(await names()).toEqual(["sajaa-bearings", "al-waha", "gulf-bearing-centre"]);
  });

  it("names the branch it was found through", async () => {
    const rows = await nearestVerifiedInTrade(subject);
    const gulf = rows.find((row) => row.slug.includes("gulf-bearing-centre"))!;
    expect(suggestionPlace(gulf, subject)?.area.name).toBe("Deira 10g");
  });

  it("stops widening once the area fills the panel — and never pays for a place in it", async () => {
    await firm("deira-four-hours", { area: areaA, replyMs: 4 * HOUR });
    const slowest = await firm("deira-five-hours", { area: areaA, replyMs: 5 * HOUR });

    /*
       The slowest of the three buys everything there is to buy for this trade
       and this emirate: a sponsored slot and a boost. 13d's footer — "not paid
       placements" — is a promise about the query, so neither may move it.
       `lib/listing/no-placement.test.ts` holds the source to the same promise.
    */
    await prisma.placementSlot.create({
      data: {
        businessId: slowest.id,
        categoryId,
        emirate: "dubai",
        monthlyPriceAed: 2_000,
        startsOn: new Date(NOW.getTime() - DAY),
      },
    });
    await prisma.listingBoost.create({
      data: {
        // One target per boost (`listing_boost_one_target`): this one is the firm.
        businessId: slowest.id,
        // The most a boost may carry (`listing_boost_points_are_bounded`).
        points: 25,
        reason: "Board 10g fixture: a boost that must not reach the suggestions.",
        expiresAt: new Date(NOW.getTime() + 30 * DAY),
        createdById: staffId,
      },
    });

    expect(await names()).toEqual(["gulf-bearing-centre", "deira-four-hours", "deira-five-hours"]);
  });

  it("is valid with one row, and removed — empty — with none", async () => {
    const lonely: SuggestionSubject = { ...subject, primaryCategoryId: otherCategoryId };
    // The secondary-trade firm is filed under seals and replies in half an hour.
    expect((await nearestVerifiedInTrade(lonely)).map((row) => row.slug)).toHaveLength(1);

    const nobody = await prisma.category.create({
      data: { name: "Nobody 10g", slug: `${PREFIX}nobody`, code: "NB", sortOrder: 99 },
      select: { id: true },
    });
    expect(await nearestVerifiedInTrade({ ...subject, primaryCategoryId: nobody.id })).toEqual([]);
  });
});

describe("Q4 — the sitemap is the indexable set", () => {
  const rows: { slug: string; indexable: boolean }[] = [];

  beforeAll(async () => {
    const lapsed = new Date(NOW.getTime() - 2 * DAY);
    const cases: [string, Over, boolean][] = [
      ["unclaimed-current", { claimStatus: "unclaimed", tier: 0 }, true],
      ["unclaimed-lapsed", { claimStatus: "unclaimed", tier: 0, licenceExpiry: lapsed }, false],
      ["unclaimed-reported", { claimStatus: "unclaimed", tier: 0 }, false],
      ["unclaimed-report-decided", { claimStatus: "unclaimed", tier: 0 }, true],
      ["disputed-current", { claimStatus: "disputed", tier: 0 }, true],
      // Claimed listings are not this rule's business.
      ["claimed-lapsed", { claimStatus: "claimed", tier: 1, licenceExpiry: lapsed }, true],
    ];
    for (const [label, over, indexable] of cases) {
      const created = await firm(label, over);
      rows.push({ slug: created.slug, indexable });
      if (label === "unclaimed-reported" || label === "unclaimed-report-decided") {
        await prisma.supplierReport.create({
          data: {
            subjectBusinessId: created.id,
            kind: "closed",
            subjectField: "licence",
            ...(label === "unclaimed-report-decided"
              ? { outcome: "no_action", outcomeReason: "Still trading.", resolvedAt: new Date() }
              : {}),
          },
        });
      }
    }
  }, 120_000);

  it("the page's robots rule says what each fixture should", async () => {
    for (const row of rows) {
      const business = await prisma.business.findUniqueOrThrow({
        where: { slug: row.slug },
        select: { id: true, claimStatus: true, licenceExpiry: true },
      });
      const indexable =
        publiclyClaimed(business.claimStatus) ||
        unclaimedIndexable(
          {
            licenceExpiry: business.licenceExpiry,
            closedReportOpen: (await unclaimedFacts(business.id, business.claimStatus)).closedReportOpen,
          },
          NOW,
        );
      expect(indexable, row.slug).toBe(row.indexable);
    }
  });

  it("submits exactly the listings the page lets a crawler index — across the whole directory", async () => {
    /*
       6a's test, as a set comparison and over every published listing rather
       than only this file's: the sitemap's `/b/:slug` entries against the
       rule each page applies to itself.
    */
    const entries = await sitemap();
    const submitted = new Set(
      entries
        .map((entry) => /\/b\/([^/?#]+)$/.exec(entry.url)?.[1])
        .filter((slug): slug is string => Boolean(slug)),
    );

    const published = await prisma.business.findMany({
      where: { suspendedAt: null, publishedAt: { not: null } },
      select: { slug: true, claimStatus: true, licenceExpiry: true, id: true },
    });
    const open = new Set(
      (
        await prisma.supplierReport.findMany({
          where: { kind: "closed", outcome: null },
          select: { subjectBusinessId: true },
        })
      ).map((row) => row.subjectBusinessId),
    );
    const indexable = new Set(
      published
        .filter(
          (business) =>
            publiclyClaimed(business.claimStatus) ||
            unclaimedIndexable(
              { licenceExpiry: business.licenceExpiry, closedReportOpen: open.has(business.id) },
              // The sitemap read its clock a moment ago; a licence expiring in
              // between would be the one row the two disagree on.
              NOW,
            ),
        )
        .map((business) => business.slug),
    );

    expect([...submitted].filter((slug) => !indexable.has(slug))).toEqual([]);
    expect([...indexable].filter((slug) => !submitted.has(slug))).toEqual([]);

    for (const row of rows) expect(submitted.has(row.slug), row.slug).toBe(row.indexable);
  });

  it("the sitemap's where and the page's predicate are one rule", async () => {
    const matched = new Set(
      (
        await prisma.business.findMany({
          where: { slug: { startsWith: PREFIX }, suspendedAt: null, publishedAt: { not: null }, ...indexableListingWhere(NOW) },
          select: { slug: true },
        })
      ).map((row) => row.slug),
    );
    for (const row of rows) expect(matched.has(row.slug), row.slug).toBe(row.indexable);
  });
});

describe("what the page reads that is not on the row", () => {
  it("a claim waiting for a reviewer is under review; a decided one is not", async () => {
    const listing = await firm("pending-claim", { claimStatus: "unclaimed", tier: 0 });
    expect((await unclaimedFacts(listing.id, "unclaimed")).claimUnderReview).toBe(false);

    const claimant = await prisma.user.findFirstOrThrow({
      where: { roles: { has: "buyer" } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    await prisma.claimSubmission.create({
      data: { businessId: listing.id, claimantId: claimant.id, route: "phone_callback", phone: "+97142238810" },
    });
    // React's `cache` memoises only inside a server render, so outside one
    // this is a fresh read.
    expect((await unclaimedFacts(listing.id, "unclaimed")).claimUnderReview).toBe(true);

    const decided = await firm("decided-claim", { claimStatus: "unclaimed", tier: 0 });
    await prisma.claimSubmission.create({
      data: {
        businessId: decided.id,
        claimantId: claimant.id,
        route: "phone_callback",
        phone: "+97142238811",
        decidedAt: new Date(),
        outcome: "rejected",
        decisionReason: "Board 10g fixture: a decided claim.",
      },
    });
    expect((await unclaimedFacts(decided.id, "unclaimed")).claimUnderReview).toBe(false);
  });

  it("a disputed listing is under review without a query — and names nobody", async () => {
    const listing = await firm("in-dispute", { claimStatus: "disputed", tier: 0 });
    const facts = await unclaimedFacts(listing.id, "disputed");
    expect(facts).toEqual({ closedReportOpen: false, claimUnderReview: true });
  });
});
