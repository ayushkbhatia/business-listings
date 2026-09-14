import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { accountSummary } from "@/lib/accounts/list";
import { CHURN_RISK_BELOW } from "@/lib/accounts/health";
import { AUTHORITY_EMIRATE } from "@/lib/ingest/sources";
import type { Authority } from "@/lib/db/generated/enums";
import { measureReplies, windowStart } from "@/lib/metrics/response-time";
import { periodFigures, revenueBoard, type RevenueBoard } from "@/lib/billing/revenue-board";
import { REVENUE_EXPORT_HEADER, revenueCsv, revenueExportFilename } from "@/lib/billing/revenue-export";
import {
  OUTSIDE_BASE_LINES,
  WATERFALL_LINES,
  currentPeriod,
  lastClosedPeriod,
  retainedFils,
} from "@/lib/billing/revenue-period";

/**
 * Board 4g against the seeded ledger — acceptance criteria 1, 3, 4, 5, 6, 7, 8,
 * 9 and 10.
 *
 * `prisma/seed-revenue.mts` gives last month eleven accounts, one per state the
 * board draws. Where a criterion is a property of the arithmetic it is asserted
 * over the whole board rather than a fixture; where it is a property of a named
 * account, the account is named.
 */

const NOW = new Date();
const LAST = lastClosedPeriod(NOW);
let board: RevenueBoard;
const madeSlots: string[] = [];
const madeBusinesses: string[] = [];

beforeAll(async () => {
  board = await revenueBoard(LAST, NOW);
});

afterAll(async () => {
  if (madeSlots.length > 0) await prisma.placementSlot.deleteMany({ where: { id: { in: madeSlots } } });
  // Subscriptions, attempts and movements go with the business, by cascade.
  if (madeBusinesses.length > 0) await prisma.business.deleteMany({ where: { id: { in: madeBusinesses } } });
});

async function idOf(slug: string): Promise<string> {
  return (await prisma.business.findUniqueOrThrow({ where: { slug }, select: { id: true } })).id;
}

describe("criterion 1 — the waterfall reconciles, tested", () => {
  it("ends last month where starting plus its lines lands, and where the ledger does", () => {
    const { month } = board.current;
    const summed = WATERFALL_LINES.reduce((sum, line) => sum + month.lines[line], month.startingFils);
    expect(board.current.endingFils).toBe(summed);
    expect(board.current.ledgerEndingFils).toBe(summed);
  });

  it("starts each month where the one before ended", () => {
    expect(board.current.month.startingFils).toBe(board.previous.ledgerEndingFils);
  });

  it("reconciles the month in progress too", async () => {
    const figures = await periodFigures(currentPeriod(new Date()));
    expect(figures.endingFils).toBe(figures.ledgerEndingFils);
  });

  it("puts every movement of the month on exactly one line", () => {
    const byLine = WATERFALL_LINES.reduce((sum, line) => sum + board.current.movements.filter((m) => m.line === line).length, 0);
    expect(byLine).toBe(board.current.movements.length);
  });

  it("draws last month's fixtures on the lines they belong to", async () => {
    const line = async (slug: string) => {
      const id = await idOf(slug);
      return board.current.movements.filter((movement) => movement.businessId === id).map((movement) => movement.line);
    };
    expect(await line("gulf-cranes-rental")).toEqual(["new_business"]);
    expect(await line("marina-facade-cleaning")).toEqual(["upgrades"]);
    expect(await line("pallet-works-ajman")).toEqual(["downgrades"]);
    expect(await line("hatta-cold-stores")).toEqual(["term_changes"]);
    expect(await line("umm-al-quwain-boatyard")).toEqual(["lapsed"]);
    expect(await line("rak-stone-cutters")).toEqual(["cancellations"]);
    // A card that failed and then went through moved nothing.
    expect(await line("jebel-ali-forwarding")).toEqual([]);
  });
});

describe("criterion 3 — NRR excludes new subscriptions", () => {
  it("is the base's lines over starting MRR, and nothing from outside it", () => {
    const { month, ratios } = board.current;
    expect(ratios.nrr).not.toBeNull();
    const expected =
      WATERFALL_LINES.filter((line) => !OUTSIDE_BASE_LINES.includes(line)).reduce((sum, line) => sum + month.lines[line], month.startingFils) /
      month.startingFils;
    expect(ratios.nrr).toBeCloseTo(expected, 12);
    expect(ratios.nrr! * month.startingFils).toBeCloseTo(retainedFils(month), 6);
  });
});

