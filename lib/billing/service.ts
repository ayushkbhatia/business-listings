import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanChangePlan, assertCanManageBilling } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { filsToAed, prorate, type Proration } from "./proration";
import { paymentProvider } from "./provider";

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

  const invoiceId = await prisma.$transaction(async (tx) => {
    const renewsAt = quote.proration.renewsAt;

    await tx.business.update({ where: { id: businessId }, data: { planId: toPlanId } });

    await tx.subscription.upsert({
      where: { businessId },
      create: {
        businessId,
        planId: toPlanId,
        status: "active",
        renewsAt,
        // A snapshot of what was bought, so a later plan edit cannot rewrite
        // what this seller is entitled to for the period they paid for.
        entitlementSnapshot: { planId: toPlanId, capturedAt: now.toISOString() },
      },
      update: {
        planId: toPlanId,
        status: "active",
        // Changing plan un-cancels. Both columns move together or the check
        // constraint refuses the row.
        cancelledAt: null,
        endsAt: null,
        entitlementSnapshot: { planId: toPlanId, capturedAt: now.toISOString() },
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
    select: { businessId: true },
  });

  for (const subscription of due) {
    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { businessId: subscription.businessId },
        data: { status: "cancelled", planId: "free" },
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
