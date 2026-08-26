import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import {
  assertCanChangePlan,
  assertCanIssueSubscriptionCredit,
  assertCanManageBilling,
} from "@/lib/auth/guards";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import { filsToAed, prorate, type Proration } from "./proration";
import { snapshotOf } from "@/lib/plan/entitlements";
import { paymentProvider } from "./provider";
import { aedToFils, recordMovement } from "./mrr";

/**
 * Plan changes, cancellation and invoices.
 *
 * Criterion 10 in three parts:
 *
 *   - Proration is computed by `lib/billing/proration.ts` and shown line by
 *     line before anything is charged.
 *   - Entitlements move with the plan, in the same transaction. "Within a
 *     minute" is generous; this is the same request.
 *   - Cancel drops to Free **at period end**, hides products without deleting
 *     them, and keeps the verified badge.
 *
 * Criterion 9 is the other half of this file, and it is a claim about refusal:
 * `assertCanChangePlan` throws for a `seller_sales` actor before anything is
 * read. The guard is the first line of every mutation here on purpose — a check
 * further down is a check some future early return can skip.
 *
 * No retention offer anywhere. Board 11f says so deliberately: if the product
 * is not worth it we would rather know.
 */

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true,
  locationLimit: true, photoLimit: true, teamSeats: true, rankingMultiplier: true,
  customDomain: true, siteVisitIncluded: true, sortOrder: true,
} as const;

export interface PlanChangeQuote {
  fromPlan: { id: string; name: string; monthlyPriceAed: number };
  toPlan: { id: string; name: string; monthlyPriceAed: number };
  proration: Proration;
  /** "139.56", already signed. */
  netAed: string;
  /** True when the provider cannot actually take money — see provider.ts. */
  providerIsLive: boolean;
}

export type QuoteResult = { ok: true; quote: PlanChangeQuote } | { ok: false; error: string };

/**
 * What the change would cost. Reads only; writes nothing.
 *
 * Board 11f shows this line by line before the seller commits, which is the
 * difference between a plan change and a surprise on a statement.
 */
export async function quotePlanChange(
  actor: Actor,
  businessId: string,
  toPlanId: string,
  now = new Date(),
): Promise<QuoteResult> {
  assertCanChangePlan(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only change your own plan." };
  }

  const [business, toPlan] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { plan: { select: PLAN_SELECT }, subscription: { select: { renewsAt: true } } },
    }),
    prisma.plan.findUnique({ where: { id: toPlanId }, select: PLAN_SELECT }),
  ]);

  if (!toPlan) return { ok: false, error: "That plan is not one we sell." };

  const fromPlan =
    business.plan ?? (await prisma.plan.findUniqueOrThrow({ where: { id: "free" }, select: PLAN_SELECT }));
  if (fromPlan.id === toPlan.id) {
    return { ok: false, error: "That is the plan you are on." };
  }

  // A business with no subscription is on Free and its period starts now.
  const renewsAt =
    business.subscription?.renewsAt ?? new Date(now.getTime() + 30 * 86_400_000);

  const proration = prorate({
    fromMonthlyAed: fromPlan.monthlyPriceAed,
    toMonthlyAed: toPlan.monthlyPriceAed,
    renewsAt,
    now,
  });

  return {
    ok: true,
    quote: {
      fromPlan: { id: fromPlan.id, name: fromPlan.name, monthlyPriceAed: fromPlan.monthlyPriceAed },
      toPlan: { id: toPlan.id, name: toPlan.name, monthlyPriceAed: toPlan.monthlyPriceAed },
      proration,
      netAed: filsToAed(proration.netFils),
      providerIsLive: paymentProvider().live,
    },
  };
}

export type ChangeResult = { ok: true; invoiceId: string | null } | { ok: false; error: string };

/**
 * Move the business onto a different plan.
 *
 * The entitlement change and the invoice are one transaction. Charging outside
 * it, after: a provider that is slow must not hold a transaction open, and a
 * provider that fails must not leave a seller on a plan they were never charged
 * for — so the charge happens first and the switch only follows a success.
 */
