import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { runRenewals } from "@/lib/billing/renewal-job";
import { runDunning } from "@/lib/billing/dunning-job";
import { mrrNow } from "@/lib/billing/revenue";
import { advance, monthlyValueFils } from "@/lib/billing/period";
import {
  consoleProvider,
  setPaymentProvider,
  type ChargeRequest,
  type PaymentProvider,
} from "@/lib/billing/provider";

/**
 * criterion 10 — the renewal cycle, against a real database.
 *
 * Titled for that criterion because `scripts/acceptance-handoff-3.sh` filters
 * the integration run with `-t "criterion 10"` and only asserts that *some*
 * tests passed. A describe named anything else is silently skipped, which is
 * the failure the script's own header records from a previous handoff.
 *
 * `Subscription.renewsAt` had never been advanced by anything before this: it
 * was written once by `changePlan` and once by the seed, no job moved it, and
 * nothing ever set `past_due` — so the whole D0/D3/D7/D14 sequence had no
 * trigger. These tests are what make the cycle real.
 *
 * Create-and-destroy fixtures, borrowed from `revenue.test.ts`, rather than the
 * shared seeded row. This file writes invoices and payment attempts and moves
 * dates; leaking any of that into `billing.test.ts` or `revenue.test.ts` is a
 * failure that surfaces only when the runner orders the files a particular way.
 */

const made: string[] = [];

afterAll(async () => {
  await prisma.business.deleteMany({ where: { id: { in: made } } });
  await prisma.business.deleteMany({ where: { slug: { startsWith: "renewal-walk-" } } });
  await prisma.$disconnect();
});

afterEach(() => {
  // Whatever a test swapped in, the next one starts from the real thing.
  setPaymentProvider(consoleProvider);
});

/** A provider that can actually take money, and remembers what it was asked. */
function stubProvider(outcome: "ok" | "declined"): PaymentProvider & { charges: ChargeRequest[] } {
  const charges: ChargeRequest[] = [];
  return {
    name: "stub",
    live: true,
    charges,
    async charge(request) {
      charges.push(request);
      return outcome === "ok"
        ? { ok: true, providerRef: `stub_${request.reference}` }
        : { ok: false, error: "The card was declined." };
    },
    async cancel() {
      return { ok: true };
    },
  };
}

interface Fixture {
  businessId: string;
  subscriptionId: string;
  renewsAt: Date;
}

