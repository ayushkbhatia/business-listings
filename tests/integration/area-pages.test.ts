import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import { DEFAULT_THRESHOLDS, holdFloor } from "@/lib/publish-threshold";
import {
  areaPageState,
  livePages,
  publishAreaPage,
  saveAreaIntro,
  sweepAreaPages,
  unpublishAreaPage,
} from "@/lib/seo/area";
import {
  refreshFreshness,
  saveLandingFaq,
  scopeForArea,
  slugCollision,
  slugCollisionMessage,
  supplyDigest,
  type LandingScope,
} from "@/lib/seo/landing";
import { areaMatrix } from "@/lib/content/matrix";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * Board 6a, criterion 1 — the rule the whole handoff exists to enforce.
 *
 *   "An area page below 60 listings or 30% verified cannot be published, by API
 *    or by admin action; an existing page auto-unpublishes when supply drops
 *    and disappears from the sitemap on the next build."
 *
 * **Board 6f amends the second half**, and the amendment is the point of the
 * band: a page publishes at 60 and comes down below 48, so one sitting on the
 * floor that gains and loses a listing a day no longer publishes and
 * unpublishes daily — and every one of those cycles was a sitemap change.
 * "Auto-unpublishes when supply drops" now reads "auto-unpublishes when supply
 * drops below the hold floor, and not within its first 30 days live".
 *
 * Asserted at the real numbers, with fixtures of this file's own — the floors
 * are read from `DEFAULT_THRESHOLDS` and `holdFloor`, so a test that passed
 * after somebody moved one would be testing the wrong thing.
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
/** 48 at the shipped defaults. The floor a live page keeps holding at. */
const HOLD = holdFloor({});
/** Past any minimum-live window, so the sweep is judged on supply alone. */
const LATER = new Date(Date.now() + 400 * 86_400_000);

/** 250 words, built rather than pasted, for the reason the guide fixture is. */
const INTRO = Array.from({ length: 60 }, () => "Al Quoz industrial supply for contractors.").join(" ");

/**
 * Board 6a's fourth condition: four questions, two of them scope-specific.
 *
 * Built rather than pasted for the same reason as the intro, and the split is
 * the interesting part — three specific and one generic would pass, one
 * specific and three generic would not, and the tests below walk both.
 */
const FAQ = [
  { question: "One?", answer: "Yes.", scopeSpecific: true },
  { question: "Two?", answer: "Yes.", scopeSpecific: true },
  { question: "Three?", answer: "Yes.", scopeSpecific: false },
  { question: "Four?", answer: "Yes.", scopeSpecific: false },
];

/** The scope, resolved once the fixtures exist. */
let scope: LandingScope;

/** Every condition but the one under test, satisfied. */
async function writeCopy(reason: string) {
  await saveAreaIntro({ actor: lead(), areaId, categoryId, intro: INTRO, reason });
  await saveLandingFaq(lead(), scope, FAQ, reason);
}

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
      // One of two seeded ops leads, and always the same one: board 6f
      // needs a second for dual control, and `findFirst` has no defined
      // order without this.
      orderBy: { id: "asc" as const },
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

  scope = (await scopeForArea(areaId, categoryId)) as LandingScope;
}, 120_000);

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