export async function changePlan(
  actor: Actor,
  businessId: string,
  toPlanId: string,
  now = new Date(),
): Promise<ChangeResult> {
  assertCanChangePlan(actor);

  const quoted = await quotePlanChange(actor, businessId, toPlanId, now);
  if (!quoted.ok) return quoted;
  const { quote } = quoted;

  const reference = `PLAN-${businessId.slice(-6)}-${toPlanId}-${now.getTime()}`;

  // Only an upgrade reaches a provider. A downgrade produces a credit, and this
  // platform holds no funds and pays none out — it lands on the next invoice.
  if (quote.proration.netFils > 0) {
    const charge = await paymentProvider().charge({
      businessId,
      fils: quote.proration.netFils,
      description: `${quote.toPlan.name} plan, ${quote.proration.daysRemaining} days`,
      reference,
    });
    if (!charge.ok) {
      return { ok: false, error: charge.error ?? "That payment did not go through." };
    }
  }

  /*
   * The full plan row, for the snapshot. The quote's `toPlan` is trimmed to
   * what board 11f shows — a name and a price — and a snapshot needs the caps.
   */
  const toPlanRow = await prisma.plan.findUniqueOrThrow({
    where: { id: toPlanId },
    select: PLAN_SELECT,
  });
  const frozen = snapshotOf(
    { ...toPlanRow, monthlyPriceAed: Number(toPlanRow.monthlyPriceAed), rankingMultiplier: Number(toPlanRow.rankingMultiplier) },
    now,
  ) as unknown as object;

  const invoiceId = await prisma.$transaction(async (tx) => {
    const renewsAt = quote.proration.renewsAt;

    await tx.business.update({ where: { id: businessId }, data: { planId: toPlanId } });

    /*
     * The revenue ledger, written where the change happens. Board 4g's
     * waterfall is a `GROUP BY` over these rows — the subscription table cannot
     * answer "what did this account pay last month", because the moment it is
     * updated the old plan is gone.
     */
    await recordMovement(tx, {
      businessId,
      fromPlanId: quote.fromPlan.id,
      toPlanId,
      beforeFils: aedToFils(quote.fromPlan.monthlyPriceAed),
      afterFils: aedToFils(quote.toPlan.monthlyPriceAed),
      occurredAt: now,
      note: `Plan change to ${quote.toPlan.name}`,
    });

    await tx.subscription.upsert({
      where: { businessId },
      create: {
        businessId,
        planId: toPlanId,
        status: "active",
        renewsAt,
        // A snapshot of what was bought, so a later plan edit cannot rewrite
        // what this seller is entitled to for the period they paid for.
        entitlementSnapshot: frozen,
      },
      update: {
        planId: toPlanId,
        status: "active",
        // Changing plan un-cancels. Both columns move together or the check
        // constraint refuses the row.
        cancelledAt: null,
        endsAt: null,
        entitlementSnapshot: frozen,
      },
    });

    if (quote.proration.netFils === 0) return null;

    const invoice = await tx.invoice.create({
      data: {
        ref: reference,
        businessId,
        status: "issued",
        issuedAt: now,
        lines: {
          create: [
            {
              kind: "subscription",
              description: `${quote.toPlan.name}, ${quote.proration.daysRemaining} days`,
              amountAed: filsToAed(quote.proration.chargeLine.fils),
            },
            ...(quote.proration.creditLine.fils > 0
              ? [
                  {
                    kind: "subscription_credit" as const,
                    description: `${quote.fromPlan.name}, ${quote.proration.daysRemaining} unused days`,
                    amountAed: `-${filsToAed(quote.proration.creditLine.fils)}`,
                  },
                ]
              : []),
          ],
        },
      },
      select: { id: true },
    });

    return invoice.id;
  });

  return { ok: true, invoiceId };
}

export interface CancellationSummary {
  /** What the seller keeps. Named, because the fear is that cancelling deletes. */
  kept: string[];
  lost: string[];
  endsAt: Date;
  planName: string;
}