/** A claimed listing on a paid plan, with a period that ends when we say. */
async function paidListing(options: {
  planId: "basic" | "pro";
  term: "monthly" | "annual";
  /** Days from now. Negative is overdue. */
  renewsInDays: number;
}): Promise<Fixture> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const categoryId = (
    await prisma.category.findFirstOrThrow({ where: { parentId: null }, select: { id: true } })
  ).id;

  const business = await prisma.business.create({
    data: {
      tradeName: `Renewal Walk ${stamp}`,
      displayName: `Renewal Walk ${stamp}`,
      slug: `renewal-walk-${stamp}`,
      licenceNumber: `DED-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      planId: options.planId,
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  made.push(business.id);

  const renewsAt = new Date(Date.now() + options.renewsInDays * 86_400_000);
  const periodLength = options.term === "annual" ? 365 : 30;

  const subscription = await prisma.subscription.create({
    data: {
      businessId: business.id,
      planId: options.planId,
      status: "active",
      term: options.term,
      startedAt: new Date(renewsAt.getTime() - periodLength * 86_400_000),
      periodStartedAt: new Date(renewsAt.getTime() - periodLength * 86_400_000),
      renewsAt,
      anchorDay: renewsAt.getUTCDate(),
    },
    select: { id: true },
  });

  return { businessId: business.id, subscriptionId: subscription.id, renewsAt };
}

const read = (id: string) =>
  prisma.subscription.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      renewsAt: true,
      periodStartedAt: true,
      pastDueSince: true,
      dunningStage: true,
    },
  });

describe("criterion 10 — a renewal without a gateway changes nothing", () => {
  /*
     The test that protects every environment without a payment provider, which
     today is all of them.

     `consoleProvider` answers `ok: true` to every charge. Trusting it would
     advance every renewal date in staging without a card being touched, and the
     failure branch — the one that feeds dunning — would never run at all.
     Marking them past due instead would be the opposite mistake: every
     subscription would march D0 to D14 and drop to Free inside a fortnight.
  */
  it("reports the skip rather than pretending either way", async () => {
    const fixture = await paidListing({ planId: "basic", term: "monthly", renewsInDays: -1 });

    const result = await runRenewals();

    expect(result.skippedNoProvider).toBeGreaterThanOrEqual(1);
    expect(result.renewed).toBe(0);
    expect(result.failed).toBe(0);

    const after = await read(fixture.subscriptionId);
    expect(after.renewsAt.getTime()).toBe(fixture.renewsAt.getTime());
    expect(after.status).toBe("active");
    expect(after.pastDueSince).toBeNull();
  });

  it("writes no invoice and no payment attempt", async () => {
    const fixture = await paidListing({ planId: "pro", term: "monthly", renewsInDays: -2 });
    await runRenewals();

    expect(await prisma.invoice.count({ where: { businessId: fixture.businessId } })).toBe(0);
    expect(
      await prisma.paymentAttempt.count({ where: { subscriptionId: fixture.subscriptionId } }),
    ).toBe(0);
  });
});

describe("criterion 10 — a renewal that goes through", () => {
  it("advances exactly one period and issues an invoice for it", async () => {
    const fixture = await paidListing({ planId: "basic", term: "monthly", renewsInDays: -1 });
    const provider = stubProvider("ok");
    setPaymentProvider(provider);

    const result = await runRenewals();
    expect(result.renewed).toBeGreaterThanOrEqual(1);

    const after = await read(fixture.subscriptionId);
    // A calendar month from the old renewal date, anchored on its own day.
    expect(after.renewsAt.getTime()).toBe(
      advance(fixture.renewsAt, "monthly", fixture.renewsAt.getUTCDate()).getTime(),
    );
    // The period that just ended becomes the one that just began.
    expect(after.periodStartedAt.getTime()).toBe(fixture.renewsAt.getTime());

    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { businessId: fixture.businessId },
      select: { status: true, lines: { select: { kind: true, amountAed: true, description: true } } },
    });
    expect(invoice.status).toBe("issued");
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0]!.kind).toBe("subscription");
    expect(Number(invoice.lines[0]!.amountAed)).toBe(349);
    expect(invoice.lines[0]!.description).toMatch(/one month/);

    const attempt = await prisma.paymentAttempt.findFirstOrThrow({
      where: { subscriptionId: fixture.subscriptionId },
      select: { succeeded: true, amountFils: true },
    });
    expect(attempt.succeeded).toBe(true);
    expect(attempt.amountFils).toBe(34_900);
  });

  /*
     `runSteps` returns 500 when a step throws and Vercel retries the whole
     batch, so a second pass in the same minute is not hypothetical. The
     restated guard — every selection condition repeated on the write — is what
     makes it a no-op rather than a second charge.
  */
  it("does nothing at all the second time", async () => {
    const fixture = await paidListing({ planId: "basic", term: "monthly", renewsInDays: -1 });
    const provider = stubProvider("ok");
    setPaymentProvider(provider);

    await runRenewals();
    const afterFirst = await read(fixture.subscriptionId);
    const chargesAfterFirst = provider.charges.length;

    await runRenewals();
    const afterSecond = await read(fixture.subscriptionId);

    expect(afterSecond.renewsAt.getTime()).toBe(afterFirst.renewsAt.getTime());
    expect(provider.charges.length).toBe(chargesAfterFirst);
    expect(await prisma.invoice.count({ where: { businessId: fixture.businessId } })).toBe(1);
  });

  it("charges a year on an annual term, and moves the date by a year", async () => {
    const fixture = await paidListing({ planId: "pro", term: "annual", renewsInDays: -1 });
    const provider = stubProvider("ok");
    setPaymentProvider(provider);

    await runRenewals();

    const charge = provider.charges.find((c) => c.businessId === fixture.businessId);
    // Ten months of AED 899, not one.
    expect(charge?.fils).toBe(899_000);
    expect(charge?.description).toMatch(/one year/);

    const after = await read(fixture.subscriptionId);
    expect(after.renewsAt.getUTCFullYear()).toBe(fixture.renewsAt.getUTCFullYear() + 1);
  });
});

describe("criterion 10 — a renewal that is declined hands over to dunning", () => {
  it("marks the account past due, with the date the sequence measures from", async () => {
    const fixture = await paidListing({ planId: "pro", term: "monthly", renewsInDays: -1 });
    setPaymentProvider(stubProvider("declined"));

    const result = await runRenewals();
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const after = await read(fixture.subscriptionId);
    expect(after.status).toBe("past_due");
    expect(after.pastDueSince).not.toBeNull();
    // Not advanced. Nobody paid for another month.
    expect(after.renewsAt.getTime()).toBe(fixture.renewsAt.getTime());
    /*
       The stage stays `none` so dunning's own first step — a silent retry — is
       not skipped. `subscription_dunning_has_a_start` allows exactly this pair
       and refuses a stage without a date.
    */
    expect(after.dunningStage).toBe("none");

    const attempt = await prisma.paymentAttempt.findFirstOrThrow({
      where: { subscriptionId: fixture.subscriptionId },
      select: { succeeded: true, providerMessage: true },
    });
    expect(attempt.succeeded).toBe(false);
    expect(attempt.providerMessage).toMatch(/declined/i);
  });

  it("is picked up by dunning on the same daily pass", async () => {
    const fixture = await paidListing({ planId: "basic", term: "monthly", renewsInDays: -1 });
    setPaymentProvider(stubProvider("declined"));

    await runRenewals();
    // The order the daily job runs them in, and the reason for it: a failure
    // today has to reach dunning today or the whole sequence starts late.
    await runDunning();

    const after = await read(fixture.subscriptionId);
    expect(after.dunningStage).not.toBe("none");
  });

  it("leaves a past-due subscription to dunning rather than renewing it again", async () => {
    const fixture = await paidListing({ planId: "basic", term: "monthly", renewsInDays: -1 });
    setPaymentProvider(stubProvider("declined"));
    await runRenewals();

    setPaymentProvider(stubProvider("ok"));
    const second = await runRenewals();

    // Retrying a card is dunning's job, on its own schedule. Renewing here
    // would race it and could charge twice for one period.
    const after = await read(fixture.subscriptionId);
    expect(after.status).toBe("past_due");
    expect(after.renewsAt.getTime()).toBe(fixture.renewsAt.getTime());
    expect(second.renewed).toBe(0);
  });
});

describe("criterion 10 — what a renewal must not touch", () => {
  it("never renews a cancelled subscription", async () => {
    const fixture = await paidListing({ planId: "pro", term: "monthly", renewsInDays: -1 });
    await prisma.subscription.update({
      where: { id: fixture.subscriptionId },
      data: { cancelledAt: new Date(), endsAt: fixture.renewsAt },
    });
    setPaymentProvider(stubProvider("ok"));

    await runRenewals();

    const after = await read(fixture.subscriptionId);
    // It is serving out a period already paid for. `applyEndedCancellations`
    // drops it at the end; charging it again would be the worst bug this file
    // could have.
    expect(after.renewsAt.getTime()).toBe(fixture.renewsAt.getTime());
    expect(await prisma.invoice.count({ where: { businessId: fixture.businessId } })).toBe(0);
  });

  it("writes no revenue movement, because nothing about the money changed", async () => {
    const fixture = await paidListing({ planId: "basic", term: "monthly", renewsInDays: -1 });
    setPaymentProvider(stubProvider("ok"));

    await runRenewals();

    // `classify` returns null on a zero delta and
    // `mrr_movement_sign_matches_kind` forbids the row. A renewal is invisible
    // to board 4g's waterfall by construction, which is right: there is no bar
    // for "the same thing happened again".
    expect(
      await prisma.mrrMovement.count({ where: { businessId: fixture.businessId } }),
    ).toBe(0);
  });
});

describe("criterion 10 — an annual account is worth less a month, and the books say so", () => {
  it("values it at ten twelfths of the list price", async () => {
    const pro = await prisma.plan.findUniqueOrThrow({
      where: { id: "pro" },
      select: { monthlyPriceAed: true, annualMonthsCharged: true },
    });
    const caps = {
      monthlyPriceAed: Number(pro.monthlyPriceAed),
      annualMonthsCharged: pro.annualMonthsCharged,
    };

    const before = await mrrNow();
    await paidListing({ planId: "pro", term: "annual", renewsInDays: 40 });
    const after = await mrrNow();

    const expected = monthlyValueFils(caps, "annual");
    expect(after.mrrFils - before.mrrFils).toBe(expected);
    // And it is genuinely less than a monthly account on the same plan.
    expect(expected).toBeLessThan(monthlyValueFils(caps, "monthly"));
  });

  it("keeps the plan mix to one row per plan", async () => {
    await paidListing({ planId: "pro", term: "annual", renewsInDays: 40 });
    await paidListing({ planId: "pro", term: "monthly", renewsInDays: 40 });

    const now = await mrrNow();
    const proRows = now.byPlan.filter((row) => row.planId === "pro");
    // Grouped by plan and term underneath, summed back to one row: board 4g's
    // table is a plan mix, and splitting it by payment schedule would double
    // every line to answer a question nobody asked.
    expect(proRows).toHaveLength(1);
  });
});
