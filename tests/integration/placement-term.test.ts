import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  endPlacementsFor,
  SLOT_TERM_DAYS,
  unusedPlacementFils,
  billedPeriodFor,
  creditUnusedPlacement,
} from "@/lib/placement/term";
import { applyEndedCancellations } from "@/lib/billing/service";
import { issueInvoice } from "@/lib/billing/invoice";
import { slotsFor } from "@/lib/placement/service";

/**
 * Decision D2 — a sponsored slot belongs to the subscription that bought it.
 *
 * The rule has three enders (cancellation, downgrade, dunning) and one
 * function, because three enders is three chances for one of them to forget the
 * waitlist. What is asserted here is the function and the path most likely to
 * be exercised in production, plus the arithmetic a seller would argue with.
 *
 * Before this decision the tree said both things at once: `lib/billing/cancel-table.ts`
 * told a cancelling seller their placement "runs to 30 Sep under its own term"
 * and stamped the same row `ends`, in red. Nothing ended it either way.
 */

const PREFIX = "placement-term-test-";
let categoryId: string;
let planId: string;
const madeBusinesses: string[] = [];
let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function makeSeller(): Promise<string> {
  const mark = stamp();
  const business = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-T${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      planId,
      publishedAt: new Date(),
      verificationTier: 2,
      verifiedAt: new Date(),
    },
    select: { id: true },
  });
  madeBusinesses.push(business.id);
  return business.id;
}

const madeCategories: string[] = [];

/**
 * A category of this test's own.
 *
 * The queue is keyed on the category, so two tests sharing one share a queue —
 * and `freed` is a question about *your* position in it. The first version of
 * this file shared a category and the last test read the first test's queue.
 */
async function freshCategory(): Promise<string> {
  const category = await prisma.category.create({
    data: { slug: `${PREFIX}cat-${stamp()}`, name: "Placement term fixture", code: "PTF" },
    select: { id: true },
  });
  madeCategories.push(category.id);
  return category.id;
}

