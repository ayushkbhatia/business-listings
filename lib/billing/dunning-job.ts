import "server-only";
import {
  creditUnusedPlacement,
  endPlacementsFor,
  type EndedPlacement,
} from "@/lib/placement/term";
import { prisma } from "@/lib/db/client";
import { paymentProvider } from "./provider";
import { nextAction, SCHEDULE, type DunningStage } from "./dunning";
import { aedToFils, recordMovement } from "./mrr";
import { monthlyValueFils, periodPriceAed } from "./period";

/**
 * The dunning runner.
 *
 * Reads the pure sequence in `dunning.ts` and applies it. Idempotent: a run is
 * a function of the stage and the days past due, so running it twice in an hour
 * does the same nothing the second time.
 *
 * **The only account change it ever makes is a plan drop.** No listing is
 * deleted or unpublished, no badge is removed, no tier moves, and no product or
 * review is touched. That is criterion 10's negative, and it is true here
 * because the switch below has one branch that writes to `Business` and that
 * branch writes `planId`.
 *
 * Not audited. Dunning is the platform following its own published sequence
 * rather than a staff decision, and there is no actor to attribute it to —
 * `AuditEvent.actorId` is NOT NULL for exactly the reason that a log of
 * decisions should only contain decisions. The `PaymentAttempt` rows and the
 * stage column are the record.
 */

export interface DunningResult {
  considered: number;
  retried: number;
  notified: number;
  dropped: number;
  /** Sponsored slots ended with the accounts that lapsed. D2. */
  placementsEnded: number;
  ranAt: Date;
}

