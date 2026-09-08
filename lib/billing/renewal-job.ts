import "server-only";
import { prisma } from "@/lib/db/client";
import { paymentProvider } from "./provider";
import { advance, periodPriceAed, type BillingTerm } from "./period";
import { aedToFils } from "./mrr";
import { filsToAed } from "./proration";
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

const RENEWAL_SELECT = {
  id: true,
  businessId: true,
  planId: true,
  term: true,
  renewsAt: true,
  anchorDay: true,
  plan: { select: { name: true, monthlyPriceAed: true, annualMonthsCharged: true } },
} as const;

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

    // A free subscription has nothing to renew, and a zero-fils attempt row
    // would fail `payment_attempt_amount_is_positive` anyway.
    if (periodFils <= 0) continue;

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
    const description =
      term === "annual"
        ? `${subscription.plan.name} plan, one year`
        : `${subscription.plan.name} plan, one month`;

    const charge = await provider.charge({
      businessId: subscription.businessId,
      fils: periodFils,
      description,
      reference,
    });

    if (!charge.ok) {
      await prisma.$transaction(async (tx) => {
        await tx.paymentAttempt.create({
          data: {
            subscriptionId: subscription.id,
            amountFils: periodFils,
            succeeded: false,
            providerMessage: charge.error ?? null,
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

    const nextRenewsAt = advance(subscription.renewsAt, term, subscription.anchorDay);

    const moved = await prisma.$transaction(async (tx) => {
      /*
         The restated guard, copied from `verification/expiry-job.ts`.

         Every condition the selection used is repeated on the write, so a row
         another pass already advanced matches nothing and the whole transaction
         — invoice included — rolls back with it. `runSteps` returns 500 when a
         step throws and Vercel retries the whole batch, so a second pass in the
         same minute is not hypothetical.
      */
      const { count } = await tx.subscription.updateMany({
        where: {
          id: subscription.id,
          status: "active",
          cancelledAt: null,
          renewsAt: subscription.renewsAt,
        },
        data: {
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
          amountFils: periodFils,
          succeeded: true,
          providerMessage: charge.providerRef ?? null,
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

         The reference is still the deterministic one this file mints, because
         that is what a provider's record is matched back to — `issueInvoice`
         takes it rather than pulling a sequence number.
      */
      const issued = await issueInvoice(
        {
          businessId: subscription.businessId,
          ref: reference,
          issuedAt: now,
          // The charge already succeeded; this is a receipt, not a demand.
          paidAt: now,
          pspRef: charge.providerRef ?? null,
          subscriptionRef: subscription.id,
          lines: [
            {
              kind: "subscription",
              description,
              fils: periodFils,
              // The period this line covers. `renewsAt` was the old end and is
              // the new start, which is exactly the period being charged for.
              periodStart: subscription.renewsAt,
              periodEnd: nextRenewsAt,
            },
          ],
        },
        tx,
      );

      return issued.id;
    });

    if (!moved) continue;

    renewed += 1;

    /*
       The PDF, after the transaction and never inside it.

       Object storage is a network call to a different system and holding a
       write transaction open across one is how a slow bucket becomes a database
       incident. The failure modes point opposite ways too: an invoice without
       its PDF is recoverable and the screen says so, while money moved with no
       invoice row is not.
    */
    const pdf = await writeInvoicePdf(moved);
    if (pdf.ok) pdfsWritten += 1;
    else pdfsFailed += 1;

    /*
       The receipt, after the transaction rather than inside it.

       A carrier being slow must not hold a database transaction open, and a
       carrier being down must not roll back a payment that succeeded.
       `onSubscriptionRenewed` swallows its own failures for the same reason
       every other emitter does.
    */
    await onSubscriptionRenewed({
      businessId: subscription.businessId,
      planName: subscription.plan.name,
      amountAed: filsToAed(periodFils),
      renewsAt: nextRenewsAt,
    });
  }

  return { considered: due.length, renewed, failed, skippedNoProvider, pdfsWritten, pdfsFailed, ranAt: now };
}
