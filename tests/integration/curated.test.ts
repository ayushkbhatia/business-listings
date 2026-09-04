import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { CRITERIA, curatedList, liveLists, MAX_REPLY_MS, membersOf, MIN_REVIEWS } from "@/lib/seo/curated";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * Board 6b, criterion 4 — and the criterion asks for this test by name.
 *
 *   "A curated list displays its selection criteria and cannot include a
 *    business that fails them; placement cannot be bought into one — asserted
 *    by a test."
 *
 * The interesting half is the absence. So the fixtures below are five listings
 * that differ in exactly one thing each, and what is asserted is which one is
 * missing and why — including one that has bought everything the product sells
 * and is still not on the list.
 */

const PREFIX = "curated-test-";
let categoryId: string;
let areaId: string;
let seq = 0;

function stamp() {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

async function removeFixtures() {
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { fullName: { startsWith: "Curated Test" } } });
  await prisma.curatedList.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.area.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

interface Candidate {
  name: string;
  tier?: number;
  replyMs?: number | null;
  reviews?: number;
  planId?: string | null;
}

/** A listing that qualifies, minus whatever the caller takes away. */
async function candidate(spec: Candidate): Promise<string> {
  const id = stamp();
  const business = await prisma.business.create({
    data: {
      tradeName: `Curated ${spec.name} ${id}`,
      displayName: `Curated ${spec.name}`,
      slug: `${PREFIX}${spec.name}-${id}`,
      licenceNumber: `DED-CT${id.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      verificationTier: spec.tier ?? VERIFIED_TIER,
      verifiedAt: (spec.tier ?? VERIFIED_TIER) > 0 ? new Date() : null,
      // Set directly, because this file is testing the list and not the
      // measurement. `tests/integration/*` covers derivation elsewhere.
      responseTimeMedianMs: spec.replyMs === undefined ? MAX_REPLY_MS - 60_000 : spec.replyMs,
      ...(spec.planId ? { planId: spec.planId } : {}),
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
    select: { id: true },
  });

  const wanted = spec.reviews ?? MIN_REVIEWS;
  for (let i = 0; i < wanted; i += 1) {
    const buyer = await prisma.user.create({
      data: { id: crypto.randomUUID(), fullName: `Curated Test Buyer ${id}-${i}`, roles: ["buyer"] },
      select: { id: true },
    });
    const enquiry = await prisma.enquiry.create({
      data: {
        ref: `ENQ-CT-${id}-${i}`,
        buyerId: buyer.id,
        requirement: "Ducting.",
        closesAt: new Date(Date.now() + 7 * 86_400_000),
      },
      select: { id: true },
    });
    await prisma.enquiryRecipient.create({
      data: { enquiryId: enquiry.id, businessId: business.id, state: "quoted" },
    });
    await prisma.review.create({
      data: {
        businessId: business.id,
        buyerId: buyer.id,
        enquiryId: enquiry.id,
        overall: 5,
        quotedAccurate: 5,
        onTime: 5,
        asDescribed: 5,
        responsiveness: 5,
        body: "Quoted the same day and delivered on the date they gave.",
        editableUntil: new Date(Date.now() + 14 * 86_400_000),
      },
    });
  }

  return business.id;
}

beforeAll(async () => {
  await removeFixtures();
  categoryId = (
    await prisma.category.create({
      data: { name: "Curated Test Trade", slug: `${PREFIX}trade`, code: "CT", sortOrder: 99 },
      select: { id: true },
    })
  ).id;
  areaId = (
    await prisma.area.create({
      data: { emirate: "dubai", name: "Curated Test Zone", slug: `${PREFIX}zone` },
      select: { id: true },
    })
  ).id;
}, 120_000);

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

describe("criterion 4 — a business that fails a rule cannot be on the list", () => {
  it("excludes on each required rule, one at a time", async () => {
    const qualifies = await candidate({ name: "qualifies" });
    const unverified = await candidate({ name: "unverified", tier: VERIFIED_TIER - 1 });
    const slow = await candidate({ name: "slow", replyMs: MAX_REPLY_MS + 60_000 });
    const unmeasured = await candidate({ name: "unmeasured", replyMs: null });
    const fewReviews = await candidate({ name: "thin", reviews: MIN_REVIEWS - 1 });

    const { members } = await membersOf({ categoryId });
    const ids = members.map((member) => member.id);

    expect(ids, "the one that meets every rule is missing").toContain(qualifies);
    expect(ids, "an unverified licence got on the list").not.toContain(unverified);
    expect(ids, "a slow replier got on the list").not.toContain(slow);
    /*
       Unmeasured is not fast. Non-negotiable 6 is why `responseTimeMedianMs`
       is nullable, and a list that treated null as passing would be claiming
       something nobody measured.
    */
    expect(ids, "an unmeasured reply time got on the list").not.toContain(unmeasured);
    expect(ids, "too few reviews got on the list").not.toContain(fewReviews);
  }, 180_000);

  it("drops a supplier whose reviews are removed, without anything being run", async () => {
    const id = await candidate({ name: "removed" });
    expect((await membersOf({ categoryId })).members.map((m) => m.id)).toContain(id);

    // A moderator removes one review. Membership is computed, so the next read
    // is the whole of the mechanism.
    const one = await prisma.review.findFirstOrThrow({
      where: { businessId: id },
      select: { id: true },
    });
    await prisma.review.update({
      where: { id: one.id },
      data: { removedAt: new Date(), removalReason: "Written by a competitor." },
    });

    expect((await membersOf({ categoryId })).members.map((m) => m.id)).not.toContain(id);
  }, 180_000);
});