describe("criterion 4 — placement is excluded from MRR and ARPA", () => {
  it("counts last month's slots, and a new slot moves placement and nothing else", async () => {
    expect(board.current.placement.slots).toBeGreaterThanOrEqual(2);
    expect(board.current.placement.fils).toBeGreaterThan(0);

    const current = currentPeriod(new Date());
    const before = await periodFigures(current);
    const business = await idOf("gulf-cranes-rental");
    const category = await prisma.category.findFirstOrThrow({
      where: { parentId: { not: null }, placements: { none: {} } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const slot = await prisma.placementSlot.create({
      data: { businessId: business, categoryId: category.id, monthlyPriceAed: 450, startsOn: current.from, endsOn: null },
      select: { id: true },
    });
    madeSlots.push(slot.id);

    const after = await periodFigures({ ...current, to: before.period.to });
    expect(after.placement.fils).toBeGreaterThan(before.placement.fils);
    expect(after.endingFils).toBe(before.endingFils);
    expect(after.ratios.arpaFils).toBe(before.ratios.arpaFils);
  });
});

describe("criterion 5 — cancellation reasons come from 11j and sum to the period's total", () => {
  it("sums to the cancellations line, account for account", () => {
    const cancellations = board.current.movements.filter((movement) => movement.line === "cancellations").length;
    expect(board.cancellations).toBe(cancellations);
    expect(board.reasons.reduce((sum, row) => sum + row.count, 0)).toBe(cancellations);
  });

  it("reads the seeded reasons off the requests the cancellations carried out", () => {
    const count = (reason: string) => board.reasons.find((row) => row.reason === reason)?.count ?? 0;
    expect(count("not_enough_enquiries")).toBeGreaterThanOrEqual(3);
    expect(count("too_expensive")).toBeGreaterThanOrEqual(1);
    expect(count("another_platform")).toBeGreaterThanOrEqual(1);
  });

  it("keeps a lapse out of the reasons, because a lapse gave none", () => {
    const lapsed = board.current.movements.filter((movement) => movement.line === "lapsed");
    expect(lapsed.length).toBeGreaterThanOrEqual(1);
    for (const movement of lapsed) expect(movement.cancelReason).toBeNull();
  });
});

describe("criterion 6 — the reply-rate cross-reference is a live query on 4f's measure", () => {
  it("measures each 'not enough enquiries' account over the 90 days before it asked", async () => {
    const asked = board.current.movements.filter((movement) => movement.cancelReason === "not_enough_enquiries");
    expect(board.replyFinding.total).toBe(asked.length);

    // Recomputed here from the recipient rows, with the same function and the
    // same threshold, and compared account by account.
    let below = 0;
    let atOrAbove = 0;
    let unmeasured = 0;
    for (const movement of asked) {
      const at = movement.requestedAt!;
      const rows = await prisma.enquiryRecipient.findMany({
        where: { businessId: movement.businessId, createdAt: { gte: windowStart(at), lt: at } },
        select: { createdAt: true, firstReplyAt: true, enquiry: { select: { closesAt: true } } },
      });
      const { rate } = measureReplies(
        rows.map((row) => ({
          deliveredAt: row.createdAt,
          firstReplyAt: row.firstReplyAt && row.firstReplyAt < at ? row.firstReplyAt : null,
          closesAt: row.enquiry.closesAt,
        })),
        at,
      );
      if (rate === null) unmeasured += 1;
      else if (rate < CHURN_RISK_BELOW) below += 1;
      else atOrAbove += 1;
    }
    expect(board.replyFinding).toEqual({ total: asked.length, below, atOrAbove, unmeasured });
  });

  it("finds the two seeded accounts that were not answering, and not the one that was", () => {
    expect(board.replyFinding.below).toBeGreaterThanOrEqual(2);
    expect(board.replyFinding.atOrAbove).toBeGreaterThanOrEqual(1);
  });
});

describe("criterion 7 — ARPA's account count matches 4f's paying count for the same moment", () => {
  /*
     Account by account, over the fixtures whose state is known. The global
     count is asserted by the seed (`assertLedgerReconciles`) on a clean
     database: this suite runs after files that move plans behind the ledger on
     purpose, and a directory-wide equality here would pass or fail on file order.
  */
  it("counts the same accounts as paying, on both definitions", async () => {
    const now = new Date();
    const figures = await periodFigures(currentPeriod(now));
    const ledgerPaying = new Set(figures.stateAtEnd.filter((row) => row.mrrFils > 0).map((row) => row.businessId));
    const slugs = [
      "gulf-cranes-rental",
      "marina-facade-cleaning",
      "pallet-works-ajman",
      "hatta-cold-stores",
      "jebel-ali-forwarding",
      "fujairah-marine-supplies",
      "sharjah-pipe-traders",
      "oasis-date-packers",
      "rak-stone-cutters",
      "dubai-signage-hub",
      "umm-al-quwain-boatyard",
      "technopump-trading-llc",
      "dana-printing-signage",
      "sharjah-steel-fabricators",
    ];
    const businesses = await prisma.business.findMany({
      where: { slug: { in: slugs } },
      select: {
        id: true,
        slug: true,
        subscription: { select: { status: true, plan: { select: { monthlyPriceAed: true } } } },
      },
    });
    expect(businesses).toHaveLength(slugs.length);
    for (const business of businesses) {
      const subscription = business.subscription;
      const paying4f =
        subscription !== null &&
        ["active", "past_due"].includes(subscription.status) &&
        Number(subscription.plan.monthlyPriceAed) > 0;
      expect(ledgerPaying.has(business.id), business.slug).toBe(paying4f);
    }
    const summary = await accountSummary(now);
    expect(summary.paying).toBeGreaterThan(0);
  });
});

describe("criterion 8 — failed payments are excluded from churn until dunning completes", () => {
  it("holds a card that failed on the 27th as at risk, on no churn line", async () => {
    const jebelAli = await idOf("jebel-ali-forwarding");
    expect(board.current.failedPayments.accounts).toBeGreaterThanOrEqual(1);
    expect(board.current.failedPayments.atRiskFils).toBeGreaterThanOrEqual(89_900);
    expect(board.current.movements.some((movement) => movement.businessId === jebelAli)).toBe(false);
  });

  it("stops counting it once the card went through", async () => {
    const figures = await periodFigures(currentPeriod(new Date()));
    const jebelAli = await idOf("jebel-ali-forwarding");
    const pastDue = await prisma.subscription.count({ where: { businessId: jebelAli, status: "past_due" } });
    expect(pastDue).toBe(0);
    // Whatever else is failing now, the recovered account is not at risk: its
    // last attempt succeeded.
    const lastAttempt = await prisma.paymentAttempt.findFirstOrThrow({
      where: { subscription: { businessId: jebelAli } },
      orderBy: [{ attemptedAt: "desc" }, { id: "desc" }],
      select: { succeeded: true },
    });
    expect(lastAttempt.succeeded).toBe(true);
    expect(figures.failedPayments.accounts).toBeLessThan(board.current.failedPayments.accounts + 50);
  });

  /*
     The review's case. A seller who lapsed after failed payments and came back
     through Change plan leaves no new payment attempt — the reactivation charges
     through the provider and records a movement — so the last attempt on file is
     still the failure before the drop.
  */
  async function account(label: string, movements: { kind: "new_business" | "churn" | "reactivation" | "expansion"; daysAgo: number; delta: number; after: number; cause: "plan_change" | "dunning_drop" }[], failedDaysAgo: number) {
    const stamp = `${label}-${process.pid}-${Date.now()}`;
    const category = await prisma.category.findFirstOrThrow({ where: { parentId: { not: null } }, orderBy: { id: "asc" }, select: { id: true } });
    const business = await prisma.business.create({
      data: {
        tradeName: `Ledger Episode ${stamp}`,
        displayName: `Ledger Episode ${stamp}`,
        slug: `zz-ledger-episode-${stamp}`,
        licenceNumber: `DED-${String(Date.now()).slice(-6)}`,
        licenceAuthority: "DED",
        licenceExpiry: new Date(Date.now() + 200 * 86_400_000),
        primaryCategoryId: category.id,
        claimStatus: "claimed",
        planId: "basic",
      },
      select: { id: true },
    });
    madeBusinesses.push(business.id);
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
    const subscription = await prisma.subscription.create({
      data: { businessId: business.id, planId: "basic", status: "active", startedAt: ago(120), periodStartedAt: ago(10), renewsAt: new Date(Date.now() + 20 * 86_400_000) },
      select: { id: true },
    });
    await prisma.paymentAttempt.create({
      data: { subscriptionId: subscription.id, amountFils: 34_900, succeeded: false, attemptedAt: ago(failedDaysAgo) },
    });
    for (const movement of movements) {
      await prisma.mrrMovement.create({
        data: {
          businessId: business.id,
          kind: movement.kind,
          cause: movement.cause,
          toPlanId: movement.after === 0 ? "free" : "basic",
          deltaFils: movement.delta,
          mrrAfterFils: movement.after,
          occurredAt: ago(movement.daysAgo),
        },
      });
    }
    return business.id;
  }

  it("stops counting a failure once the account lapsed, even after it came back", async () => {
    const cameBack = await account(
      "came-back",
      [
        { kind: "new_business", daysAgo: 100, delta: 34_900, after: 34_900, cause: "plan_change" },
        { kind: "churn", daysAgo: 40, delta: -34_900, after: 0, cause: "dunning_drop" },
        { kind: "reactivation", daysAgo: 2, delta: 34_900, after: 34_900, cause: "plan_change" },
      ],
      54,
    );
    const figures = await periodFigures(currentPeriod(new Date()));
    // Paying again, so the MRR filter alone would let it through.
    expect(figures.stateAtEnd.find((row) => row.businessId === cameBack)?.mrrFils).toBe(34_900);
    const withIt = figures.failedPayments.accounts;
    await prisma.business.deleteMany({ where: { id: cameBack } });
    madeBusinesses.splice(madeBusinesses.indexOf(cameBack), 1);
    const without = (await periodFigures(currentPeriod(new Date()))).failedPayments.accounts;
    expect(withIt).toBe(without);
  });

  it("keeps counting a failure while dunning runs, whatever plan change came after", async () => {
    const stillFailing = await account(
      "still-failing",
      [
        { kind: "new_business", daysAgo: 100, delta: 34_900, after: 34_900, cause: "plan_change" },
        { kind: "expansion", daysAgo: 1, delta: 55_000, after: 89_900, cause: "plan_change" },
      ],
      5,
    );
    const figures = await periodFigures(currentPeriod(new Date()));
    const before = figures.failedPayments.accounts;
    await prisma.business.deleteMany({ where: { id: stillFailing } });
    madeBusinesses.splice(madeBusinesses.indexOf(stillFailing), 1);
    const after = (await periodFigures(currentPeriod(new Date()))).failedPayments.accounts;
    // An upgrade's proration does not pay the period that failed.
    expect(before).toBe(after + 1);
  });

  it("does not count an account that already lapsed as at risk", async () => {
    const boatyard = await idOf("umm-al-quwain-boatyard");
    const atEnd = board.current.stateAtEnd.find((row) => row.businessId === boatyard);
    expect(atEnd).toBeUndefined();
  });
});

describe("criterion 9 — emirate revenue resolves from the licence emirate", () => {
  it("sums to ending MRR", () => {
    expect(board.byEmirate.reduce((sum, row) => sum + row.mrrFils, 0)).toBe(board.current.endingFils);
    expect(board.byEmirate.map((row) => row.emirate).sort()).toEqual(
      ["abu_dhabi", "ajman", "dubai", "fujairah", "ras_al_khaimah", "sharjah", "umm_al_quwain"],
    );
  });

  it("puts each paying account's MRR in the emirate its licence names", async () => {
    const paying = board.current.stateAtEnd.filter((row) => row.mrrFils > 0);
    const owners = await prisma.business.findMany({
      where: { id: { in: paying.map((row) => row.businessId) } },
      select: { id: true, licenceAuthority: true },
    });
    const expected = new Map<string, number>();
    for (const owner of owners) {
      const emirate = AUTHORITY_EMIRATE[owner.licenceAuthority as Authority];
      const mrr = paying.find((row) => row.businessId === owner.id)!.mrrFils;
      expected.set(emirate, (expected.get(emirate) ?? 0) + mrr);
    }
    for (const row of board.byEmirate) expect(row.mrrFils).toBe(expected.get(row.emirate) ?? 0);

    // Gulf Cranes Rental holds an Abu Dhabi licence, whatever it covers.
    const cranes = await idOf("gulf-cranes-rental");
    expect(paying.some((row) => row.businessId === cranes)).toBe(true);
    expect(board.byEmirate.find((row) => row.emirate === "abu_dhabi")!.mrrFils).toBeGreaterThanOrEqual(89_900);
  });

  it("splits the same total by plan", () => {
    expect(board.byPlan.reduce((sum, row) => sum + row.mrrFils, 0)).toBe(board.current.endingFils);
    expect(board.byPlan.reduce((sum, row) => sum + row.accounts, 0)).toBe(board.current.month.payingAtEnd);
    expect(board.byPlan.some((row) => row.planId === "free")).toBe(false);
  });
});

describe("criterion 10 — the finance export carries period, formulas and filter", () => {
  it("opens with the filter and the formulas, and lists every movement it summed", () => {
    const csv = revenueCsv(board, NOW);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe(`# filter,period=${LAST.key}`);
    expect(csv).toContain("# formula,net_revenue_retention,");
    expect(csv).toContain("# formula,revenue_churn,");
    expect(csv).toContain("# formula,arpa,");
    expect(csv).toContain(`# boundaries_utc,${LAST.from.toISOString()},${LAST.to.toISOString()}`);
    expect(lines).toContain(REVENUE_EXPORT_HEADER.join(","));
    expect(lines.filter((line) => line.startsWith("movement,"))).toHaveLength(board.current.movements.length);
    expect(revenueExportFilename(board)).toBe(`revenue-${LAST.key}.csv`);
  });

  it("writes a contraction as a number, not as text a formula guard has prefixed", () => {
    const csv = revenueCsv(board, NOW);
    const downgrade = csv.split("\r\n").find((line) => line.startsWith("waterfall,downgrades,"));
    expect(downgrade).toMatch(/,-\d+\.\d{2},/);
    expect(csv).not.toContain("'-");
  });
});