async function giveSlot(businessId: string, endsOn: Date, priceAed = 450, scope = categoryId) {
  return prisma.placementSlot.create({
    data: {
      businessId,
      categoryId: scope,
      monthlyPriceAed: priceAed,
      startsOn: new Date(Date.now() - 5 * 86_400_000),
      endsOn,
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  categoryId = await freshCategory();

  const plan = await prisma.plan.create({
    data: {
      id: `${PREFIX}plan-${stamp()}`,
      name: "Placement term fixture plan",
      monthlyPriceAed: 899,
      teamSeats: 5,
      sponsoredEligible: true,
      sortOrder: 960,
    },
    select: { id: true },
  });
  planId = plan.id;
});

afterAll(async () => {
  for (const businessId of madeBusinesses.splice(0)) {
    await prisma.placementWaitlist.deleteMany({ where: { businessId } });
    await prisma.placementSlot.deleteMany({ where: { businessId } });
    await prisma.subscription.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
  }
  for (const id of madeCategories.splice(0)) {
    await prisma.placementSlot.deleteMany({ where: { categoryId: id } });
    await prisma.placementWaitlist.deleteMany({ where: { categoryId: id } });
    await prisma.category.deleteMany({ where: { id } });
  }
  await prisma.plan.deleteMany({ where: { id: planId } });
  await prisma.$disconnect();
});

describe("what a seller is owed for days they will not get", () => {
  /** A thirty-day term at 450 — a slot no renewal has reached yet. */
  const THIRTY_DAYS = { periodAed: 450, periodDays: 30 };

  it("prices the remainder of a thirty-day term", () => {
    const now = new Date("2026-09-10T00:00:00.000Z");
    const endsOn = new Date("2026-09-25T00:00:00.000Z");
    const owed = unusedPlacementFils(THIRTY_DAYS, endsOn, now);
    expect(owed.days).toBe(15);
    // 450 × 15/30 = 225.00
    expect(owed.fils).toBe(22_500);
  });

  it("owes nothing for a slot with no end date", () => {
    expect(unusedPlacementFils(THIRTY_DAYS, null, new Date())).toEqual({ days: 0, fils: 0 });
  });

  it("owes nothing once the term has already run out", () => {
    const now = new Date("2026-09-30T00:00:00.000Z");
    expect(unusedPlacementFils(THIRTY_DAYS, new Date("2026-09-20T00:00:00.000Z"), now).fils).toBe(0);
  });

  it("prices from what the slot actually cost, not from the list price", () => {
    // The seed carries a Dubai slot at 1,200 against a 450 list price. A credit
    // computed from the constant would short that seller by nearly two thirds.
    const now = new Date("2026-09-10T00:00:00.000Z");
    const endsOn = new Date("2026-09-25T00:00:00.000Z");
    expect(unusedPlacementFils({ periodAed: 1200, periodDays: 30 }, endsOn, now).fils).toBe(60_000);
  });

  it("never credits an annual seller more than the year they paid for", () => {
    /*
       The defect this replaced, and it was real money.

       D2 made the slot belong to the subscription: `runRenewals` charges the
       placement for the whole subscription period and moves `endsOn` to the
       next renewal. On a ten-month year that is 450 × 10 = 4,500 AED for 365
       days. The credit divided the MONTHLY price by a fixed thirty days
       instead — 450 × 365/30 = 5,475 AED — and issued it as a real credit note
       correcting a real tax invoice. 975 AED more than the seller was ever
       charged, on every annual cancellation.
    */
    const now = new Date("2026-09-10T00:00:00.000Z");
    const endsOn = new Date("2027-09-10T00:00:00.000Z");
    const year = { periodAed: 4_500, periodDays: 365 };

    const owed = unusedPlacementFils(year, endsOn, now);
    expect(owed.days).toBe(365);
    // The whole period is unused, so the whole period comes back — and not a
    // fil more than the 4,500 that was taken.
    expect(owed.fils).toBe(450_000);
  });

  it("credits an annual seller the share of the year they will not get", () => {
    const now = new Date("2026-09-10T00:00:00.000Z");
    const endsOn = new Date("2026-12-10T00:00:00.000Z");
    // 91 days of a 365-day year at 4,500: 4,500 × 91/365 = 1,121.92
    const owed = unusedPlacementFils({ periodAed: 4_500, periodDays: 365 }, endsOn, now);
    expect(owed.days).toBe(91);
    expect(owed.fils).toBe(112_192);
  });

  it("uses the month's real length, not a flat thirty days", () => {
    /*
       The same defect at monthly scale, and it ran every month of the year that
       is not exactly thirty days. A full 31-day month at 450 credited
       450 × 31/30 = 465 — more than the month cost.
    */
    const now = new Date("2026-10-01T00:00:00.000Z");
    const endsOn = new Date("2026-11-01T00:00:00.000Z");
    const owed = unusedPlacementFils({ periodAed: 450, periodDays: 31 }, endsOn, now);
    expect(owed.days).toBe(31);
    expect(owed.fils).toBe(45_000);
  });

  it("cannot issue a credit larger than the period it corrects", () => {
    // `endsOn` and the period are two columns written by one event, so this
    // should be unreachable — but a credit note bigger than its invoice is the
    // one outcome the arithmetic must not be able to produce.
    const now = new Date("2026-09-10T00:00:00.000Z");
    const endsOn = new Date("2028-09-10T00:00:00.000Z");
    expect(unusedPlacementFils({ periodAed: 4_500, periodDays: 365 }, endsOn, now).fils).toBe(
      450_000,
    );
  });

  it("agrees with the term the slot is sold in before any renewal", () => {
    expect(SLOT_TERM_DAYS).toBe(30);
  });
});

describe("reading the period a placement was billed over", () => {
  const annual = {
    term: "annual" as const,
    periodStartedAt: new Date("2026-01-01T00:00:00.000Z"),
    renewsAt: new Date("2027-01-01T00:00:00.000Z"),
    plan: { annualMonthsCharged: 10 },
  };

  it("prices a year the way the invoice priced it", () => {
    // Ten months charged, and the period is the real number of days in it.
    expect(billedPeriodFor(450, annual)).toEqual({ periodAed: 4_500, periodDays: 365 });
  });

  it("prices a month as the month", () => {
    expect(
      billedPeriodFor(450, {
        term: "monthly",
        periodStartedAt: new Date("2026-10-01T00:00:00.000Z"),
        renewsAt: new Date("2026-11-01T00:00:00.000Z"),
        plan: { annualMonthsCharged: 10 },
      }),
    ).toEqual({ periodAed: 450, periodDays: 31 });
  });

  it("falls back to the thirty-day term when no renewal has billed the slot", () => {
    // A slot bought mid-period. Nothing has been charged for it, so nothing is
    // credited either — this only keeps the arithmetic defined.
    expect(billedPeriodFor(450, null)).toEqual({ periodAed: 450, periodDays: SLOT_TERM_DAYS });
  });

  it("falls back rather than throwing on an annual term a plan cannot be sold in", () => {
    expect(
      billedPeriodFor(450, { ...annual, plan: { annualMonthsCharged: null } }),
    ).toEqual({ periodAed: 450, periodDays: SLOT_TERM_DAYS });
  });
});

describe("the credit an annual seller actually receives", () => {
  /*
     The end-to-end shape of the defect, and the test that would have caught it.

     D2 made the slot belong to the subscription. `runRenewals` charges the
     placement over the whole subscription period through `periodPriceAed` — on
     a ten-month year, 450 × 10 = 4,500 AED for 365 days — and moves `endsOn` to
     the next renewal. The credit then divided the MONTHLY price by a flat
     thirty days: 450 × 365/30 = 5,475 AED, issued as a credit note correcting
     that very invoice. 975 AED more than was ever taken, on every annual
     cancellation.

     Asserted against the invoice rather than against a hard-coded figure, so
     the test states the rule — a credit note may never exceed what it corrects —
     rather than a number that would have to be recomputed if pricing moved.
  */
  const DAY = 86_400_000;

  it("never exceeds the placement line on the invoice it corrects", async () => {
    const now = new Date();
    const periodStartedAt = new Date(now.getTime() - DAY);
    const renewsAt = new Date(periodStartedAt.getTime() + 365 * DAY);

    const annualPlan = await prisma.plan.create({
      data: {
        id: `${PREFIX}annual-${stamp()}`,
        name: "Placement credit fixture plan",
        monthlyPriceAed: 899,
        annualMonthsCharged: 10,
        teamSeats: 5,
        sponsoredEligible: true,
        sortOrder: 961,
      },
      select: { id: true, annualMonthsCharged: true },
    });

    const seller = await makeSeller();
    await prisma.business.update({ where: { id: seller }, data: { planId: annualPlan.id } });
    await prisma.subscription.create({
      data: {
        businessId: seller,
        planId: annualPlan.id,
        status: "active",
        term: "annual",
        periodStartedAt,
        renewsAt,
        anchorDay: 1,
      },
    });

    // The slot, running to the subscription's own renewal — which is what the
    // renewal job writes, and what made the old denominator wrong.
    const scope = await freshCategory();
    await giveSlot(seller, renewsAt, 450, scope);

    // What the renewal actually charged for that placement: ten months.
    const chargedFils = 450 * 10 * 100;
    await issueInvoice({
      businessId: seller,
      docType: "tax_invoice",
      issuedAt: periodStartedAt,
      lines: [
        { kind: "placement", description: "Sponsored placement — fixture", fils: chargedFils },
      ],
    });

    const ended = await prisma.$transaction((tx) => endPlacementsFor(tx, seller, now, "cancelled"));
    expect(ended).toHaveLength(1);
    await creditUnusedPlacement(ended, seller, now);

    const note = await prisma.invoice.findFirst({
      where: { businessId: seller, docType: "credit_note" },
      orderBy: { issuedAt: "desc" },
      select: { lines: { select: { amountAed: true, qty: true } } },
    });
    expect(note, "a cancelled placement inside its period owes a credit").not.toBeNull();

    // Stored in AED on the line, so back to fils to compare with the charge.
    const creditedFils = Math.abs(
      note!.lines.reduce((sum, line) => sum + Math.round(Number(line.amountAed) * 100) * line.qty, 0),
    );

    // The rule. Under the old arithmetic this was 547,500 against a 450,000
    // charge — a credit note 21.7% larger than the invoice it corrects.
    expect(creditedFils).toBeLessThanOrEqual(chargedFils);

    // And it is the right number, not merely a small enough one: 364 of 365
    // days unused, at what the year actually cost.
    expect(ended[0]!.unusedDays).toBe(364);
    expect(creditedFils).toBe(Math.round((chargedFils * 364) / 365));
  });
});

describe("ending a slot", () => {
  it("stops it, and tells whoever is first in the queue", async () => {
    const holder = await makeSeller();
    const waiting = await makeSeller();
    const alsoWaiting = await makeSeller();
    const now = new Date();

    const slot = await giveSlot(holder, new Date(now.getTime() + 20 * 86_400_000));
    // Two in the queue, in the order they joined. Only the first is told.
    await prisma.placementWaitlist.create({
      data: { businessId: waiting, categoryId, createdAt: new Date(now.getTime() - 60_000) },
    });
    await prisma.placementWaitlist.create({
      data: { businessId: alsoWaiting, categoryId, createdAt: now },
    });

    const ended = await prisma.$transaction((tx) =>
      endPlacementsFor(tx, holder, now, "cancelled"),
    );

    expect(ended).toHaveLength(1);
    expect(ended[0]!.nextInQueue).toBe(waiting);
    expect(ended[0]!.reason).toBe("cancelled");
    expect(ended[0]!.unusedDays).toBeGreaterThan(0);

    // The row keeps its dates rather than being deleted, so revenue reporting
    // can still say what was sold and for how long.
    const after = await prisma.placementSlot.findUniqueOrThrow({ where: { id: slot.id } });
    expect(after.endsOn?.getTime()).toBe(now.getTime());

    const told = await prisma.placementWaitlist.findFirstOrThrow({
      where: { businessId: waiting, categoryId },
    });
    expect(told.notifiedAt).not.toBeNull();

    const notTold = await prisma.placementWaitlist.findFirstOrThrow({
      where: { businessId: alsoWaiting, categoryId },
    });
    expect(notTold.notifiedAt).toBeNull();
  }, 60_000);

  it("ends a slot scoped to an emirate, which the buying screen cannot even see", async () => {
    /*
       `slotsFor` and `takeSlot` are national-only until the per-emirate picker
       lands. The ender must not inherit that blind spot — the seed carries a
       Dubai slot, so a seller keeping the top of a category after cancelling is
       a case that exists rather than one being defended against.
    */
    const holder = await makeSeller();
    const now = new Date();
    await prisma.placementSlot.create({
      data: {
        businessId: holder,
        categoryId,
        emirate: "dubai",
        monthlyPriceAed: 1200,
        startsOn: new Date(now.getTime() - 86_400_000),
        endsOn: new Date(now.getTime() + 10 * 86_400_000),
      },
    });

    const ended = await prisma.$transaction((tx) =>
      endPlacementsFor(tx, holder, now, "downgraded"),
    );
    expect(ended).toHaveLength(1);
    expect(ended[0]!.emirate).toBe("dubai");
    expect(ended[0]!.monthlyPriceAed).toBe(1200);
  }, 60_000);

  it("shows an emirate-scoped slot as held, rather than as available", async () => {
    /*
       The read had the same blind spot as the write, and only the write's was
       a documented limitation.

       `slotsFor` filtered on `emirate === null`, so the seller holding the
       seeded Dubai slot was shown that category as "Available, AED 450 a
       month" — their own slot, invisible, at the wrong price, with a button
       offering to sell them a second one.
    */
    const scope = await freshCategory();
    const holder = await makeSeller();
    const now = new Date();
    await prisma.placementSlot.create({
      data: {
        businessId: holder,
        categoryId: scope,
        emirate: "dubai",
        monthlyPriceAed: 1200,
        startsOn: new Date(now.getTime() - 86_400_000),
        endsOn: new Date(now.getTime() + 10 * 86_400_000),
      },
    });

    const view = await slotsFor(holder, [scope], now);
    expect(view[0]?.mine).toBe(true);
    expect(view[0]?.emirate).toBe("dubai");
    // From the row, not from `SLOT_MONTHLY_AED`.
    expect(view[0]?.monthlyPriceAed).toBe(1200);
  }, 60_000);

  it("does nothing to a slot that already ended", async () => {
    const holder = await makeSeller();
    const now = new Date();
    await giveSlot(holder, new Date(now.getTime() - 86_400_000));

    const ended = await prisma.$transaction((tx) => endPlacementsFor(tx, holder, now, "lapsed"));
    expect(ended).toEqual([]);
  }, 60_000);
});

describe("the cancellation that reaches its date takes the slot with it", () => {
  it("ends the placement and frees it for the queue", async () => {
    const scope = await freshCategory();
    const holder = await makeSeller();
    const waiting = await makeSeller();
    const now = new Date();

    await prisma.subscription.create({
      data: {
        businessId: holder,
        planId,
        status: "active",
        startedAt: new Date(now.getTime() - 90 * 86_400_000),
        renewsAt: new Date(now.getTime() - 86_400_000),
        // Cancelled, and its date has arrived.
        cancelledAt: new Date(now.getTime() - 10 * 86_400_000),
        endsAt: new Date(now.getTime() - 60_000),
      },
    });
    await giveSlot(holder, new Date(now.getTime() + 15 * 86_400_000), 450, scope);
    await prisma.placementWaitlist.create({
      data: { businessId: waiting, categoryId: scope },
    });

    const result = await applyEndedCancellations(now);
    expect(result.placementsEnded).toBeGreaterThanOrEqual(1);

    const live = await prisma.placementSlot.count({
      where: {
        businessId: holder,
        startsOn: { lte: now },
        OR: [{ endsOn: null }, { endsOn: { gt: now } }],
      },
    });
    expect(live).toBe(0);

    // And the seller who was waiting is told, on the screen that reads it.
    const view = await slotsFor(waiting, [scope], new Date(now.getTime() + 1000));
    expect(view[0]?.freed).toBe(true);
  }, 60_000);
});
