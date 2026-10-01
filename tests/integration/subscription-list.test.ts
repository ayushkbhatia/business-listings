import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { subscriptionList } from "@/lib/billing/subscription-list";
import { mrrNow } from "@/lib/billing/revenue";
import { monthlyValueFils } from "@/lib/billing/period";
import { snapshotOf, toCaps, PLAN_CAPS_SELECT } from "@/lib/plan/entitlements";
import type { SubStatus } from "@/lib/db/generated/enums";

/**
 * Board 4g's subscription list — `/admin/subscriptions` — and the two figures
 * in its header. No test read it before this file.
 *
 * Three things were wrong, and each is the kind CLAUDE.md names:
 *
 * - **Both header counts were `rows.length`** behind a `take` of 500 — the
 *   shape `tests-that-pin-the-defect` describes, a header that passes forever
 *   because the fixture is smaller than the cap.
 * - **The "on old numbers" column compared six fields of the twelve** a
 *   snapshot freezes, so an account grandfathered on services, categories or
 *   any of the four switches read "on the plan".
 * - **The monthly column printed a plan price on a trial**, and on subscriptions
 *   that had ended, while promising in its own comment that the column adds up
 *   to `mrrNow` — which counts neither.
 *
 * A plan of this file's own, so a snapshot can be taken and the plan then moved
 * under it without touching a seeded row, and businesses of its own.
 */

const DAY = 86_400_000;
const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const PLAN_ID = `sl-test-${stamp}`;
let categoryId = "";
let seq = 0;
const made: string[] = [];

beforeAll(async () => {
  categoryId = (
    await prisma.category.findFirstOrThrow({
      where: { parentId: null },
      orderBy: { id: "asc" },
      select: { id: true },
    })
  ).id;
  const basic = await prisma.plan.findUniqueOrThrow({ where: { id: "basic" } });
  await prisma.plan.create({
    data: {
      ...basic,
      id: PLAN_ID,
      name: `Subscription list ${stamp}`,
      monthlyPriceAed: 349,
      annualMonthsCharged: 10,
      sortOrder: 92,
    },
  });
});

afterAll(async () => {
  await prisma.business.deleteMany({ where: { id: { in: made } } });
  await prisma.plan.deleteMany({ where: { id: PLAN_ID } });
  await prisma.$disconnect();
});

async function planCaps() {
  return toCaps(await prisma.plan.findUniqueOrThrow({ where: { id: PLAN_ID }, select: PLAN_CAPS_SELECT }));
}