describe("criterion 1 — a page below the floors cannot be published", () => {
  it("refuses on listings, and says how many are missing", async () => {
    // Copy first, so the refusal under test is the listing floor and not the
    // two copy conditions arriving at the same time.
    await writeCopy("Writing the copy before there is supply.");
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
    await writeCopy("The copy is written.");

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
  it("keeps serving inside the band, and stops the moment it falls through it", async () => {
    /*
       The half that is easy to get wrong twice over.

       A stored flag would leave a thin page live and indexable in the window
       between the supply dropping and the sweep running. A single floor used in
       both directions would take a page down for one lost listing and put it
       back for one gained, and every cycle is a sitemap change that teaches a
       crawler the section is unstable. Board 6f wants neither.
    */
    const before = await areaPageState(areaId, categoryId);
    expect(before?.live).toBe(true);

    // One below the publish floor and comfortably above the hold floor.
    await removeListings((before?.listings ?? 0) - (FLOOR - 1));
    const banded = await areaPageState(areaId, categoryId);
    expect(banded?.listings).toBe(FLOOR - 1);
    // It could not be published fresh from here...
    expect(banded?.clearsFloors).toBe(false);
    // ...and it is not taken down for it either.
    expect(banded?.holdsFloors).toBe(true);
    expect(banded?.live).toBe(true);
    expect((await livePages()).some((page) => page.areaSlug === `${PREFIX}zone`)).toBe(true);

    // Now through the band.
    await removeListings((banded?.listings ?? 0) - (HOLD - 1));
    const dropped = await areaPageState(areaId, categoryId, LATER);
    expect(dropped?.listings).toBe(HOLD - 1);
    // Intent is untouched. Live is not.
    expect(dropped?.publishedAt).not.toBeNull();
    expect(dropped?.holdsFloors).toBe(false);
    expect(dropped?.live).toBe(false);

    // And it is already out of the sitemap, without the sweep.
    const live = await livePages(LATER);
    expect(live.some((page) => page.areaSlug === `${PREFIX}zone`)).toBe(false);
  }, 120_000);

  it("does not flap: oscillating across 60 changes nothing either way", async () => {
    /*
       Criterion 7's own test — "tested by oscillating a fixture across 60".

       Back up to the publish floor first, because the case before this one left
       the page through the band. Then one listing leaves and returns, three
       times: below 60 the page cannot be published fresh, and it must not leave
       the index for it. Every one of those exits used to be a sitemap change.
    */
    const current = (await areaPageState(areaId, categoryId, LATER))?.listings ?? 0;
    const short = FLOOR - current;
    // Six in ten verified, not all of them: the freshness cases below need an
    // unverified listing to promote, and a fixture that verified everything it
    // added left them with nothing to find.
    await addListings(short, Math.ceil(short * 0.6));
    expect((await areaPageState(areaId, categoryId, LATER))?.listings).toBe(FLOOR);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await removeListings(1);
      const dipped = await areaPageState(areaId, categoryId, LATER);
      expect(dipped?.listings).toBe(FLOOR - 1);
      expect(dipped?.clearsFloors, "a page under the floor cannot publish fresh").toBe(false);
      expect(dipped?.live, "and it must not leave the index for one listing").toBe(true);

      await addListings(1, 0);
      expect((await areaPageState(areaId, categoryId, LATER))?.live).toBe(true);
    }

    const result = await sweepAreaPages(LATER);
    expect(result.unpublished.some((page) => page.areaSlug === `${PREFIX}zone`)).toBe(false);
  }, 120_000);

  it("holds a page through its first 30 days even below the band", async () => {
    // The minimum-live window. `firstPublishedAt` was stamped when this fixture
    // published, so "now" is inside it and the sweep must leave the page alone
    // — and say that it did rather than reporting a quiet nothing.
    const current = (await areaPageState(areaId, categoryId))?.listings ?? 0;
    await removeListings(current - 2);

    const inside = await areaPageState(areaId, categoryId);
    expect(inside?.holdsFloors).toBe(false);
    expect(inside?.withinGrace).toBe(true);
    expect(inside?.live).toBe(true);

    const held = await sweepAreaPages();
    expect(held.heldByGrace).toBeGreaterThan(0);
    expect(held.unpublished.some((page) => page.areaSlug === `${PREFIX}zone`)).toBe(false);
    expect((await areaPageState(areaId, categoryId))?.publishedAt).not.toBeNull();
  }, 120_000);

  it("the sweep then clears the column so the matrix agrees with the site", async () => {
    // Past the window, the same page comes down.
    const result = await sweepAreaPages(LATER);
    expect(result.checked).toBeGreaterThan(0);
    expect(
      result.unpublished.some((page) => page.areaSlug === `${PREFIX}zone`),
      "the sweep did not unpublish the page that fell through the band",
    ).toBe(true);

    const after = await areaPageState(areaId, categoryId);
    expect(after?.publishedAt).toBeNull();
    // Never cleared, which is what the window measures from on a republish.
    expect(after?.firstPublishedAt).not.toBeNull();
  }, 120_000);

  it("leaves a healthy page alone", async () => {
    await addListings(FLOOR, FLOOR);
    const republished = await publishAreaPage(lead(), areaId, categoryId, "Recruited back up.");
    expect(republished.ok).toBe(true);

    const result = await sweepAreaPages(LATER);
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

/**
 * Board 6a's fourth publish condition.
 *
 *   FAQ rows ≥ 4, at least 2 specific to this scope
 *
 * *"A scope can clear 60 listings and 30% verified and still not publish for
 * want of 250 written words. That is deliberate: it is the whole difference
 * between this template and a doorway generator."* The questions are the same
 * argument one step further — four generic questions with the area name
 * substituted in is the doorway page arriving through the part of the template
 * nobody was counting.
 *
 * Runs after the blocks above, so supply is already over the floors and the
 * only thing moving here is the copy.
 */
describe("the fourth condition — four questions, two of them local", () => {
  it("blocks a page with supply and an intro but no questions", async () => {
    await addListings(FLOOR, FLOOR);
    await saveAreaIntro({
      actor: lead(),
      areaId,
      categoryId,
      intro: INTRO,
      reason: "The paragraph, and nothing else.",
    });
    await saveLandingFaq(lead(), scope, [], "Clearing the questions.");

    const result = await publishAreaPage(lead(), areaId, categoryId, "Trying it with no FAQ.");
    expect(result).toMatchObject({ ok: false, error: "below_floors" });
    if (result.ok) return;
    expect(result.failing?.some((f) => f.reason === "faq_rows")).toBe(true);
    // Say the number, as every other refusal on this screen does.
    expect(result.message).toContain("4");
  }, 120_000);

  it("blocks four questions none of which is local", async () => {
    await saveLandingFaq(
      lead(),
      scope,
      FAQ.map((row) => ({ ...row, scopeSpecific: false })),
      "Four questions, all of them generic.",
    );

    const result = await publishAreaPage(lead(), areaId, categoryId, "Trying it generic.");
    expect(result).toMatchObject({ ok: false, error: "below_floors" });
    if (result.ok) return;
    expect(result.failing?.map((f) => f.reason)).toEqual(["faq_scope_specific"]);
  }, 120_000);

  it("publishes at four with two of them local", async () => {
    await saveLandingFaq(lead(), scope, FAQ, "Two of them are about this area.");
    expect((await publishAreaPage(lead(), areaId, categoryId, "All four conditions.")).ok).toBe(
      true,
    );
    expect((await areaPageState(areaId, categoryId))?.live).toBe(true);
  }, 120_000);

  it("unpublishes a live page when its questions are taken away", async () => {
    // The gate runs in both directions, as the supply floors do. A page that
    // was published and then had its FAQ emptied is not grandfathered in.
    await saveLandingFaq(lead(), scope, FAQ.slice(0, 2), "Cutting it to two.");
    const state = await areaPageState(areaId, categoryId);
    expect(state?.publishedAt).not.toBeNull();
    expect(state?.live).toBe(false);
    expect((await livePages()).some((page) => page.areaSlug === `${PREFIX}zone`)).toBe(false);

    await saveLandingFaq(lead(), scope, FAQ, "Putting them back.");
    expect((await areaPageState(areaId, categoryId))?.live).toBe(true);
  }, 120_000);

  it("writes an audit row naming what moved", async () => {
    const audit = await prisma.auditEvent.findFirst({
      where: { subject: `AreaPage:${PREFIX}zone/${PREFIX}trade` },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.reason).toBeTruthy();
    // The counts, not the prose. An audit row is a record of a decision, and
    // pasting four paragraphs into it twice a week is not that.
    expect(JSON.stringify(audit?.after ?? {})).toContain("rows");
  }, 120_000);
});

/**
 * Board 6a §Freshness — what `UPDATED 21 AUG 2026` means.
 *
 * Criterion 5 asks for both directions: *"`content_updated_at` does not change
 * on a rebuild with no data or copy change; it does change when a listing
 * enters or leaves the scope. Both directions tested."*
 *
 * The render deliberately still read 21 Aug although it was exported on 4 Sep.
 * If the date tracked the build, every page on the domain would claim to have
 * been updated this morning, which is both false and trivially detected.
 */
describe("criterion 5 — the UPDATED date moves for three reasons and no others", () => {
  async function stamped(): Promise<Date | null> {
    const row = await prisma.areaPage.findUnique({
      where: { areaId_categoryId: { areaId, categoryId } },
      select: { contentUpdatedAt: true },
    });
    return row?.contentUpdatedAt ?? null;
  }

  it("records the digest without moving the date on the first pass", async () => {
    /*
       The failure this guards against is a whole domain, not a page: a page
       that has never been swept has no digest, and reading that as "different,
       therefore changed" would move `content_updated_at` on every published
       page the first night the sweep ran after the migration. §Freshness is
       written against exactly that — every page claiming to have been updated
       this morning, all of them moving together.
    */
    await prisma.areaPage.update({
      where: { areaId_categoryId: { areaId, categoryId } },
      data: { supplyDigest: null, contentUpdatedAt: new Date(Date.UTC(2026, 2, 3)) },
    });

    const result = await refreshFreshness(scope, new Date(Date.UTC(2026, 8, 9)));
    expect(result?.moved).toBe(false);
    expect((await stamped())?.toISOString()).toBe(new Date(Date.UTC(2026, 2, 3)).toISOString());

    // And the digest is now recorded, so the next real change is seen.
    const row = await prisma.areaPage.findUnique({
      where: { areaId_categoryId: { areaId, categoryId } },
      select: { supplyDigest: true },
    });
    expect(row?.supplyDigest).not.toBeNull();
  }, 120_000);

  /**
   * A moment strictly after whatever is currently stamped.
   *
   * These tests run in order and each leaves the date where it put it, so a
   * fixed calendar date in one of them can be *earlier* than the one the test
   * above wrote — which fails on the assertion rather than on the behaviour.
   * Relative to what is there, and the sweep's own `now` is a parameter for
   * exactly this reason.
   */
  async function later(): Promise<Date> {
    const current = await stamped();
    return new Date((current?.getTime() ?? Date.now()) + 86_400_000);
  }

  it("moves when a listing enters the scope", async () => {
    const before = await stamped();

    await addListings(1, 1);
    const result = await refreshFreshness(scope, await later());

    expect(result?.moved).toBe(true);
    expect((await stamped())?.getTime()).toBeGreaterThan((before as Date).getTime());
  }, 120_000);

  it("does not move on a rebuild with nothing changed", async () => {
    const before = await stamped();
    /*
       The whole criterion. A second pass over the same supply is what a nightly
       rebuild is, and it must leave the date exactly where it was — not "within
       a second of", exactly.
    */
    const result = await refreshFreshness(scope, await later());
    expect(result?.moved).toBe(false);
    expect((await stamped())?.getTime()).toBe((before as Date).getTime());
  }, 120_000);

  it("moves when a listing in the scope changes verification tier", async () => {
    // A count alone cannot see this: the same number of listings, one of them
    // now checked. It is exactly the change a reader would call an update.
    const before = await stamped();
    const candidate = await prisma.business.findFirstOrThrow({
      where: { slug: { startsWith: PREFIX }, primaryCategoryId: categoryId, verificationTier: 0 },
      select: { id: true },
    });
    await prisma.business.update({
      where: { id: candidate.id },
      data: { verificationTier: VERIFIED_TIER, verifiedAt: new Date() },
    });

    const result = await refreshFreshness(scope, await later());
    expect(result?.moved).toBe(true);
    expect((await stamped())?.getTime()).toBeGreaterThan((before as Date).getTime());
  }, 120_000);

  it("moves when the copy is edited", async () => {
    const before = await stamped();
    await saveAreaIntro({
      actor: lead(),
      areaId,
      categoryId,
      intro: `${INTRO} One more sentence.`,
      reason: "Adding a sentence.",
    });
    expect((await stamped())?.getTime()).toBeGreaterThan((before as Date).getTime());
  }, 120_000);

  it("digests the same supply to the same value", async () => {
    // The property the whole mechanism rests on. If this were unstable — a
    // `Set` iterated in insertion order, say — every page would claim to have
    // been updated on every sweep.
    expect(await supplyDigest(scope)).toBe(await supplyDigest(scope));
  }, 120_000);
});

/**
 * Criterion 7 — one namespace across areas and trades.
 *
 * The router flattened the emirate class to two segments, so no middle segment
 * is ambiguous any more. What survives is the namespace: an area and a category
 * sharing a slug would put `/dubai/foo` and `/dubai/foo/bar` in two classes
 * reading two tables, and the first redirect or canonical written between them
 * would be wrong.
 */
describe("criterion 7 — areas and trades share one slug namespace", () => {
  it("refuses a trade slug that an area already holds", async () => {
    const collision = await slugCollision(`${PREFIX}zone`, "category");
    expect(collision).toMatchObject({ heldBy: "area" });
    expect(slugCollisionMessage(collision!)).toContain(`${PREFIX}zone`);
  }, 120_000);

  it("refuses an area slug that a trade already holds", async () => {
    const collision = await slugCollision(`${PREFIX}trade`, "area");
    expect(collision).toMatchObject({ heldBy: "category" });
  }, 120_000);

  it("does not call a row a collision with itself", async () => {
    // Renaming a category to the slug it already has is not a collision.
    expect(await slugCollision(`${PREFIX}trade`, "area", { id: categoryId })).toBeNull();
  }, 120_000);

  it("the two namespaces are disjoint in the seeded data", async () => {
    const [areas, categories] = await Promise.all([
      prisma.area.findMany({ select: { slug: true } }),
      prisma.category.findMany({ select: { slug: true } }),
    ]);
    const taken = new Set(areas.map((row) => row.slug));
    const clashes = categories.map((row) => row.slug).filter((slug) => taken.has(slug));
    expect(clashes).toEqual([]);
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
    /*
       The whole set, not the first page of it.

       Board 6f paginates this screen — HVAC in Dubai is forty-odd areas — so
       `areaMatrix()` returns twenty-five rows by default, and a set comparison
       against a page of a list is a test that passes while the list grows past
       it. Criterion 12 is about the whole sitemap.
    */
    const [matrix, live] = await Promise.all([
      areaMatrix({ perPage: Number.MAX_SAFE_INTEGER }),
      livePages(),
    ]);
    const inMatrix = matrix.rows.filter((row) => row.live).map((row) => row.path).sort();
    const inSitemap = live
      .map((page) => `/${page.emirate}/${page.areaSlug}/${page.categorySlug}`)
      .sort();
    expect(inSitemap).toEqual(inMatrix);
  }, 180_000);
});
