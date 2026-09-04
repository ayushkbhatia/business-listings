import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { previewRecipients } from "@/app/(public)/rfq/actions";
import { prisma } from "@/lib/db/client";
import { descendantsOf, findFanoutCandidates } from "@/lib/enquiry/service";
import { MAX_RECIPIENTS, MIN_RECIPIENTS, selectRecipients } from "@/lib/enquiry/fanout";

/**
 * Board 1h, acceptance criteria 6 and 7: who an RFQ actually reaches.
 *
 * `lib/enquiry/fanout.test.ts` already proves the ranking arithmetic against
 * hand-written candidates. This file exists for the half of the rule that only
 * a database can answer: whether the columns the spec is written about —
 * `plan.enquiries_per_month`, `enquiry_recipient.created_at`,
 * `verification_tier`, `response_time_median_ms` — reach the matcher at all,
 * and whether the month the cap counts is the UAE's month.
 *
 * Everything is a fixture in its own category, so the pool under test is
 * exactly the rows this file created and an assertion about who is missing
 * cannot be explained by a seeded supplier ranking above them.
 *
 * The path under test is `previewRecipients` where the assertion is about the
 * list a buyer sees, because that is what the composer calls, and the matcher
 * underneath it where the assertion is about the `skipped` rows, which the
 * preview deliberately throws away.
 */

const PREFIX = "rfq-fanout-test-";
/** Enquiry refs carry it too, so the month-load fixtures clean up by prefix. */
const ENQ_PREFIX = `ENQ-${PREFIX}`;

const HOUR = 3_600_000;
const DAY = 86_400_000;