export type CancelResult =
  | { ok: true; summary: CancellationSummary }
  | { ok: false; error: string };

/**
 * Cancel, at period end.
 *
 * Criterion 10's third part, and the one a seller is most anxious about. What
 * is kept is listed first and it is the longer list: the listing stays live on
 * Free, products are hidden rather than deleted, reviews are untouched and the
 * verification badge stays — it records what we checked, and cancelling a
 * subscription does not un-check it.
 *
 * Products are hidden **at period end**, not now. A seller who cancels on the
 * 3rd has paid for the month and keeps every product visible until it runs out.
 */
export async function cancelSubscription(
  actor: Actor,
  businessId: string,
  now = new Date(),
): Promise<CancelResult> {
  assertCanChangePlan(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only cancel your own subscription." };
  }

  const subscription = await prisma.subscription.findUnique({
    where: { businessId },
    select: { id: true, renewsAt: true, cancelledAt: true, plan: { select: { name: true } } },
  });

  if (!subscription) return { ok: false, error: "There is no subscription to cancel." };
  if (subscription.cancelledAt) {
    return { ok: false, error: "That subscription is already ending." };
  }

  await prisma.subscription.update({
    where: { businessId },
    data: {
      cancelledAt: now,
      // Paired with cancelledAt by a check constraint: a cancellation that does
      // not say when it ends is one nothing can act on.
      endsAt: subscription.renewsAt,
      status: "active",
    },
  });

  return {
    ok: true,
    summary: {
      planName: subscription.plan.name,
      endsAt: subscription.renewsAt,
      kept: ["listing", "products", "reviews", "badge"],
      lost: ["extra_seats", "ranking", "placement"],
    },
  };
}

/**
 * Apply an ended cancellation. Run by the same scheduled job as the metrics.
 *
 * Separate from `cancelSubscription` because the drop happens at period end and
 * nobody is holding a request open until then. Idempotent.
 */
export async function applyEndedCancellations(now = new Date()) {
  const due = await prisma.subscription.findMany({
    where: { cancelledAt: { not: null }, endsAt: { lte: now }, status: { not: "cancelled" } },
    select: {
      businessId: true,
      planId: true,
      plan: { select: { monthlyPriceAed: true } },
    },
  });

  for (const subscription of due) {
    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { businessId: subscription.businessId },
        data: { status: "cancelled", planId: "free" },
      });

      /*
       * Churn, dated the day the money stops rather than the day the seller
       * said so. A cancellation announced in January for a period ending in
       * March is a March event — booking it in January would show a month of
       * churn that had not happened yet.
       */
      await recordMovement(tx, {
        businessId: subscription.businessId,
        fromPlanId: subscription.planId,
        toPlanId: "free",
        beforeFils: aedToFils(Number(subscription.plan.monthlyPriceAed)),
        afterFils: 0,
        occurredAt: now,
        note: "Cancellation reached its end date",
      });
      await tx.business.update({
        where: { id: subscription.businessId },
        data: { planId: "free" },
      });
      /*
       * Hidden, not deleted. A seller who comes back next quarter finds their
       * catalogue where they left it, and a seller who does not still has not
       * lost work they did. `draft` is the state the CSV importer already uses
       * for the same reason.
       *
       * The verification tier is deliberately untouched: it records what we
       * checked, and cancelling a subscription does not un-check it.
       */
      await tx.product.updateMany({
        where: { businessId: subscription.businessId, status: "live" },
        data: { status: "draft" },
      });
    });
  }

  return { dropped: due.length, ranAt: now };
}

/** Invoices for the billing screen, newest first. */
export async function invoicesFor(actor: Actor, businessId: string) {
  assertCanManageBilling(actor);
  if (actor.businessId !== businessId) return [];

  return prisma.invoice.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      ref: true,
      status: true,
      issuedAt: true,
      paidAt: true,
      vatRate: true,
      lines: { select: { kind: true, description: true, qty: true, amountAed: true } },
    },
  });
}

