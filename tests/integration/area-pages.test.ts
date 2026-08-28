import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import { DEFAULT_THRESHOLDS } from "@/lib/publish-threshold";
import {
  areaPageState,
  livePages,
  publishAreaPage,
  saveAreaIntro,
  sweepAreaPages,
  unpublishAreaPage,
} from "@/lib/seo/area";
import { areaMatrix } from "@/lib/content/matrix";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * Board 6a, criterion 1 — the rule the whole handoff exists to enforce.
 *
 *   "An area page below 60 listings or 30% verified cannot be published, by API
 *    or by admin action; an existing page auto-unpublishes when supply drops
 *    and disappears from the sitemap on the next build."
 *
 * Asserted at the real numbers, with fixtures of this file's own — 60 is
 * `DEFAULT_THRESHOLDS.minListings` and is read from there, so a test that
 * passed after somebody moved the floor would be testing the wrong thing.
 *
 * Both halves are negatives, and negatives pass by accident. So each is checked
 * from both sides: the refusal, and the same call succeeding once the thing it
 * complained about is fixed.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

const PREFIX = "area-test-";
let opsLeadId: string;
let moderatorId: string;
let areaId: string;
let categoryId: string;
let seq = 0;

const FLOOR = DEFAULT_THRESHOLDS.minListings;
const SHARE = DEFAULT_THRESHOLDS.minVerifiedShare;

/** 250 words, built rather than pasted, for the reason the guide fixture is. */
const INTRO = Array.from({ length: 60 }, () => "Al Quoz industrial supply for contractors.").join(" ");

function stamp() {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

async function removeFixtures() {
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.areaPage.deleteMany({ where: { area: { slug: { startsWith: PREFIX } } } });
  await prisma.area.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

/** Listings in this file's own area and trade, so no other page moves. */
async function addListings(count: number, verified: number) {
  for (let i = 0; i < count; i += 1) {
    const id = stamp();
    await prisma.business.create({
      data: {
        tradeName: `Area Test ${id}`,
        displayName: `Area Test ${id}`,
        slug: `${PREFIX}${id}`,
        licenceNumber: `DED-AT${id.slice(-6)}`,
        licenceAuthority: "DED",
        licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
        primaryCategoryId: categoryId,
        claimStatus: "unclaimed",
        publishedAt: new Date(),
        verificationTier: i < verified ? VERIFIED_TIER : 0,
        verifiedAt: i < verified ? new Date() : null,
        locations: {
          create: {
            type: "trade_counter",
            emirate: "dubai",
            areaId,
            addressLine: "Unit 5, Street 9",
            published: true,
          },
        },
      },
    });
  }
}

/** Take listings away, which is what "supply drops" means. */
async function removeListings(count: number) {
  const doomed = await prisma.business.findMany({
    where: { slug: { startsWith: PREFIX }, primaryCategoryId: categoryId },
    take: count,
    select: { id: true },
  });
  await prisma.business.deleteMany({ where: { id: { in: doomed.map((b) => b.id) } } });
}

const lead = () => actor(opsLeadId, "staff_ops_lead");

beforeAll(async () => {
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      select: { id: true },
    })
  ).id;
  moderatorId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_moderator" } },
      select: { id: true },
    })
  ).id;

  await removeFixtures();

  const area = await prisma.area.create({
    data: { emirate: "dubai", name: "Area Test Zone", slug: `${PREFIX}zone`, lat: 25.1, lng: 55.2 },
    select: { id: true },
  });
  areaId = area.id;

  const category = await prisma.category.create({
    data: { name: "Area Test Trade", slug: `${PREFIX}trade`, code: "AT", sortOrder: 99 },
    select: { id: true },
  });
  categoryId = category.id;
}, 120_000);

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

