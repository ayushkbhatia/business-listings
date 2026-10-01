import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { dunningQueue, dunningSummary, type DunningRow } from "@/lib/billing/dunning-queue";
import { DROP_TO_FREE_DAY, type DunningStage } from "@/lib/billing/dunning";
import { priceRenewal, RENEWAL_SELECT } from "@/lib/billing/renewal-job";
import { consoleProvider, setPaymentProvider } from "@/lib/billing/provider";
import type { SubStatus } from "@/lib/db/generated/enums";

/**
 * Board 12e's failed-payments queue, read — `/admin/dunning` and the card on
 * `/admin/plans`. Two live screens and, until this file, no test of the read
 * they share.
 *
 * The sequence itself is tested twice already: its arithmetic in
 * `lib/billing/dunning.test.ts` and its writes in `commercials.test.ts`. What
 * is pinned here is what a reader of the queue is told, which was wrong four
 * ways:
 *
 * - **A row not yet started read "already on Free".** No `pastDueSince` made
 *   the drop date null, and the column renders null as dropped.
 * - **Attempts were the account's whole history.** A year of paid renewals
 *   read "12 tried" beside an account that had failed once, and a lapse it had
 *   recovered from months ago supplied the reason and the amount.
 * - **The amount was a third derivation**, the plan's period plus VAT without
 *   the placements, agreeing with neither the renewal nor the retry — and on a
 *   dropped account nothing was charged on, AED 0.00 against Free.
 * - **The header summed its own copy** of the figures the card computes.
 *
 * A plan of this file's own at AED 349, so the figures are the ratified Basic
 * shape without editing the seeded row, and businesses of its own because
 * `dunningQueue` reads every past-due subscription in the database and the
 * assertions are about these rows and no others.
 */

const DAY = 86_400_000;
const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
const PLAN_ID = `dq-test-${stamp}`;
let categoryId = "";
let seq = 0;
const made: string[] = [];

/** AED 349 a month, a ten-month year, and 5% on either. */
const MONTH = 34_900 + 1_745;
const YEAR = 349_000 + 17_450;

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
      name: `Dunning queue ${stamp}`,
      monthlyPriceAed: 349,
      annualMonthsCharged: 10,
      sortOrder: 91,
    },
  });
});

afterEach(() => {
  setPaymentProvider(consoleProvider);
});

afterAll(async () => {
  // Subscriptions, attempts and slots cascade from the business.
  await prisma.business.deleteMany({ where: { id: { in: made } } });
  await prisma.plan.deleteMany({ where: { id: PLAN_ID } });
  await prisma.$disconnect();
});

interface Attempt {
  at: Date;
  succeeded: boolean;
  amountFils?: number;
  message?: string;
}