let seq = 0;
function stamp() {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

let areaId: string;
let buyerId: string;

/** A capped plan and an uncapped one, read from the real catalogue. */
let cappedPlanId: string;
let cappedPlanLimit: number;
let uncappedPlanId: string;

/** One category per group, so each pool is only what that group created. */
let catMany: string;
let catOrder: string;
let catCoverage: string;
let catCap: string;
let catEmpty: string;

/** The subject of the cap tests. Its plan and its month are set per test. */
let subjectId: string;

async function addCategory(name: string): Promise<string> {
  const row = await prisma.category.create({
    data: { slug: `${PREFIX}${name}`, code: "RF", name: `RFQ fan-out test — ${name}` },
  });
  return row.id;
}

async function addSupplier(fields: {
  categoryId: string;
  tier?: number;
  responseTimeMedianMs?: number | null;
  planId?: string | null;
  /** A live catalogue is what the query layer reads as "can answer these lines". */
  catalogue?: boolean;
}): Promise<string> {
  const id = stamp();
  const tier = fields.tier ?? 2;
  const business = await prisma.business.create({
    data: {
      tradeName: `RFQ Fanout Test ${id}`,
      displayName: `RFQ Fanout Test ${id}`,
      slug: `${PREFIX}${id}`,
      licenceNumber: `DED-RF${id.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 365 * DAY),
      primaryCategoryId: fields.categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      verificationTier: tier,
      // The tiers are a ladder and the
      // database holds them to it, so a fixture has to earn the rung it sits on.
      verifiedAt: tier > 0 ? new Date("2026-01-10T00:00:00.000Z") : null,
      responseTimeMedianMs:
        fields.responseTimeMedianMs === undefined ? 4 * HOUR : fields.responseTimeMedianMs,
      planId: fields.planId ?? null,
      locations: {
        create: [
          {
            type: "warehouse",
            emirate: "dubai",
            areaId,
            addressLine: "Unit 4, RFQ fan-out test",
            published: true,
          },
        ],
      },
      ...(fields.catalogue === false
        ? {}
        : {
            products: {
              create: [
                {
                  name: `Gate valve ${id}`,
                  slug: `gate-valve-${id}`,
                  categoryId: fields.categoryId,
                  availability: "in_stock",
                  status: "live",
                },
              ],
            },
          }),
    },
    select: { id: true },
  });
  return business.id;
}

/**
 * Put this business on exactly these enquiries, dated exactly here.
 *
 * One enquiry per recipient row, because `enquiry_recipient` is keyed on the
 * pair. Written straight through Prisma rather than through `createEnquiry`,
 * so the timestamps are the point of the fixture rather than a side effect of
 * when the test ran.
 */
async function loadMonth(businessId: string, createdAts: readonly Date[]) {
  await prisma.enquiry.deleteMany({ where: { ref: { startsWith: ENQ_PREFIX } } });
  for (const createdAt of createdAts) {
    await prisma.enquiry.create({
      data: {
        ref: `${ENQ_PREFIX}${stamp()}`,
        buyerId,
        requirement: "Fixture enquiry, standing in for one the seller already had.",
        closesAt: new Date(Date.now() + 7 * DAY),
        createdAt,
        recipients: { create: [{ businessId, createdAt }] },
      },
      select: { id: true },
    });
  }
}

function setPlan(businessId: string, planId: string | null) {
  return prisma.business.update({ where: { id: businessId }, data: { planId } });
}

/**
 * The first instant of the current month in the UAE, worked out here.
 *
 * Deliberately not `monthStart` from the module under test. A fixture built
 * with the same function it is checking moves with it: rewriting the boundary
 * to UTC would shift the enquiries and the window together and the test would
 * still pass, which is exactly what happened before this existed. The UAE is
 * UTC+4 all year — no daylight saving — so this is the whole calculation.
 */
function uaeMonthStart(now: Date): Date {
  const shifted = new Date(now.getTime() + 4 * HOUR);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - 4 * HOUR);
}

/** `count` timestamps that are unambiguously inside the current UAE month. */
function withinThisMonth(count: number): Date[] {
  const now = Date.now();
  const floor = uaeMonthStart(new Date(now)).getTime();
  // Recent, unless the month has only just turned over, in which case just
  // inside it — otherwise this suite goes red for four hours a month.
  return Array.from(
    { length: count },
    (_, i) => new Date(Math.max(floor + (i + 1) * 60_000, now - (i + 1) * HOUR)),
  );
}

/** The composer's own call, with the fixture defaults filled in. */
function preview(categoryId: string, opts: { fanoutTo?: number; pinned?: string[] } = {}) {
  return previewRecipients({
    categoryId,
    emirate: "dubai",
    lineCount: 2,
    fanoutTo: opts.fanoutTo ?? MAX_RECIPIENTS,
    ...(opts.pinned ? { pinnedBusinessIds: opts.pinned } : {}),
  });
}

/** The matcher underneath it, for the assertions about who was left out. */
async function match(categoryId: string, opts: { want?: number; pinned?: string[] } = {}) {
  const request = {
    categoryId,
    categoryIds: await descendantsOf(categoryId),
    emirate: "dubai" as string | null,
    lineCount: 2,
    want: opts.want ?? MAX_RECIPIENTS,
    ...(opts.pinned ? { pinned: opts.pinned } : {}),
  };
  return selectRecipients(await findFanoutCandidates(request), request);
}

async function removeFixtures() {
  await prisma.enquiry.deleteMany({ where: { ref: { startsWith: ENQ_PREFIX } } });
  // Cascades products, locations and recipient rows, which is why it goes
  // before the area and the categories they are restricted against.
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.area.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();

  const area = await prisma.area.create({
    data: { slug: `${PREFIX}area`, emirate: "dubai", name: "RFQ fan-out test area" },
  });
  areaId = area.id;

  const buyer = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "buyer" }, isProvisional: false },
    select: { id: true },
  });
  buyerId = buyer.id;

  const capped = await prisma.plan.findFirst({
    where: { enquiriesPerMonth: { not: null } },
    orderBy: { sortOrder: "asc" },
    select: { id: true, enquiriesPerMonth: true },
  });
  const uncapped = await prisma.plan.findFirst({
    where: { enquiriesPerMonth: null },
    select: { id: true },
  });
  expect(capped, "the plan catalogue needs a capped plan for any of this to prove anything")
    .not.toBeNull();
  expect(uncapped, "the plan catalogue needs an uncapped plan to compare against").not.toBeNull();
  cappedPlanId = capped!.id;
  cappedPlanLimit = capped!.enquiriesPerMonth!;
  uncappedPlanId = uncapped!.id;

  [catMany, catOrder, catCoverage, catCap, catEmpty] = await Promise.all([
    addCategory("many"),
    addCategory("order"),
    addCategory("coverage"),
    addCategory("cap"),
    addCategory("empty"),
  ]) as [string, string, string, string, string];

  // Twelve identical suppliers: more than the ceiling, so the ceiling is what
  // decides the count and not the size of the pool.
  for (let i = 0; i < 12; i += 1) await addSupplier({ categoryId: catMany });

  await addSupplier({ categoryId: catOrder, tier: 3, responseTimeMedianMs: HOUR });
  await addSupplier({ categoryId: catOrder, tier: 3, responseTimeMedianMs: 20 * HOUR });
  await addSupplier({ categoryId: catOrder, tier: 0, responseTimeMedianMs: HOUR });
  await addSupplier({ categoryId: catOrder, tier: 0, responseTimeMedianMs: 20 * HOUR });

  await addSupplier({ categoryId: catCoverage, tier: 2, catalogue: true });
  await addSupplier({ categoryId: catCoverage, tier: 2, catalogue: false });

  subjectId = await addSupplier({ categoryId: catCap, tier: 2 });
  await addSupplier({ categoryId: catCap, tier: 2 });
  await addSupplier({ categoryId: catCap, tier: 2 });
});

afterAll(async () => {
  await removeFixtures();
});

describe("criterion 7 — how many suppliers one enquiry can reach", () => {
  it("sends to eight when the composer asks for thirty", async () => {
    /*
       The ceiling is the product decision: an enquiry that reaches everybody is
       a broadcast, and a supplier who learns their quotes compete with thirty
       others stops writing them. A pool larger than the ceiling is the only
       arrangement that can show the ceiling doing the work — the seed-backed
       assertion elsewhere is `<= 8`, which a query returning three also passes.
    */
    const recipients = await preview(catMany, { fanoutTo: 30 });
    expect(recipients).toHaveLength(MAX_RECIPIENTS);
    expect(new Set(recipients.map((r) => r.businessId)).size).toBe(MAX_RECIPIENTS);
  });

  it("still sends to one when the composer posts zero", async () => {
    /*
       A form can post anything, and a slider that arrives as 0 — or as -1 from
       a hand-written request — must not silently produce an enquiry nobody
       receives. The buyer would see a sent confirmation and a tracking page
       with no suppliers on it, and nothing anywhere would say why.
    */
    expect(await preview(catMany, { fanoutTo: 0 })).toHaveLength(MIN_RECIPIENTS);
    expect(await preview(catMany, { fanoutTo: -4 })).toHaveLength(MIN_RECIPIENTS);
  });

  it("sends to nobody when the category has no claimed supplier", async () => {
    /*
       The floor is a clamp on the ask, never a promise to find someone. If the
       query fell back to an unfiltered pool when a category came up empty, a
       buyer asking for safety harnesses would reach a valve supplier, and the
       composer would look like it worked.
    */
    expect(await preview(catEmpty)).toEqual([]);
  });
});

describe("criterion 7 — the order the buyer sees them in", () => {
  it("ranks by verification tier, and by measured reply time within a tier", async () => {
    /*
       Both are platform-owned: the tier is staff-written and the median is
       computed from enquiry-to-first-reply. If either stopped reaching the
       matcher — a column dropped from `FANOUT_SELECT`, a rename — the list
       would still render, in an order that looks deliberate and is arbitrary.
       Four suppliers identical but for those two columns, so nothing else can
       account for the sequence.
    */
    const order = await preview(catOrder);
    expect(order).toHaveLength(4);
    expect(order.map((r) => r.verificationTier)).toEqual([3, 3, 0, 0]);

    const rows = await prisma.business.findMany({
      where: { id: { in: order.map((r) => r.businessId) } },
      select: { id: true, verificationTier: true, responseTimeMedianMs: true },
    });
    const speedById = new Map(rows.map((row) => [row.id, row.responseTimeMedianMs]));
    expect(order.map((r) => speedById.get(r.businessId))).toEqual([
      HOUR,
      20 * HOUR,
      HOUR,
      20 * HOUR,
    ]);
  });

  it("breaks a tier-and-speed tie on whether the supplier can answer the lines", async () => {
    /*
       Two suppliers alike on every ranked column, one with a live catalogue and
       one with none. The one who has something to quote goes first — a tie
       broken on the id instead would send half of these enquiries to a
       storefront with nothing on it.

       Coarse on purpose at this layer: `findFanoutCandidates` sets
       `matchedLineCount` to all-or-nothing on whether any product is live,
       because the lines are not matched against the catalogue yet.
    */
    const order = await preview(catCoverage);
    expect(order).toHaveLength(2);

    const counts = await prisma.product.groupBy({
      by: ["businessId"],
      where: { businessId: { in: order.map((r) => r.businessId) }, status: "live" },
      _count: { _all: true },
    });
    const live = new Map(counts.map((row) => [row.businessId, row._count._all]));
    expect(live.get(order[0]!.businessId) ?? 0).toBeGreaterThan(0);
    expect(live.get(order[1]!.businessId) ?? 0).toBe(0);
  });
});

describe("criterion 6 — a seller who cannot reply is not offered", () => {
  it("leaves a capped free-plan seller out of the list entirely", async () => {
    /*
       The rule the whole fan-out is shaped around: absent, not present and
       marked. Shown-and-declined is the failure mode this replaces — a buyer
       counting five suppliers, waiting on all five, and hearing from four,
       with the fifth never having had a slot to answer from. The buyer's list
       is one shorter and is never told why, because it is not their problem.
    */
    expect(cappedPlanLimit, "board 1h names three enquiries a month on the free plan").toBe(3);
    await setPlan(subjectId, cappedPlanId);
    await loadMonth(subjectId, withinThisMonth(cappedPlanLimit));

    const shown = await preview(catCap);
    expect(shown.map((r) => r.businessId)).not.toContain(subjectId);
    // The two who can answer are still there. One fewer option, not no options.
    expect(shown).toHaveLength(2);

    // And the seller's own record of what they missed, which the preview drops.
    const { recipients, skipped } = await match(catCap);
    expect(recipients.map((r) => r.businessId)).not.toContain(subjectId);
    expect(skipped).toContainEqual({ businessId: subjectId, reason: "at_monthly_cap" });
  });

  it("offers the same seller again with one enquiry left in the month", async () => {
    /*
       The exclusion has to be a state, read fresh from the row count, not a
       mark left on the listing. A seller who dropped out of matching and never
       came back would be a paying customer paying for silence, and nothing on
       their dashboard would explain it.
    */
    await setPlan(subjectId, cappedPlanId);
    await loadMonth(subjectId, withinThisMonth(cappedPlanLimit - 1));

    const shown = await preview(catCap);
    expect(shown.map((r) => r.businessId)).toContain(subjectId);
    expect((await match(catCap)).skipped).toEqual([]);
  });

  it("offers the same seller on an uncapped plan whatever their month looks like", async () => {
    /*
       `enquiries_per_month` null means unlimited, and null compares false to
       everything in SQL. A cap check written as a plain `>=` against a nullable
       column excludes the top plan the moment they get busy — the customers
       paying most would be the ones going quietest.
    */
    await setPlan(subjectId, uncappedPlanId);
    await loadMonth(subjectId, withinThisMonth(cappedPlanLimit + 5));

    expect((await preview(catCap)).map((r) => r.businessId)).toContain(subjectId);
  });

  it("will not let a pin put a capped seller back on the enquiry", async () => {
    /*
       `?to=<slug>` pins the storefront the buyer pressed the button on, and the
       query layer widens the pool to fetch a pinned supplier by id whatever
       their category. The cap has to survive that widening: a pinned seller
       with no slot left is the shown-and-silent case again, arriving through
       the one path where the buyer is most certainly expecting a reply.
    */
    await setPlan(subjectId, cappedPlanId);
    await loadMonth(subjectId, withinThisMonth(cappedPlanLimit));

    const shown = await preview(catCap, { pinned: [subjectId] });
    expect(shown.map((r) => r.businessId)).not.toContain(subjectId);

    const { recipients, skipped } = await match(catCap, { pinned: [subjectId] });
    expect(recipients.map((r) => r.businessId)).not.toContain(subjectId);
    expect(skipped).toContainEqual({ businessId: subjectId, reason: "at_monthly_cap" });
  });
});

describe("criterion 6 — the month the cap counts is the UAE's", () => {
  it("counts the small hours of the 1st in Dubai, which are still last month in UTC", async () => {
    /*
       Dubai is UTC+4 with no daylight saving, so the first instant of a UAE
       month is 20:00 UTC on the last day of the previous UTC month. Three
       enquiries taken in that four-hour strip are this month's for the seller
       and last month's for a UTC clock: a boundary computed in UTC would count
       zero of them and hand the seller a fourth enquiry the plan they are on
       does not include.
    */
    const since = uaeMonthStart(new Date());

    await setPlan(subjectId, cappedPlanId);
    await loadMonth(
      subjectId,
      Array.from({ length: cappedPlanLimit }, (_, i) => new Date(since.getTime() + (i + 1) * 60_000)),
    );

    // The fixture is only worth anything if those rows really are last month in UTC.
    const uaeMonth = new Date(since.getTime() + 12 * HOUR).getUTCMonth();
    const rows = await prisma.enquiryRecipient.findMany({
      where: { businessId: subjectId },
      select: { createdAt: true },
    });
    expect(rows).toHaveLength(cappedPlanLimit);
    for (const row of rows) {
      expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(since.getTime());
      expect(row.createdAt.getUTCMonth()).not.toBe(uaeMonth);
    }

    expect((await preview(catCap)).map((r) => r.businessId)).not.toContain(subjectId);
  });

  it("does not count an enquiry from last month against this month's cap", async () => {
    /*
       The other half, and the one that costs a seller money rather than costing
       the platform a slot. A window anchored to a rolling thirty days, or to
       the row's age, would keep a free-plan supplier excluded into a month
       whose three enquiries they have not had yet.
    */
    const since = uaeMonthStart(new Date());

    await setPlan(subjectId, cappedPlanId);
    await loadMonth(
      subjectId,
      Array.from(
        { length: cappedPlanLimit + 2 },
        (_, i) => new Date(since.getTime() - (i + 1) * DAY),
      ),
    );

    expect((await preview(catCap)).map((r) => r.businessId)).toContain(subjectId);
    expect((await match(catCap)).skipped).toEqual([]);
  });
});