describe("criterion 1 — a page below the floors cannot be published", () => {
  it("refuses on listings, and says how many are missing", async () => {
    await saveAreaIntro({
      actor: lead(),
      areaId,
      categoryId,
      intro: INTRO,
      reason: "Writing the intro before there is supply.",
    });
    await addListings(10, 10);

    const result = await publishAreaPage(lead(), areaId, categoryId, "Trying it early.");
    expect(result).toMatchObject({ ok: false, error: "below_floors" });
    if (result.ok) return;
    // Say the number — a recruiter reads this to know how many calls to make.
    expect(result.message).toContain(String(FLOOR));
    expect(result.failing?.some((f) => f.reason === "listings")).toBe(true);
  }, 120_000);

  it("refuses on the verified share even with listings to spare", async () => {
    // Up to the listing floor, but almost none of them checked.
    await addListings(FLOOR, 0);

    const state = await areaPageState(areaId, categoryId);
    expect(state?.listings).toBeGreaterThanOrEqual(FLOOR);
    expect((state?.verified ?? 0) / (state?.listings ?? 1)).toBeLessThan(SHARE);

    const result = await publishAreaPage(lead(), areaId, categoryId, "Trying it unverified.");
    expect(result).toMatchObject({ ok: false, error: "below_floors" });
    if (result.ok) return;
    expect(result.failing?.some((f) => f.reason === "verified_share")).toBe(true);
  }, 120_000);

  it("refuses on the word floor even when supply is there", async () => {
    await saveAreaIntro({
      actor: lead(),
      areaId,
      categoryId,
      intro: "Four words only here.",
      reason: "Cutting the intro to nothing.",
    });
    await addListings(40, 40);

    const result = await publishAreaPage(lead(), areaId, categoryId, "Trying it with no copy.");
    expect(result).toMatchObject({ ok: false, error: "below_floors" });
    if (result.ok) return;
    expect(result.failing?.some((f) => f.reason === "intro_words")).toBe(true);
  }, 120_000);

  it("publishes once every floor is crossed, and the sitemap picks it up", async () => {
    await saveAreaIntro({
      actor: lead(),
      areaId,
      categoryId,
      intro: INTRO,
      reason: "The copy is written.",
    });

    const before = await areaPageState(areaId, categoryId);
    expect(before?.clearsFloors, JSON.stringify(before?.failing)).toBe(true);

    const result = await publishAreaPage(lead(), areaId, categoryId, "Supply and copy both there.");
    expect(result.ok).toBe(true);

    const after = await areaPageState(areaId, categoryId);
    expect(after?.live).toBe(true);

    const live = await livePages();
    expect(live.some((page) => page.areaSlug === `${PREFIX}zone`)).toBe(true);
  }, 120_000);

  it("writes an audit row with the reason, and refuses a seat without the capability", async () => {
    const audit = await prisma.auditEvent.findFirst({
      where: { subject: `AreaPage:${PREFIX}zone/${PREFIX}trade` },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.actorId).toBe(opsLeadId);
    expect(audit?.reason).toBeTruthy();

    await expect(
      publishAreaPage(actor(moderatorId, "staff_moderator"), areaId, categoryId, "Not mine to do."),
    ).rejects.toBeInstanceOf(PermissionError);
  }, 120_000);
});

describe("criterion 1 — a published page stops being live when supply drops", () => {
  it("stops serving as indexable the moment the floor breaks, before any job runs", async () => {
    /*
       The half that is easy to get wrong. A stored flag alone would leave a
       thin page live and indexable in the window between the supply dropping
       and the sweep running — and a thin page in the index costs standing
       across the whole domain rather than only its own.
    */
    const before = await areaPageState(areaId, categoryId);
    expect(before?.live).toBe(true);

    await removeListings((before?.listings ?? 0) - FLOOR + 1);

    const after = await areaPageState(areaId, categoryId);
    expect(after?.listings).toBeLessThan(FLOOR);
    // Intent is untouched. Live is not.
    expect(after?.publishedAt).not.toBeNull();
    expect(after?.clearsFloors).toBe(false);
    expect(after?.live).toBe(false);

    // And it is already out of the sitemap, without the sweep.
    const live = await livePages();
    expect(live.some((page) => page.areaSlug === `${PREFIX}zone`)).toBe(false);
  }, 120_000);

  it("the sweep then clears the column so the matrix agrees with the site", async () => {
    const result = await sweepAreaPages();
    expect(result.checked).toBeGreaterThan(0);
    expect(
      result.unpublished.some((page) => page.areaSlug === `${PREFIX}zone`),
      "the sweep did not unpublish the page that fell below the floor",
    ).toBe(true);

    const after = await areaPageState(areaId, categoryId);
    expect(after?.publishedAt).toBeNull();
  }, 120_000);

  it("leaves a healthy page alone", async () => {
    await addListings(FLOOR, FLOOR);
    const republished = await publishAreaPage(lead(), areaId, categoryId, "Recruited back up.");
    expect(republished.ok).toBe(true);

    const result = await sweepAreaPages();
    expect(result.unpublished.some((page) => page.areaSlug === `${PREFIX}zone`)).toBe(false);
    expect((await areaPageState(areaId, categoryId))?.live).toBe(true);
  }, 120_000);

  it("unpublishing by hand is refused when there is nothing to unpublish", async () => {
    expect((await unpublishAreaPage(lead(), areaId, categoryId, "Pulling it.")).ok).toBe(true);
    expect(await unpublishAreaPage(lead(), areaId, categoryId, "Pulling it again.")).toMatchObject({
      ok: false,
      error: "not_published",
    });
  }, 120_000);
});

describe("criterion 12 — the matrix and the site agree", () => {
  it("reports the same live state the route would serve", async () => {
    const matrix = await areaMatrix();
    expect(matrix.rows.length).toBeGreaterThan(0);

    for (const row of matrix.rows.slice(0, 10)) {
      const state = await areaPageState(row.areaId, row.categoryId);
      expect(row.live, row.path).toBe(state?.live);
      expect(row.listings, row.path).toBe(state?.listings);
    }
  }, 180_000);

  it("every live page in the matrix is in the sitemap set, and nothing else is", async () => {
    const [matrix, live] = await Promise.all([areaMatrix(), livePages()]);
    const inMatrix = matrix.rows.filter((row) => row.live).map((row) => row.path).sort();
    const inSitemap = live
      .map((page) => `/${page.emirate}/${page.areaSlug}/${page.categorySlug}`)
      .sort();
    expect(inSitemap).toEqual(inMatrix);
  }, 180_000);
});