async function subscribed(options: {
  status?: SubStatus;
  term?: "monthly" | "annual";
  snapshot?: object | null;
  cancelled?: boolean;
}) {
  seq += 1;
  const mark = `${stamp}-${seq}`;
  const business = await prisma.business.create({
    data: {
      displayName: `Listed As ${mark}`,
      tradeName: `Registered As ${mark} LLC`,
      slug: `subscription-list-${mark}`,
      licenceNumber: `DED-SL${String(seq).padStart(2, "0")}${stamp.slice(-4)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * DAY),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      planId: PLAN_ID,
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  made.push(business.id);
  const renewsAt = new Date(Date.now() + 20 * DAY);
  const subscription = await prisma.subscription.create({
    data: {
      businessId: business.id,
      planId: PLAN_ID,
      status: options.status ?? "active",
      term: options.term ?? "monthly",
      // Newest first on the list, so this file's rows are on the first page.
      startedAt: new Date(),
      periodStartedAt: new Date(Date.now() - 10 * DAY),
      renewsAt,
      ...(options.cancelled ? { cancelledAt: new Date(), endsAt: renewsAt } : {}),
      ...(options.snapshot ? { entitlementSnapshot: options.snapshot } : {}),
    },
    select: { id: true },
  });
  return { businessId: business.id, subscriptionId: subscription.id };
}

describe("the header counts subscriptions, not the page", () => {
  it("counts every subscription however few the table shows", async () => {
    await subscribed({});
    await subscribed({});

    const page = await subscriptionList(1);
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(await prisma.subscription.count());
    expect(page.total).toBeGreaterThan(page.rows.length);
  });

  it("counts every account on old numbers, including the ones off the page", async () => {
    const caps = await planCaps();
    await subscribed({ snapshot: { ...snapshotOf({ ...caps, productLimit: 9 }, new Date()) } });
    await subscribed({ snapshot: { ...snapshotOf({ ...caps, teamSeats: 1 }, new Date()) } });

    const onePage = await subscriptionList(1);
    const everything = await subscriptionList(100_000);
    // The header is the same figure whatever the table's limit is.
    expect(onePage.grandfathered).toBe(everything.grandfathered);
    expect(everything.grandfathered).toBe(
      everything.rows.filter((row) => row.grandfatheredFields.length > 0).length,
    );
    expect(onePage.grandfathered).toBeGreaterThanOrEqual(2);
  });
});

describe("the last column names every field the account keeps", () => {
  /*
     Each of these is frozen by `snapshotOf` and was missing from the list the
     column compared — so an account keeping one of them read "on the plan".
  */
  it("names services, categories and the switches, not only the six counts", async () => {
    const caps = await planCaps();
    const signedUpOn = {
      ...caps,
      serviceLimit: 4,
      categoryLimit: 6,
      customDomain: !caps.customDomain,
      analytics: !caps.analytics,
      csvImport: !caps.csvImport,
      sponsoredEligible: !caps.sponsoredEligible,
    };
    const { subscriptionId } = await subscribed({ snapshot: { ...snapshotOf(signedUpOn, new Date()) } });

    const row = (await subscriptionList()).rows.find((r) => r.id === subscriptionId);
    expect(row?.grandfatheredFields).toEqual([
      "serviceLimit",
      "categoryLimit",
      "customDomain",
      "analytics",
      "csvImport",
      "sponsoredEligible",
    ]);
  });

  it("names nothing for an account on the plan's current numbers", async () => {
    const caps = await planCaps();
    const { subscriptionId } = await subscribed({ snapshot: { ...snapshotOf(caps, new Date()) } });
    const row = (await subscriptionList()).rows.find((r) => r.id === subscriptionId);
    expect(row?.grandfatheredFields).toEqual([]);
  });

  it("names the field once the plan moves under the account", async () => {
    const caps = await planCaps();
    const { subscriptionId } = await subscribed({ snapshot: { ...snapshotOf(caps, new Date()) } });
    const before = caps.photoLimit;
    await prisma.plan.update({ where: { id: PLAN_ID }, data: { photoLimit: (before ?? 0) + 7 } });
    try {
      const row = (await subscriptionList()).rows.find((r) => r.id === subscriptionId);
      expect(row?.grandfatheredFields).toEqual(["photoLimit"]);
    } finally {
      await prisma.plan.update({ where: { id: PLAN_ID }, data: { photoLimit: before } });
    }
  });
});

describe("the monthly column adds up to the revenue screen", () => {
  /*
     The column's own promise, asserted as a sum. Created between two reads of
     `mrrNow`, so the difference is exactly what these rows add to the figure
     on `/admin/revenue` — and the column has to say the same.
  */
  it("sums, across these accounts, to what they add to MRR", async () => {
    const before = await mrrNow();
    const accounts = await Promise.all([
      subscribed({ status: "active" }),
      subscribed({ status: "active", term: "annual" }),
      subscribed({ status: "past_due" }),
      // Serving out a period already paid for: still recurring until it ends.
      subscribed({ status: "active", cancelled: true }),
      subscribed({ status: "trialing" }),
      subscribed({ status: "expired" }),
      subscribed({ status: "cancelled", cancelled: true }),
    ]);
    const after = await mrrNow();

    const ids = new Set(accounts.map((m) => m.subscriptionId));
    const rows = (await subscriptionList()).rows.filter((row) => ids.has(row.id));
    expect(rows).toHaveLength(accounts.length);
    const column = rows.reduce((sum, row) => sum + row.monthlyFils, 0);
    expect(column).toBe(after.mrrFils - before.mrrFils);
  });

  it("values a trial at nothing a month, which is what it is worth", async () => {
    const { subscriptionId } = await subscribed({ status: "trialing" });
    const row = (await subscriptionList()).rows.find((r) => r.id === subscriptionId);
    expect(row?.monthlyFils).toBe(0);
    expect(row?.status).toBe("trialing");
  });

  it("values an annual account at ten twelfths of the list price", async () => {
    const { subscriptionId } = await subscribed({ term: "annual" });
    const row = (await subscriptionList()).rows.find((r) => r.id === subscriptionId);
    const caps = await planCaps();
    expect(row?.monthlyFils).toBe(
      monthlyValueFils({ monthlyPriceAed: caps.monthlyPriceAed, annualMonthsCharged: 10 }, "annual"),
    );
    expect(row?.monthlyFils).toBeLessThan(34_900);
  });
});

describe("whose row it is", () => {
  it("names the business by its display name, never its trade name", async () => {
    const { subscriptionId, businessId } = await subscribed({});
    const row = (await subscriptionList()).rows.find((r) => r.id === subscriptionId);
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { displayName: true, tradeName: true },
    });
    expect(row?.businessName).toBe(business.displayName);
    expect(row?.businessName).not.toBe(business.tradeName);
    expect(row?.businessId).toBe(businessId);
  });
});