async function account(options: {
  status?: SubStatus;
  stage?: DunningStage;
  pastDueSince?: Date | null;
  term?: "monthly" | "annual";
  planId?: string;
  attempts?: Attempt[];
}) {
  seq += 1;
  const mark = `${stamp}-${seq}`;
  const business = await prisma.business.create({
    data: {
      displayName: `Dunning Queue ${mark}`,
      tradeName: `Dunning Queue ${mark} LLC`,
      slug: `dunning-queue-${mark}`,
      licenceNumber: `DED-DQ${String(seq).padStart(2, "0")}${stamp.slice(-4)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * DAY),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      planId: options.planId ?? PLAN_ID,
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  made.push(business.id);

  const stage = options.stage ?? "none";
  const subscription = await prisma.subscription.create({
    data: {
      businessId: business.id,
      planId: options.planId ?? PLAN_ID,
      status: options.status ?? "past_due",
      term: options.term ?? "monthly",
      startedAt: new Date(Date.now() - 400 * DAY),
      periodStartedAt: new Date(Date.now() - 31 * DAY),
      renewsAt: new Date(Date.now() - DAY),
      dunningStage: stage,
      pastDueSince: options.pastDueSince === undefined ? null : options.pastDueSince,
    },
    select: { id: true },
  });

  for (const attempt of options.attempts ?? []) {
    await prisma.paymentAttempt.create({
      data: {
        subscriptionId: subscription.id,
        amountFils: attempt.amountFils ?? MONTH,
        succeeded: attempt.succeeded,
        providerMessage: attempt.message ?? (attempt.succeeded ? null : "Card declined"),
        attemptedAt: attempt.at,
      },
    });
  }

  return { businessId: business.id, subscriptionId: subscription.id };
}

async function rowOf(subscriptionId: string, now: Date): Promise<DunningRow | undefined> {
  const queue = await dunningQueue(now);
  return queue.rows.find((row) => row.subscriptionId === subscriptionId);
}

describe("who is in the queue", () => {
  it("lists every account somewhere in the sequence, and nobody who is paying", async () => {
    const now = new Date();
    const since = new Date(now.getTime() - 2 * DAY);
    const paying = await account({ status: "active" });
    const pastDue = await account({ pastDueSince: since });
    // A seller who cancelled mid-sequence: `cancelSubscription` writes
    // `active` over `past_due`, and the stage it had reached stays.
    const cancelledMidway = await account({ status: "active", stage: "retry", pastDueSince: since });
    const dropped = await account({ status: "active", stage: "dropped", pastDueSince: since });

    const ids = new Set((await dunningQueue(now)).rows.map((row) => row.subscriptionId));
    expect(ids.has(paying.subscriptionId)).toBe(false);
    expect(ids.has(pastDue.subscriptionId)).toBe(true);
    expect(ids.has(cancelledMidway.subscriptionId)).toBe(true);
    expect(ids.has(dropped.subscriptionId)).toBe(true);
  });

  it("puts the oldest failure first, and an account not started yet last", async () => {
    const now = new Date();
    const notStarted = await account({ pastDueSince: null });
    const recent = await account({ stage: "retry", pastDueSince: new Date(now.getTime() - 2 * DAY) });
    const older = await account({ stage: "emailed", pastDueSince: new Date(now.getTime() - 8 * DAY) });

    const mine = new Set([notStarted, recent, older].map((a) => a.subscriptionId));
    const order = (await dunningQueue(now)).rows
      .filter((row) => mine.has(row.subscriptionId))
      .map((row) => row.subscriptionId);
    expect(order).toEqual([older.subscriptionId, recent.subscriptionId, notStarted.subscriptionId]);
  });
});

describe("where each account is, and what happens to it next", () => {
  /*
     The defect. Null was the drop date for two different reasons, and the
     column draws null as "already on Free" — so an account the sequence had not
     touched yet was shown as one that had finished it. The job reads a missing
     date as "starts now"; the queue now reads it the same way.
  */
  it("reads an account with no start date as day zero, not as already on Free", async () => {
    const now = new Date();
    const { subscriptionId } = await account({ pastDueSince: null });
    const row = await rowOf(subscriptionId, now);

    expect(row?.stage).toBe("none");
    expect(row?.daysPastDue).toBe(0);
    expect(row?.next).toEqual({ kind: "retry_silently", stage: "retry" });
    expect(row?.dropsToFreeAt?.getTime()).toBe(now.getTime() + DROP_TO_FREE_DAY * DAY);
  });

  it("says how far in it is and names the next step", async () => {
    const now = new Date();
    const since = new Date(now.getTime() - 8 * DAY);
    const { subscriptionId } = await account({ stage: "emailed", pastDueSince: since });
    const row = await rowOf(subscriptionId, now);

    expect(row?.daysPastDue).toBe(8);
    expect(row?.next).toEqual({ kind: "send", channel: "whatsapp", stage: "messaged" });
    expect(row?.dropsToFreeAt?.getTime()).toBe(since.getTime() + DROP_TO_FREE_DAY * DAY);
  });

  /*
     Frozen at the moment the card fails. A missed run, or a page read a week
     later, does not move the date an account drops — it is what an ops lead
     quotes to the seller on the phone.
  */
  it("fixes the drop date when the card fails, however late the page is read", async () => {
    const now = new Date();
    const since = new Date(now.getTime() - 3 * DAY);
    const { subscriptionId } = await account({ stage: "retry", pastDueSince: since });

    const today = await rowOf(subscriptionId, now);
    const later = await rowOf(subscriptionId, new Date(now.getTime() + 4 * DAY));
    expect(today?.dropsToFreeAt?.getTime()).toBe(later?.dropsToFreeAt?.getTime());
    expect(later!.daysPastDue - today!.daysPastDue).toBe(4);
  });

  it("gives a dropped account no drop date and nothing to do", async () => {
    const now = new Date();
    const { subscriptionId } = await account({
      status: "active",
      stage: "dropped",
      pastDueSince: new Date(now.getTime() - 20 * DAY),
    });
    const row = await rowOf(subscriptionId, now);
    expect(row?.dropsToFreeAt).toBeNull();
    expect(row?.next).toEqual({ kind: "wait" });
  });
});

describe("the attempts column is this failure, not the account's history", () => {
  it("counts the attempts since the card failed, and reads the newest refusal", async () => {
    const now = new Date();
    const since = new Date(now.getTime() - 4 * DAY);
    const { subscriptionId } = await account({
      stage: "retry",
      pastDueSince: since,
      attempts: [
        // Three renewals that went through, before any of this.
        { at: new Date(now.getTime() - 94 * DAY), succeeded: true },
        { at: new Date(now.getTime() - 64 * DAY), succeeded: true },
        { at: new Date(now.getTime() - 34 * DAY), succeeded: true },
        // The renewal that failed, on the instant it went past due…
        { at: since, succeeded: false, message: "Insufficient funds", amountFils: MONTH },
        // …and dunning's retry.
        { at: new Date(since.getTime() + 3_600_000), succeeded: false, message: "Card expired" },
      ],
    });
    const row = await rowOf(subscriptionId, now);

    expect(row?.attempts).toBe(2);
    expect(row?.lastAttemptFailed).toBe("Card expired");
    expect(row?.amountFils).toBe(MONTH);
  });

  it("does not take a reason or an amount from a lapse already recovered from", async () => {
    const now = new Date();
    const { subscriptionId } = await account({
      pastDueSince: new Date(now.getTime() - DAY),
      attempts: [
        // Failed in the spring on another plan's price, then paid.
        { at: new Date(now.getTime() - 200 * DAY), succeeded: false, message: "Old card", amountFils: 94_395 },
        { at: new Date(now.getTime() - 199 * DAY), succeeded: true },
      ],
    });
    const row = await rowOf(subscriptionId, now);

    expect(row?.attempts).toBe(0);
    expect(row?.lastAttemptFailed).toBeNull();
    expect(row?.amountFils).toBe(MONTH);
  });
});

describe("the amount is what the card was asked for, VAT included", () => {
  it("is the refused attempt's figure where there is one", async () => {
    const now = new Date();
    const since = new Date(now.getTime() - 2 * DAY);
    const { subscriptionId } = await account({
      stage: "retry",
      pastDueSince: since,
      // The renewal asked for the month and a placement — more than the plan.
      attempts: [{ at: since, succeeded: false, amountFils: 84_000 }],
    });
    expect((await rowOf(subscriptionId, now))?.amountFils).toBe(84_000);
  });

  /*
     With no attempt yet, what the retry will ask for — from `priceRenewal`,
     the function the retry calls. It was a third derivation that left the
     placements out, so a seller holding a slot was shown a smaller figure than
     the card would be asked for the next morning.
  */
  it("is what the retry will ask for where nothing has been tried: the year, the slot and the VAT", async () => {
    const now = new Date();
    const { businessId, subscriptionId } = await account({
      term: "annual",
      pastDueSince: new Date(now.getTime() - DAY),
    });
    await prisma.placementSlot.create({
      data: {
        businessId,
        categoryId,
        monthlyPriceAed: 450,
        startsOn: new Date(now.getTime() - 10 * DAY),
        endsOn: new Date(now.getTime() + 20 * DAY),
      },
    });

    const row = await rowOf(subscriptionId, now);
    // AED 3,490 for the year and AED 4,500 for the slot's year, plus 5%.
    expect(row?.amountFils).toBe(YEAR + 450_000 + 22_500);

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      select: RENEWAL_SELECT,
    });
    expect(row?.amountFils).toBe((await priceRenewal(subscription, now)).chargeFils);
  });

  it("is the refused figure on a dropped account, not the Free plan it is on now", async () => {
    const now = new Date();
    const since = new Date(now.getTime() - 20 * DAY);
    const { subscriptionId } = await account({
      status: "active",
      stage: "dropped",
      planId: "free",
      pastDueSince: since,
      attempts: [{ at: since, succeeded: false, amountFils: MONTH }],
    });
    expect((await rowOf(subscriptionId, now))?.amountFils).toBe(MONTH);
  });

  it("is nothing on a dropped account nothing was charged on", async () => {
    // No gateway: the sequence ran and dropped the plan, and no card was asked.
    const now = new Date();
    const { subscriptionId } = await account({
      status: "active",
      stage: "dropped",
      planId: "free",
      pastDueSince: new Date(now.getTime() - 20 * DAY),
    });
    const row = await rowOf(subscriptionId, now);
    expect(row?.amountFils).toBeNull();
    expect(row?.attempts).toBe(0);
  });
});

describe("the header and the plans card", () => {
  it("are one set of figures, read from the same rows", async () => {
    const now = new Date();
    await account({ stage: "retry", pastDueSince: new Date(now.getTime() - 2 * DAY) });
    await account({ status: "active", stage: "dropped", pastDueSince: new Date(now.getTime() - 20 * DAY) });

    const queue = await dunningQueue(now);
    expect(await dunningSummary(now)).toEqual(queue.summary);

    // And the figures are the rows', checked by counting them here.
    const live = queue.rows.filter((row) => row.stage !== "dropped");
    expect(queue.summary.count).toBe(queue.rows.length);
    expect(queue.summary.inSequence).toBe(live.length);
    expect(queue.summary.atRiskFils).toBe(live.reduce((sum, row) => sum + (row.amountFils ?? 0), 0));
  });

  it("says whether a card can be retried at all", async () => {
    expect((await dunningQueue()).gatewayLive).toBe(false);
    setPaymentProvider({
      name: "live-stub",
      live: true,
      async charge() {
        return { ok: false, error: "unused" };
      },
      async cancel() {
        return { ok: true };
      },
    });
    expect((await dunningQueue()).gatewayLive).toBe(true);
  });
});