export async function runDunning(now: Date = new Date()): Promise<DunningResult> {
  const overdue = await prisma.subscription.findMany({
    where: {
      OR: [{ status: "past_due" }, { dunningStage: { not: "none" } }],
      NOT: { dunningStage: "dropped" },
    },
    select: {
      id: true,
      businessId: true,
      planId: true,
      dunningStage: true,
      pastDueSince: true,
      term: true,
      plan: { select: { monthlyPriceAed: true, annualMonthsCharged: true } },
    },
  });

  let retried = 0;
  let notified = 0;
  let dropped = 0;
  let placementsEnded = 0;
  // Credited after the loop. Same reasoning as `applyEndedCancellations`: a
  // credit note that fails to write must not roll back the drop.
  const endedPlacements: { businessId: string; ended: EndedPlacement[] }[] = [];

  for (const subscription of overdue) {
    /*
     * A subscription marked past due by something that did not record when
     * starts from now. Held in memory rather than written back on its own,
     * because every branch below that does anything persists it, and the only
     * branch that does not — `wait` — is unreachable from a null date: the
     * date is `now`, so day zero is due and the retry fires on this same pass.
     */
    const pastDueSince = subscription.pastDueSince ?? now;
    /*
       The **period** price, not the month's.

       A retry is a second attempt at the payment that failed, and on an annual
       subscription that payment was a year. Charging a month instead would take
       a twelfth of what is owed, mark the account active, and leave eleven
       months unpaid with nothing to notice it. Whole fils, as everywhere else
       in billing; never a float.
    */
    const periodFils = aedToFils(
      periodPriceAed(
        {
          monthlyPriceAed: Number(subscription.plan.monthlyPriceAed),
          annualMonthsCharged: subscription.plan.annualMonthsCharged,
        },
        subscription.term,
      ),
    );

    const action = nextAction(subscription.dunningStage as DunningStage, pastDueSince, now);
    if (action.kind === "wait") continue;

    if (action.kind === "retry_silently") {
      const provider = paymentProvider();

      /*
       * A provider that cannot take money cannot report that it took money.
       *
       * `consoleProvider` returns `ok: true` for every charge, which is right
       * for a screen that wants to show the shape of a receipt and catastrophic
       * here: it would mark every past-due subscription active again, silently,
       * without a card being touched, and the sequence would never reach the
       * seller at all. So with no gateway the retry is skipped — the stage
       * advances, the notifications go out, the plan drops on schedule, and the
       * absence of a `PaymentAttempt` row is the honest record that nothing was
       * charged.
       *
       * Nothing to charge is the same case. A free subscription should never be
       * past due, but if one is, there is no card to retry and a zero-fils
       * attempt row would fail `payment_attempt_amount_is_positive` anyway.
       */
      if (!provider.live || periodFils <= 0) {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { dunningStage: "retry", pastDueSince, dunningAdvancedAt: now },
        });
        retried += 1;
        continue;
      }

      const charge = await provider.charge({
        businessId: subscription.businessId,
        fils: periodFils,
        description: "Subscription retry",
        reference: `DUNNING-${subscription.id}-${pastDueSince.getTime()}`,
      });

      await prisma.paymentAttempt.create({
        data: {
          subscriptionId: subscription.id,
          amountFils: periodFils,
          succeeded: charge.ok,
          providerMessage: charge.ok ? null : (charge.error ?? null),
          attemptedAt: now,
        },
      });

      if (charge.ok) {
        // Paid. Out of dunning entirely, and the columns move together or the
        // check constraint refuses the row.
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: "active",
            dunningStage: "none",
            pastDueSince: null,
            dunningAdvancedAt: now,
          },
        });
        continue;
      }

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { dunningStage: "retry", pastDueSince, dunningAdvancedAt: now },
      });
      retried += 1;
      continue;
    }

    if (action.kind === "send") {
      /*
       * The notification itself goes through `lib/notify`, which is a port with
       * a console sender until a real one exists. Advancing the stage is what
       * matters here: a stage that moves only when a message actually sent
       * would stall the whole sequence behind an unconfigured provider.
       */
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { dunningStage: action.stage, pastDueSince, dunningAdvancedAt: now },
      });
      notified += 1;
      continue;
    }

    if (action.kind === "drop_to_free") {
      await prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            planId: "free",
            status: "active",
            dunningStage: "dropped",
            pastDueSince,
            dunningAdvancedAt: now,
          },
        });

        /*
         * The one write to `Business`, and it is one column.
         *
         * Not `publishedAt`, not `verificationTier`, not `verifiedAt`. The
         * listing stays live, the products stay visible, the reviews stay, and
         * the badge stays — it records what we checked, and a card expiring
         * does not unverify a trade licence.
         */
        await tx.business.update({
          where: { id: subscription.businessId },
          data: { planId: "free" },
        });

        /*
           Churn, in the ledger board 4g reads. Same transaction, so a waterfall
           can never be missing a drop that happened.

           The monthly **value**, not the period price — an annual account that
           drops loses ten twelfths of a list price a month, not a whole year's
           worth. `mrrNow` values live accounts with the same function and
           `reconcile()` compares the two, so the period price here would put a
           twelve-times error into the waterfall on the day it mattered most.
        */
        await recordMovement(tx, {
          businessId: subscription.businessId,
          fromPlanId: subscription.planId,
          toPlanId: "free",
          beforeFils: monthlyValueFils(
            {
              monthlyPriceAed: Number(subscription.plan.monthlyPriceAed),
              annualMonthsCharged: subscription.plan.annualMonthsCharged,
            },
            subscription.term,
          ),
          afterFils: 0,
          occurredAt: now,
          note: `Dunning drop after ${SCHEDULE.final} days past due`,
        });

        /*
           And the sponsored slot, which the drop to Free cannot leave standing.
           D2: the slot belongs to the subscription, and this subscription has
           just stopped paying for one.

           The third of the three enders, and the reason there is only one
           function: this file's whole discipline is that a lapse takes the plan
           and nothing else — not the listing, not the products, not the badge.
           A slot is the exception, because it is the plan, sold by the month.
        */
        const ended = await endPlacementsFor(tx, subscription.businessId, now, "lapsed");
        if (ended.length > 0) {
          placementsEnded += ended.length;
          endedPlacements.push({ businessId: subscription.businessId, ended });
        }
      });
      dropped += 1;
    }
  }

  for (const row of endedPlacements) {
    await creditUnusedPlacement(row.ended, row.businessId, now);
  }

  return { considered: overdue.length, retried, notified, dropped, placementsEnded, ranAt: now };
}
