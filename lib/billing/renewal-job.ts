import "server-only";
import { t } from "@/lib/i18n";
import type { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { paymentProvider } from "./provider";
import { advance, periodPriceAed, type BillingTerm } from "./period";
import { aedToFils } from "./mrr";
import { filsToAed, vatOn } from "./proration";
import { issueInvoice } from "./invoice";
import { writeInvoicePdf } from "./issue-pdf";
import { onSubscriptionRenewed } from "@/lib/notify/events";

/**
 * The renewal runner — the thing that was missing.
 *
 * `Subscription.renewsAt` has existed since the init migration and until now
 * nothing advanced it. `changePlan` set it once and the seed set it; no job
 * moved it, nothing charged at period end, and nothing anywhere ever wrote
 * `status: "past_due"`. So `runDunning` — a complete, tested D0/D3/D7/D14
 * sequence — had no trigger, and a subscription simply ran past its renewal
 * date for ever.
 *
 * This runs first in the daily job, before dunning, so a renewal that fails
 * today is marked past due before dunning reads the row. Running it after would
 * start the sequence a day late for everybody.
 *
 * ## What it will not do
 *
 * **It writes no MRR movement.** A renewal does not change what an account pays
 * a month. `recordMovement` returns null on a zero delta and
 * `mrr_movement_sign_matches_kind` forbids the row, so renewals are invisible to
 * board 4g's waterfall by construction — which is right: a waterfall of new,
 * expansion, contraction and churn has no bar for "the same thing happened
 * again".
 *
 * **It writes no audit row.** The argument `dunning-job.ts` and
 * `verification/expiry-job.ts` both make, and that CLAUDE.md accepts for the
 * licence sweep: `AuditEvent.actorId` is NOT NULL because the log records
 * decisions, and a cron following a published schedule has no actor to
 * attribute. The `PaymentAttempt` and `Invoice` rows are the record.
 *
 * **It touches nothing but the subscription.** No listing, no product, no
 * badge, no tier. A renewal is a charge and a date.
 */

export interface RenewalResult {
  considered: number;
  renewed: number;
  failed: number;
  /**
   * Due, and left alone because there is no gateway.
   *
   * Reported rather than hidden, because zero renewals with a hundred
   * considered is otherwise indistinguishable from a job that is broken.
   */
  skippedNoProvider: number;
  /**
   * Renewal invoices whose PDF was written, and whose write failed.
   *
   * Reported rather than logged. `putInvoicePdf` returns null on a storage
   * failure and warns to a console nobody reads — which is honest on the screen,
   * where a null `pdfPath` renders as "the document is not available", and
   * invisible in production, where the console is a serverless function's
   * stderr. A step report is the thing an operator actually looks at, and
   * `writeMissingInvoicePdfs` is what picks the failures up on the next run.
   */
  pdfsWritten: number;
  pdfsFailed: number;
  ranAt: Date;
}

export const RENEWAL_SELECT = {
  id: true,
  businessId: true,
  planId: true,
  term: true,
  renewsAt: true,
  anchorDay: true,
  plan: { select: { name: true, monthlyPriceAed: true, annualMonthsCharged: true } },
} as const;

/** A subscription as this file reads it, and as `dunning-job.ts` reads it to retry. */
export type RenewableSubscription = Prisma.SubscriptionGetPayload<{
  select: typeof RENEWAL_SELECT;
}>;

export interface RenewalPrice {
  /** The plan's period, ex-VAT. */
  periodFils: number;
  /** One line per sponsored slot held, ex-VAT. */
  placements: { id: string; categoryName: string; fils: number }[];
  /** The two together, ex-VAT. The invoice's subtotal. */
  netFils: number;
  /**
   * What the card is asked for: the net and its VAT, which is the invoice's
   * total to the fil.
   *
   * This charged the net. `changePlan` has always charged VAT included — *"what
   * the seller agreed to pay"* — and `issueInvoice` puts VAT on every line, so a
   * renewal took 5% less than the paid invoice it wrote said it took. The invoice
   * is computed from the same lines with the same `vatOn`, so the two cannot
   * disagree by more than nothing.
   */
  chargeFils: number;
}

/**
 * What renewing this subscription costs today.
 *
 * Shared with `dunning-job.ts`, because a retry is a second attempt at the
 * payment that failed, and a figure derived twice is a figure that drifts. The
 * retry used to charge the plan's period alone, ex-VAT, while the renewal it
 * was retrying had asked for the period, the placements and the VAT.
 */
export async function priceRenewal(
  subscription: RenewableSubscription,
  now: Date,
): Promise<RenewalPrice> {
  const term = subscription.term as BillingTerm;
  const periodFils = aedToFils(
    periodPriceAed(
      {
        monthlyPriceAed: Number(subscription.plan.monthlyPriceAed),
        annualMonthsCharged: subscription.plan.annualMonthsCharged,
      },
      term,
    ),
  );

  /*
     The sponsored slots this account holds, billed on the same invoice. D2.

     "The slot belongs to the subscription" is not only about when it ends. A
     placement that is never billed is a thing we sell and never charge for —
     `lib/billing/invoice.ts` carried the admission in a comment for months —
     and the term question cannot be answered honestly while the money
     question is unanswered.

     Priced through `periodPriceAed`, the same helper the plan uses, so an
     annual account gets the annual treatment on the placement too. Choosing
     differently would mean a seller on a ten-month year paying twelve months
     of placement, which is a discount that stops at an arbitrary line.

     Read before the charge, because the invoice has to equal what was taken.
     An invoice that lists more than the card was charged is the reconciliation
     failure board 4g exists to catch.
  */
  const slots = await prisma.placementSlot.findMany({
    where: {
      businessId: subscription.businessId,
      startsOn: { lte: now },
      OR: [{ endsOn: null }, { endsOn: { gt: now } }],
    },
    orderBy: [{ startsOn: "asc" }, { id: "asc" }],
    select: { id: true, monthlyPriceAed: true, category: { select: { name: true } } },
  });

  const placements = slots.map((slot) => ({
    id: slot.id,
    categoryName: slot.category.name,
    fils: aedToFils(
      periodPriceAed(
        {
          monthlyPriceAed: Number(slot.monthlyPriceAed),
          annualMonthsCharged: subscription.plan.annualMonthsCharged,
        },
        term,
      ),
    ),
  }));
  const netFils = periodFils + placements.reduce((total, slot) => total + slot.fils, 0);

  return { periodFils, placements, netFils, chargeFils: netFils + vatOn(netFils) };
}

/**
 * A charge that went through: the period moves on, and a paid invoice says so.
 *
 * Shared with `dunning-job.ts` for the reason `priceRenewal` is. A retry that
 * succeeded used to mark the subscription active and stop there — no new
 * period, no invoice — so the next morning's `runRenewals` found it active with
 * `renewsAt` still behind it and charged the same period a second time. The
 * first payment never got a document at all.
 *
 * `guard` is what the caller's selection read, restated on the write: a row
 * another pass already moved matches nothing, and the transaction — invoice
 * included — rolls back with it. Returns null in that case.
 */
export async function settleRenewal(
  subscription: RenewableSubscription,
  price: RenewalPrice,
  input: {
    reference: string;
    providerRef: string | null;
    guard: Prisma.SubscriptionWhereInput;
    now: Date;
  },
): Promise<{ invoiceId: string; pdfWritten: boolean; renewsAt: Date } | null> {
  const { now } = input;
  const term = subscription.term as BillingTerm;
  const description =
    term === "annual"
      ? `${subscription.plan.name} plan, one year`
      : `${subscription.plan.name} plan, one month`;
  const nextRenewsAt = advance(subscription.renewsAt, term, subscription.anchorDay);

  const invoiceId = await prisma.$transaction(async (tx) => {
    /*
       The restated guard, copied from `verification/expiry-job.ts`.

       Every condition the selection used is repeated on the write, so a row
       another pass already advanced matches nothing and the whole transaction
       — invoice included — rolls back with it. `runSteps` returns 500 when a
       step throws and Vercel retries the whole batch, so a second pass in the
       same minute is not hypothetical.
    */
    const { count } = await tx.subscription.updateMany({
      where: { ...input.guard, id: subscription.id, renewsAt: subscription.renewsAt },
      data: {
        // Already true of a renewal. A dunning retry is how a past-due account
        // gets back to it.
        status: "active",
        periodStartedAt: subscription.renewsAt,
        renewsAt: nextRenewsAt,
        // A payment that goes through ends whatever dunning had started. Both
        // move together or `subscription_dunning_has_a_start` refuses the row.
        dunningStage: "none",
        pastDueSince: null,
        dunningAdvancedAt: null,
      },
    });

    if (count === 0) return null;

    await tx.paymentAttempt.create({
      data: {
        subscriptionId: subscription.id,
        amountFils: price.chargeFils,
        succeeded: true,
        providerMessage: input.providerRef,
        attemptedAt: now,
      },
    });

    /*
       Through `issueInvoice`, not a bare `create`. Board 11g, arriving late.

       This wrote the invoice by hand: four columns, one line, and none of
       what 11g made an invoice mean — no stored totals, so every reader
       re-derived them and criterion 2 stopped holding on exactly the invoices
       the platform raises most; no supplier or recipient snapshot, so a
       rename rewrote history; no VAT per line, no supply dates, no
       `subscriptionRef`. Nothing was wrong with it before 11g and nothing
       updated it after.

       The reference is still the deterministic one the caller mints, because
       that is what a provider's record is matched back to — `issueInvoice`
       takes it rather than pulling a sequence number.
    */
    const issued = await issueInvoice(
      {
        businessId: subscription.businessId,
        ref: input.reference,
        issuedAt: now,
        // The charge already succeeded; this is a receipt, not a demand.
        paidAt: now,
        pspRef: input.providerRef,
        subscriptionRef: subscription.id,
        lines: [
          {
            kind: "subscription",
            description,
            fils: price.periodFils,
            // The period this line covers. `renewsAt` was the old end and is
            // the new start, which is exactly the period being charged for.
            periodStart: subscription.renewsAt,
            periodEnd: nextRenewsAt,
          },
          /*
             One line per slot, named by its category.

             Separate lines rather than one summed "Sponsored placement",
             because a seller holding two reads the invoice to check they are
             paying for the two they think they hold — and `4g` can only
             report placement revenue per category if the line says which.
          */
          ...price.placements.map((slot) => ({
            kind: "placement" as const,
            description: t("placement.invoice_line", { category: slot.categoryName }),
            fils: slot.fils,
            periodStart: subscription.renewsAt,
            periodEnd: nextRenewsAt,
          })),
        ],
      },
      tx,
    );

    /*
       And the slots run to the same date the subscription now does.

       This is what "the slot belongs to the subscription" means at the level
       of a row: one end date, moved by one event, so the two can never
       disagree. It also removes the thirty-day clock as a second source of
       truth — `takeSlot` still writes a thirty-day `endsOn` for a slot bought
       mid-period, and the first renewal after that aligns it.
    */
    if (price.placements.length > 0) {
      await tx.placementSlot.updateMany({
        where: { id: { in: price.placements.map((slot) => slot.id) } },
        data: { endsOn: nextRenewsAt },
      });
    }

    return issued.id;
  });

  if (!invoiceId) return null;

  /*
     The PDF, after the transaction and never inside it.

     Object storage is a network call to a different system and holding a
     write transaction open across one is how a slow bucket becomes a database
     incident. The failure modes point opposite ways too: an invoice without
     its PDF is recoverable and the screen says so, while money moved with no
     invoice row is not.
  */
  const pdf = await writeInvoicePdf(invoiceId);

  /*
     The receipt, after the transaction rather than inside it.

     A carrier being slow must not hold a database transaction open, and a
     carrier being down must not roll back a payment that succeeded.
     `onSubscriptionRenewed` swallows its own failures for the same reason
     every other emitter does.

     The charge, not the plan's price. The message reads *"has been charged
     {amount}"*, and it was sent the period ex-VAT without the placements — a
     smaller figure than the card statement beside it.
  */
  await onSubscriptionRenewed({
    businessId: subscription.businessId,
    planName: subscription.plan.name,
    amountAed: filsToAed(price.chargeFils),
    renewsAt: nextRenewsAt,
  });

  return { invoiceId, pdfWritten: pdf.ok, renewsAt: nextRenewsAt };
}

export async function runRenewals(now: Date = new Date()): Promise<RenewalResult> {
  const due = await prisma.subscription.findMany({
    /*
       Active and unlaid-off only.

       A cancelled subscription is serving out a period it already paid for and
       `applyEndedCancellations` drops it at the end; charging it again would be
       the worst bug this file could have. A `past_due` one belongs to dunning,
       which retries on its own schedule — renewing it here would race that.
    */
    where: { status: "active", cancelledAt: null, renewsAt: { lte: now } },
    select: RENEWAL_SELECT,
  });

  let renewed = 0;
  let failed = 0;
  let skippedNoProvider = 0;
  let pdfsWritten = 0;
  let pdfsFailed = 0;

  for (const subscription of due) {
    const price = await priceRenewal(subscription, now);

    // A free subscription with no placement has nothing to renew, and a
    // zero-fils attempt row would fail `payment_attempt_amount_is_positive`.
    if (price.chargeFils <= 0) continue;

    const provider = paymentProvider();

    /*
       No gateway, no renewal, and nothing written.

       `consoleProvider` returns `ok: true` for every charge. Trusting that here
       would advance `renewsAt` on every subscription in every environment
       without a card being touched — and worse, the failure branch would never
       run, so nothing would ever be marked past due and the whole dunning
       sequence would stay untested until the day it mattered.

       Marking them past due instead would be the opposite mistake: every
       subscription in staging would march through D0 to D14 and drop to Free
       inside a fortnight. So the honest answer is to do nothing and count it.
       `dunning-job.ts` makes the same call for the same reason.
    */
    if (!provider.live) {
      skippedNoProvider += 1;
      continue;
    }

    /*
       Deterministic on the period, not on the clock.

       Two runs on the same day must not mint two references for one period. The
       reference is what a provider's record is matched back to an invoice by,
       and a duplicate is how one month gets charged twice and reconciled never.
    */
    const reference = `RENEW-${subscription.businessId.slice(-6)}-${subscription.planId}-${subscription.renewsAt.getTime()}`;

    const charge = await provider.charge({
      businessId: subscription.businessId,
      fils: price.chargeFils,
      description:
        subscription.term === "annual"
          ? `${subscription.plan.name} plan, one year`
          : `${subscription.plan.name} plan, one month`,
      reference,
    });

    if (!charge.ok) {
      await prisma.$transaction(async (tx) => {
        await tx.paymentAttempt.create({
          data: {
            subscriptionId: subscription.id,
            amountFils: price.chargeFils,
            succeeded: false,
            providerMessage: charge.error ?? null,
            /*
               The run's clock, which is also `pastDueSince` below. The failed-
               payments queue reads the attempts made since the date it went
               past due, and the database's own `now()` is a moment later than
               this one — or, under a test's clock, a different day entirely.
            */
            attemptedAt: now,
          },
        });
        /*
           Past due, with the date the sequence is measured from.

           `dunningStage` stays `none`: dunning's own first step is a silent
           retry, and setting a stage here would skip it. The pair satisfies
           `subscription_dunning_has_a_start`, which allows `none` with a date
           and forbids a stage without one.
        */
        await tx.subscription.updateMany({
          where: { id: subscription.id, renewsAt: subscription.renewsAt },
          data: { status: "past_due", pastDueSince: now },
        });
      });
      failed += 1;
      continue;
    }

    const settled = await settleRenewal(subscription, price, {
      reference,
      providerRef: charge.providerRef ?? null,
      guard: { status: "active", cancelledAt: null },
      now,
    });
    if (!settled) continue;

    renewed += 1;
    if (settled.pdfWritten) pdfsWritten += 1;
    else pdfsFailed += 1;
  }

  return { considered: due.length, renewed, failed, skippedNoProvider, pdfsWritten, pdfsFailed, ranAt: now };
}