describe("criterion 4 — placement cannot be bought", () => {
  it("keeps the best-paying supplier off the list when it fails a rule", async () => {
    /*
       The fixture that matters. This listing has everything the product sells —
       the top plan, a verified licence, more reviews than the floor — and one
       thing it cannot buy: a reply time under four hours,
       which is measured from enquiry timestamps and has no seller-writable
       field. It is not on the list, and no amount of money changes that.
    */
    const paid = await candidate({
      name: "paid",
      planId: "pro",
      reviews: MIN_REVIEWS + 10,
      replyMs: MAX_REPLY_MS + 1,
    });

    const { members } = await membersOf({ categoryId });
    expect(members.map((member) => member.id)).not.toContain(paid);
  }, 180_000);

  it("does not order by anything a seller pays for", async () => {
    /*
       Two listings identical except that one is on Pro and one is on no plan
       at all, and the free one sorts first on the tie-breaker. If plan tier
       leaked into the comparator this would flip.
    */
    await prisma.business.deleteMany({ where: { slug: { startsWith: `${PREFIX}rank-` } } });

    const free = await candidate({ name: "rank-a-free", replyMs: 60 * 60_000, planId: null });
    const pro = await candidate({ name: "rank-b-pro", replyMs: 60 * 60_000, planId: "pro" });

    const { members } = await membersOf({ categoryId });
    const order = members.map((member) => member.id);
    expect(order.indexOf(free)).toBeLessThan(order.indexOf(pro));
  }, 180_000);

  it("ranks a higher tier above a lower one that replies faster", async () => {
    /*
       This used to be about the site visit, which was the one weighted
       criterion and which the seller could not buy. Visits were withdrawn and
       nothing replaced the weight — the tier absorbed it, and the tier is the
       same kind of signal: staff-written, no seller-writable field, and above
       reply time in the comparator precisely so a fast typist cannot outrank a
       checked company.
    */
    const audited = await candidate({ name: "audited", tier: 3, replyMs: 3 * 3_600_000 });
    const quick = await candidate({ name: "quick", tier: VERIFIED_TIER, replyMs: 10 * 60_000 });

    const order = (await membersOf({ categoryId })).members.map((member) => member.id);
    expect(order.indexOf(audited)).toBeLessThan(order.indexOf(quick));
  }, 180_000);

  it("has no field anywhere on the model that could hold a bought position", async () => {
    /*
       The strongest form of the guarantee is structural. If somebody adds a
       `featured`, `rank` or `sponsored` column to `CuratedList` later, this
       fails and they have to argue for it in a review rather than in a migration.
    */
    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `select column_name from information_schema.columns where table_name = 'curated_list'`,
    );
    const names = columns.map((row) => row.column_name);
    for (const forbidden of ["featured", "rank", "position", "sponsored", "placement", "boost"]) {
      expect(names, `curated_list gained a ${forbidden} column`).not.toContain(forbidden);
    }
  }, 60_000);
});

describe("the page states the rules it applies", () => {
  it("publishes a criterion for every rule the service enforces", () => {
    // The page renders `CRITERIA`; the service applies these three. A rule
    // enforced and not stated is the thing every competitor does.
    const required = CRITERIA.filter((c) => c.kind === "required").map((c) => c.key);
    expect(required.sort()).toEqual(["reply", "reviews", "verified"]);
    expect(CRITERIA.some((c) => c.key === "placement" && c.kind === "never")).toBe(true);
    // No weighted criterion remains. The site visit was the only one, and a
    // published list must not name a rule the comparator does not apply.
    expect(CRITERIA.filter((c) => c.kind === "weighted")).toEqual([]);
  });
});

describe("a list with nobody on it", () => {
  it("resolves, says how many were considered, and stays out of the sitemap", async () => {
    const emptyCategory = await prisma.category.create({
      data: { name: "Curated Empty", slug: `${PREFIX}empty`, code: "CE", sortOrder: 99 },
      select: { id: true },
    });
    await prisma.curatedList.create({
      data: {
        slug: `${PREFIX}empty-list`,
        title: "Nobody qualifies",
        intro: "A list nobody is on yet.",
        categoryId: emptyCategory.id,
        publishedAt: new Date(),
      },
    });

    const view = await curatedList(`${PREFIX}empty-list`);
    expect(view?.members).toEqual([]);
    expect(view?.consideredCount).toBe(0);

    const live = await liveLists();
    expect(live.some((row) => row.slug === `${PREFIX}empty-list`)).toBe(false);
  }, 120_000);

  it("does not resolve a draft through the public read", async () => {
    await prisma.curatedList.create({
      data: {
        slug: `${PREFIX}draft`,
        title: "Not published",
        categoryId,
        intro: "A draft.",
      },
    });
    expect(await curatedList(`${PREFIX}draft`)).toBeNull();
    expect(await curatedList(`${PREFIX}draft`, { includeDraft: true })).not.toBeNull();
  }, 120_000);
});