/* ── Subscription credits — finance only, and never a refund ─────────────── */

export type CreditResult =
  | { ok: true; invoiceId: string }
  | {
      ok: false;
      error: "not_found" | "not_positive" | "too_large" | "no_subscription";
      message: string;
    };

export interface CreditInput {
  actor: Actor;
  businessId: string;
  /** Whole fils. Integer arithmetic everywhere; a credit is money we did charge. */
  fils: number;
  /** What the credit is for, in the seller's language — it prints on the invoice. */
  description: string;
  /** Why we issued it, in ours. Goes on the audit row, not the invoice. */
  reason: string;
}

/**
 * A subscription credit.
 *
 * `subscription.credit` is **finance only** — §07 gives ops lead a dash on this
 * row, which was inferred the other way for two handoffs and corrected in PR
 * #14. The most senior role does not hold every capability, and this is the row
 * that proves it.
 *
 * The vocabulary is load-bearing, not fussiness. This is a credit against
 * money the platform charged for a subscription. It is never a refund, because
 * a refund implies buyer funds, and CLAUDE.md's first rule is that the platform
 * is never party to a transaction and holds nothing to give back. `InvoiceLine`
 * has a `subscription_credit` kind and deliberately has no refund kind; the
 * schema will not let this be written as one.
 *
 * A credit lands as a negative line on its own issued invoice rather than
 * editing a past one. An invoice a seller has already downloaded is a record,
 * and a record that changes after the fact is not one.
 */
export async function issueSubscriptionCredit(input: CreditInput): Promise<CreditResult> {
  assertCanIssueSubscriptionCredit(input.actor);

  if (!Number.isInteger(input.fils) || input.fils <= 0) {
    return {
      ok: false,
      error: "not_positive",
      message: "A credit is a positive amount in whole fils.",
    };
  }

  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: {
      id: true,
      subscription: { select: { id: true, plan: { select: { monthlyPriceAed: true } } } },
    },
  });
  if (!business) {
    return { ok: false, error: "not_found", message: "That business is not in the directory." };
  }

  /*
   * No subscription, nothing to credit.
   *
   * This used to fall through to a ceiling computed from a monthly price of
   * zero, which produced a AED 12 cap and refused every real credit with
   * "that is more than a year of this plan" — an error naming a plan the
   * business does not have. CI caught it and a local run did not, because a
   * local database that has been seeded and mutated a dozen times happened to
   * offer a business with a subscription to the query the test used.
   */
  if (!business.subscription) {
    return {
      ok: false,
      error: "no_subscription",
      message: "That business has no subscription. A credit is against something we charged.",
    };
  }

  /*
   * A ceiling of one year of the current plan. Not a policy — a typo guard.
   * Fils are two orders of magnitude away from dirhams and the most likely
   * mistake here is one somebody makes with the decimal point, at which point
   * the number has already been written down as a fact.
   */
  const monthly = Number(business.subscription.plan.monthlyPriceAed);
  const ceiling = Math.max(monthly, 1) * 12 * 100;
  if (input.fils > ceiling) {
    return {
      ok: false,
      error: "too_large",
      message: `That is more than a year of this plan. The most a credit can be is AED ${Math.floor(ceiling / 100)}.`,
    };
  }

  const now = new Date();
  const reference = `CREDIT-${business.id.slice(-6)}-${now.getTime()}`;

  const invoiceId = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "subscription.credit",
        subject: `Business:${business.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const invoice = await tx.invoice.create({
          data: {
            ref: reference,
            businessId: business.id,
            status: "issued",
            issuedAt: now,
            lines: {
              create: [
                {
                  kind: "subscription_credit",
                  description: input.description,
                  amountAed: `-${filsToAed(input.fils)}`,
                },
              ],
            },
          },
          select: { id: true, ref: true },
        });
        return {
          result: invoice.id,
          before: null,
          after: { invoiceRef: invoice.ref, fils: input.fils },
        };
      },
    ),
  );

  return { ok: true, invoiceId };
}
