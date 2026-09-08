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
import { hideOverPlanCap, restoreHiddenByPlan } from "./plan-caps";
import {
  FILS_PER_AED,
  VAT_RATE,
  filsToAed,
  perDayFils,
  prorate,
  vatOn,
  type Proration,
} from "./proration";
import { issueInvoice } from "./invoice";
import { writeInvoicePdf } from "./issue-pdf";
import { scheduleChange } from "./schedule";
import { t } from "@/lib/i18n";
import {
  advance,
  anchorDayOf,
  monthlyValueFils,
  periodDays,
  periodPriceAed,
  type BillingTerm,
} from "./period";
import { snapshotOf } from "@/lib/plan/entitlements";
import { paymentProvider } from "./provider";
import { recordMovement } from "./mrr";

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
  locationLimit: true, photoLimit: true,
  categoryLimit: true, storageMb: true, teamSeats: true, rankingMultiplier: true,
  customDomain: true, analytics: true, csvImport: true, sponsoredEligible: true,
  sortOrder: true,
  // What a year costs, for pricing a period that is not a month. Not an
  // entitlement, so `snapshotOf` ignores it — see lib/plan/entitlements.ts.
  annualMonthsCharged: true,
} as const;

/**
 * Which way the change goes, and therefore when it happens.
 *
 * Board 11f settles the asymmetry that the old board only recommended:
 *
 *   - **upgrade** — applies on payment, pro-rates, states the day count.
 *   - **downgrade** — scheduled for the end of the period. Nothing charged
 *     today, nothing on the listing moved, withdrawable until the date.
 *
 * By price, not by cap. A plan is dearer or it is not; comparing caps would need
 * a rule for a plan with more products and fewer seats, and there is no such
 * rule that a seller would recognise. Equal prices count as a downgrade, because
 * scheduling charges nothing and applying immediately might.
 */
export type ChangeDirection = "upgrade" | "downgrade";

export interface PlanChangeQuote {
  fromPlan: { id: string; name: string; monthlyPriceAed: number; annualMonthsCharged: number | null };
  toPlan: { id: string; name: string; monthlyPriceAed: number; annualMonthsCharged: number | null };
  /** What this subscription is paid on. A plan change never moves it. */
  term: BillingTerm;
  /** Start of the period the change lands in, so the caller can price a day of it. */
  periodStartedAt: Date;
  direction: ChangeDirection;
  /**
   * The pro-rating, on an upgrade. **Null on a downgrade**, and that is the
   * whole of the model: a downgrade takes effect at period end, so there is no
   * part-period to price and `Due today` reads `AED 0.00`.
   */
  proration: Proration | null;
  /** When a downgrade lands. Null on an upgrade, which lands on payment. */
  effectiveAt: Date | null;
  /** What the new plan costs a period, VAT included. `From 14 Sep · AED 103.95`. */
  nextPeriodFils: number;
  /** When that first falls due. The renewal, unmoved. */
  nextDueAt: Date;
  /** "139.56", already signed. Zero on a downgrade. */
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
      select: {
        plan: { select: PLAN_SELECT },
        subscription: { select: { renewsAt: true, term: true, periodStartedAt: true } },
      },
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

  /*
     Periods, not months.

     A plan change keeps the period it happens in — that is the promise the
     change screen makes and the reason `renewsAt` comes back untouched — so
     both sides are priced over the *same* period and the same day count. On a
     monthly subscription that is a month, on an annual one it is a year, and
     `periodDays` is what tells the arithmetic which.
  */
  const term = business.subscription?.term ?? "monthly";
  const periodStartedAt = business.subscription?.periodStartedAt ?? now;
  const caps = { monthlyPriceAed: fromPlan.monthlyPriceAed, annualMonthsCharged: fromPlan.annualMonthsCharged };
  const toCapsRow = { monthlyPriceAed: toPlan.monthlyPriceAed, annualMonthsCharged: toPlan.annualMonthsCharged };

  const direction: ChangeDirection =
    toPlan.monthlyPriceAed > fromPlan.monthlyPriceAed ? "upgrade" : "downgrade";

  /*
     Only an upgrade is priced.

     A downgrade waits for the renewal, so there is no part-period to charge and
     no unused half-month to credit. That also removes the credit this file used
     to write: a credit on a platform that holds no funds has nowhere to go but
     the next invoice, so applying a downgrade on the day took the plan away
     immediately and gave the money back a month later. Waiting costs nobody
     anything.
  */
  const proration =
    direction === "upgrade"
      ? prorate({
          fromPeriodAed: periodPriceAed(caps, term),
          toPeriodAed: periodPriceAed(toCapsRow, term),
          periodDays: periodDays(periodStartedAt, renewsAt),
          renewsAt,
          now,
        })
      : null;

  /*
     What the new plan costs from the renewal, VAT included.

     `From 14 Sep · AED 103.95 incl. VAT` on the board — 99 + VAT, which is the
     figure a seller checks the downgrade against. Priced on the target plan and
     the *current* term, because a plan change never moves the term.
  */
  const nextPeriodAed = toPlan.monthlyPriceAed === 0 ? 0 : periodPriceAed(toCapsRow, term);
  const nextNetFils = Math.round(nextPeriodAed * FILS_PER_AED);

  return {
    ok: true,
    quote: {
      fromPlan: {
        id: fromPlan.id,
        name: fromPlan.name,
        monthlyPriceAed: fromPlan.monthlyPriceAed,
        annualMonthsCharged: fromPlan.annualMonthsCharged,
      },
      toPlan: {
        id: toPlan.id,
        name: toPlan.name,
        monthlyPriceAed: toPlan.monthlyPriceAed,
        annualMonthsCharged: toPlan.annualMonthsCharged,
      },
      term,
      periodStartedAt,
      direction,
      proration,
      effectiveAt: direction === "downgrade" ? renewsAt : null,
      nextPeriodFils: nextNetFils + vatOn(nextNetFils),
      nextDueAt: renewsAt,
      netAed: filsToAed(proration?.netFils ?? 0),
      providerIsLive: paymentProvider().live,
    },
  };
}

export type ChangeResult =
  | { ok: true; invoiceId: string | null; scheduled: boolean }
  | { ok: false; error: string; code?: "quote_moved" | "already_pending" };

/**
 * Move the business onto a different plan — or schedule the move.
 *
 * Two paths, and which one runs is not a preference:
 *
 * **An upgrade** applies on payment. The charge happens outside the transaction
 * and before it — a provider that is slow must not hold a transaction open, and
 * a provider that fails must not leave a seller on a plan nobody paid for.
 *
 * **A downgrade** is scheduled for the end of the period and nothing is charged.
 * See `scheduleChange` in ./schedule.
 *
 * ## The figure on the button is re-verified
 *
 * Criterion 7: *"an upgrade ... is re-verified server-side before charging. A
 * mismatch refuses the charge."* `expectedDueFils` is what the seller was shown.
 * It is recomputed here, from scratch, and a difference refuses rather than
 * adjusts — a screen open across a plan-price change would otherwise charge a
 * number the seller never agreed to, and adjusting silently is the version of
 * that which nobody notices.
 */
export async function changePlan(
  actor: Actor,
  businessId: string,
  toPlanId: string,
  expectedDueFils: number | null = null,
  now = new Date(),
): Promise<ChangeResult> {
  assertCanChangePlan(actor);

  const quoted = await quotePlanChange(actor, businessId, toPlanId, now);
  if (!quoted.ok) return quoted;
  const { quote } = quoted;

  if (quote.direction === "downgrade") {
    const scheduled = await scheduleChange(actor, businessId, toPlanId, quote.term);
    if (!scheduled.ok) {
      return scheduled.error === "already_pending"
        ? { ok: false, error: t("change.scheduled_already_short"), code: "already_pending" }
        : { ok: false, error: t("change.no_subscription") };
    }
    return { ok: true, invoiceId: null, scheduled: true };
  }

  const dueFils = quote.proration?.dueFils ?? 0;

  /*
     What was on the button, checked against what it costs now.

     Null means the caller did not quote — the confirm form always does, so this
     is a service-level call or a test. Refusing those too would make the
     function unusable from anywhere that has not just rendered a screen.
  */
  if (expectedDueFils !== null && expectedDueFils !== dueFils) {
    return { ok: false, error: t("change.quote_moved"), code: "quote_moved" };
  }

  const reference = `PLAN-${businessId.slice(-6)}-${toPlanId}-${now.getTime()}`;

  // VAT included, because that is what the seller agreed to pay. Charging the
  // net would take 5% less than the button said and leave an invoice that does
  // not reconcile with the card statement.
  if (dueFils > 0) {
    const charge = await paymentProvider().charge({
      businessId,
      fils: dueFils,
      description: `${quote.toPlan.name} plan, ${quote.proration?.daysRemaining ?? 0} days`,
      reference,
    });
    if (!charge.ok) {
      return { ok: false, error: charge.error ?? t("change.charge_failed") };
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
    // Unmoved by a plan change, which is the promise the screen makes.
    const renewsAt = quote.proration?.renewsAt ?? quote.nextDueAt;

    await tx.business.update({ where: { id: businessId }, data: { planId: toPlanId } });

    /*
       Both directions, in the order that keeps the count right.

       Up: put back what a previous drop hid, as far as the new cap allows — a
       seller who cancelled and came back should find their catalogue where they
       left it rather than as a page of drafts to republish one at a time.
       Down: hide what the new plan has no room for. Each is a no-op in the
       other direction, so one pair of calls covers an upgrade and a downgrade.
    */
    await restoreHiddenByPlan(businessId, toPlanRow, tx);
    await hideOverPlanCap(businessId, toPlanRow, tx);

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
      /*
       * The monthly *value*, not the list price.
       *
       * An annual subscription pays ten months for twelve, so it is worth ten
       * twelfths of the list price a month. `mrrNow` values live accounts with
       * the same function, and `reconcile()` compares the two — deriving a
       * monthly figure two ways here is how that check starts reporting a
       * difference nobody can explain.
       */
      beforeFils: monthlyValueFils(quote.fromPlan, quote.term),
      afterFils: monthlyValueFils(quote.toPlan, quote.term),
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
        /*
         * The first period. Monthly, because a term is chosen on the change
         * screen and this branch is the seller who had no subscription at all.
         * The anchor is today's day of the month, which is the day every future
         * renewal should land on.
         */
        term: "monthly",
        periodStartedAt: now,
        anchorDay: anchorDayOf(now),
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

    const proration = quote.proration;
    if (!proration || proration.netFils === 0) return null;

    /*
       The invoice, with its totals, through the one issuer.

       This used to build the row inline and store no totals at all, so the
       figure on the seller's list was whatever `invoiceList` computed at read
       time — the same class of defect as `BL-INV-20418` reading two different
       amounts on two boards. `issueInvoice` writes the subtotal, the VAT and the
       gross once, freezes who it was billed to, and takes the reference from the
       `BL-INV-…` sequence rather than from an internal charge reference nobody
       could quote at a bank.
    */
    const card = await tx.paymentMethod.findUnique({
      where: { businessId },
      select: { brand: true, last4: true },
    });

    const invoice = await issueInvoice(
      {
        businessId,
        issuedAt: now,
        // Paid, because the charge above succeeded before this transaction
        // opened. An `issued` row here would be an invoice for money already
        // taken.
        paidAt: now,
        paidBy: card,
        vatRate: proration.vatRate,
        /*
           The references board 11g prints under the totals.

           `reference` is what the provider was asked to charge against, so it is
           the string to quote at them when a seller disputes a line. The
           subscription one names the plan and the card, which is what a seller
           recognises on a statement.
        */
        pspRef: reference,
        subscriptionRef: `SUB-${card?.last4 ?? "0000"}-${quote.toPlan.id.toUpperCase()}`,
        lines: [
          {
            kind: "subscription",
            description: `${quote.toPlan.name}, ${proration.daysRemaining} of ${periodDays(quote.periodStartedAt, renewsAt)} days`,
            fils: proration.chargeLine.fils,
            periodStart: now,
            periodEnd: renewsAt,
          },
          ...(proration.creditLine.fils > 0
            ? [
                {
                  kind: "subscription_credit" as const,
                  description: `${quote.fromPlan.name}, ${proration.daysRemaining} unused days`,
                  fils: -proration.creditLine.fils,
                  periodStart: now,
                  periodEnd: renewsAt,
                },
              ]
            : []),
        ],
      },
      tx,
    );

    return invoice.id;
  });

  /*
     The PDF, after the transaction commits.

     Board 11g: written once at issue, and the download serves that file byte for
     byte. Outside the transaction on purpose — object storage is a different
     system, and holding a write transaction open across a network call is how a
     slow bucket becomes a database incident. A failure here leaves `pdfPath`
     null and the document screen says so; money has already moved and the
     invoice row is what must not be lost.
  */
  if (invoiceId) await writeInvoicePdf(invoiceId);

  return { ok: true, invoiceId, scheduled: false };
}

/* ── Changing term — the same plan, paid differently ─────────────────────── */

export interface TermChangeQuote {
  planName: string;
  from: BillingTerm;
  to: BillingTerm;
  proration: Proration;
  /** "3141.44", already signed. */
  netAed: string;
  /** When the new period ends. A term change **does** move this. */
  renewsAt: Date;
  providerIsLive: boolean;
}

export type TermQuoteResult =
  | { ok: true; quote: TermChangeQuote }
  | { ok: false; error: string };

/**
 * What switching between monthly and annual costs today.
 *
 * ## A term change starts a new period
 *
 * This is the one rule that keeps the arithmetic explainable, and it is the
 * opposite of what a plan change does. A plan change keeps the period — the
 * renewal date does not move, and the screen says so. A term change cannot:
 * switching to annual in the middle of a month cannot charge "the rest of a
 * year", because there is no year yet.
 *
 * So: the unused days of the current period are credited at that period's own
 * daily rate, a fresh period opens today, and the new period is charged in
 * full. The seller pays the difference. Where the credit is the larger — a
 * seller a fortnight into a paid year moving back to monthly — the net is
 * negative and lands on the next invoice as a subscription credit. This
 * platform holds no funds and pays none out.
 */
export async function quoteTermChange(
  actor: Actor,
  businessId: string,
  toTerm: BillingTerm,
  now = new Date(),
): Promise<TermQuoteResult> {
  assertCanChangePlan(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only change your own plan." };
  }

  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: {
      plan: { select: PLAN_SELECT },
      subscription: {
        select: { term: true, periodStartedAt: true, renewsAt: true, anchorDay: true },
      },
    },
  });

  const subscription = business.subscription;
  if (!subscription || !business.plan) {
    return { ok: false, error: "There is no subscription to change." };
  }
  if (subscription.term === toTerm) {
    return { ok: false, error: "That is how you already pay." };
  }

  const caps = {
    monthlyPriceAed: business.plan.monthlyPriceAed,
    annualMonthsCharged: business.plan.annualMonthsCharged,
  };
  if (toTerm === "annual" && caps.annualMonthsCharged === null) {
    return { ok: false, error: "That plan is not sold by the year." };
  }
  if (caps.monthlyPriceAed === 0) {
    return { ok: false, error: "Free has nothing to pay, so it has no term." };
  }

  /*
     Two periods, priced separately.

     `prorate` compares two plans over one period, which is not this shape: here
     the plan is the same and the period is what changes. So the credit is
     computed over the period being left and the charge is the whole of the new
     one — which is `prorate` with the outgoing price and nothing incoming, plus
     the new period's full price added on.
  */
  const leaving = prorate({
    fromPeriodAed: periodPriceAed(caps, subscription.term),
    toPeriodAed: 0,
    periodDays: periodDays(subscription.periodStartedAt, subscription.renewsAt),
    renewsAt: subscription.renewsAt,
    now,
  });

  const anchorDay = anchorDayOf(now);
  const nextRenewsAt = advance(now, toTerm, anchorDay);
  const newPeriodFils = Math.round(periodPriceAed(caps, toTerm) * FILS_PER_AED);

  const netFils = newPeriodFils - leaving.creditLine.fils;
  const vatFils = vatOn(netFils);

  const proration: Proration = {
    creditLine: leaving.creditLine,
    chargeLine: {
      kind: "charge",
      fils: newPeriodFils,
      days: periodDays(now, nextRenewsAt),
      perDayFils: perDayFils(periodPriceAed(caps, toTerm), periodDays(now, nextRenewsAt)),
    },
    netFils,
    // A term change is a supply like any other and carries VAT on the net, the
    // same convention board 3m states for everything else on this surface.
    vatFils,
    dueFils: netFils + vatFils,
    daysRemaining: leaving.daysRemaining,
    renewsAt: nextRenewsAt,
    vatRate: VAT_RATE,
  };

  return {
    ok: true,
    quote: {
      planName: business.plan.name,
      from: subscription.term,
      to: toTerm,
      proration,
      netAed: filsToAed(proration.netFils),
      renewsAt: nextRenewsAt,
      providerIsLive: paymentProvider().live,
    },
  };
}

/**
 * Move the subscription onto the other term.
 *
 * Same shape as `changePlan`: the charge happens outside the transaction and
 * only a success reaches the switch, so a slow provider does not hold a
 * transaction open and a failed one does not leave a seller on a period nobody
 * paid for.
 *
 * Writes an MRR movement, and it is the fifth caller of `recordMovement` —
 * `lib/billing/mrr.ts` lists them. Monthly to annual on the same plan is a
 * **contraction** of two twelfths, because that is what it is: an annual price
 * trades recurring revenue for cash and retention, and a revenue screen that
 * hid the trade would be the wrong screen.
 */
export async function changeTerm(
  actor: Actor,
  businessId: string,
  toTerm: BillingTerm,
  now = new Date(),
): Promise<ChangeResult> {
  assertCanChangePlan(actor);

  const quoted = await quoteTermChange(actor, businessId, toTerm, now);
  if (!quoted.ok) return quoted;
  const { quote } = quoted;

  const plan = await prisma.plan.findFirstOrThrow({
    where: { businesses: { some: { id: businessId } } },
    select: PLAN_SELECT,
  });
  const caps = {
    monthlyPriceAed: plan.monthlyPriceAed,
    annualMonthsCharged: plan.annualMonthsCharged,
  };

  const reference = `TERM-${businessId.slice(-6)}-${toTerm}-${now.getTime()}`;

  if (quote.proration.netFils > 0) {
    const charge = await paymentProvider().charge({
      businessId,
      fils: quote.proration.netFils,
      description: `${quote.planName} plan, ${toTerm === "annual" ? "one year" : "one month"}`,
      reference,
    });
    if (!charge.ok) {
      return { ok: false, error: charge.error ?? "That payment did not go through." };
    }
  }

  const invoiceId = await prisma.$transaction(async (tx) => {
    await recordMovement(tx, {
      businessId,
      fromPlanId: plan.id,
      toPlanId: plan.id,
      beforeFils: monthlyValueFils(caps, quote.from),
      afterFils: monthlyValueFils(caps, quote.to),
      occurredAt: now,
      note: toTerm === "annual" ? "Moved to annual" : "Moved to monthly",
    });

    await tx.subscription.update({
      where: { businessId },
      data: {
        term: toTerm,
        // A new period, opening today. This is the half a plan change does not do.
        periodStartedAt: now,
        renewsAt: quote.renewsAt,
        anchorDay: anchorDayOf(now),
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
              description: `${quote.planName}, ${toTerm === "annual" ? "one year" : "one month"}`,
              amountAed: filsToAed(quote.proration.chargeLine.fils),
            },
            ...(quote.proration.creditLine.fils > 0
              ? [
                  {
                    kind: "subscription_credit" as const,
                    description: `${quote.planName}, ${quote.proration.daysRemaining} unused days`,
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

  // A term change is never scheduled: there is no period end to wait for when
  // the period itself is what is changing.
  return { ok: true, invoiceId, scheduled: false };
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

export type ResumeResult =
  | { ok: true; planName: string; renewsAt: Date }
  | { ok: false; error: "not_cancelling" };

/**
 * `Resume Pro`. The way back from a scheduled cancellation.
 *
 * Board 3m's cancellation-scheduled state puts this in the banner that replaces
 * the cancel card, and it costs nothing: the period is paid for, the plan never
 * moved, and un-cancelling is two columns going back to null. There is no charge
 * and no new period — a seller who changed their mind inside the month they had
 * already bought has not bought anything else.
 *
 * Writes no MRR movement, deliberately. `applyEndedCancellations` books churn on
 * the day the money stops, and this ran before that day: nothing was ever
 * recorded to reverse, and writing a pair of offsetting rows would put a
 * cancellation that did not happen into board 4g's waterfall.
 */
export async function resumeSubscription(
  actor: Actor,
  businessId: string,
): Promise<ResumeResult> {
  assertCanChangePlan(actor);
  if (actor.businessId !== businessId) return { ok: false, error: "not_cancelling" };

  const subscription = await prisma.subscription.findUnique({
    where: { businessId },
    select: { cancelledAt: true, renewsAt: true, plan: { select: { name: true } } },
  });
  if (!subscription?.cancelledAt) return { ok: false, error: "not_cancelling" };

  await prisma.subscription.update({
    where: { businessId },
    // Both columns together, or the check constraint refuses the row.
    data: { cancelledAt: null, endsAt: null, status: "active" },
  });

  return { ok: true, planName: subscription.plan.name, renewsAt: subscription.renewsAt };
}

/**
 * Apply an ended cancellation. Run by the daily job at `/api/jobs/daily`,
 * after dunning, which may itself have dropped the account.
 *
 * The comment here used to say the metrics job ran it. It did not, and had
 * never imported it, so a cancelled subscription kept its plan past the period
 * end until somebody noticed.
 *
 * Separate from `cancelSubscription` because the drop happens at period end and
 * nobody is holding a request open until then. Idempotent.
 */
export async function applyEndedCancellations(now = new Date()) {
  const free = await prisma.plan.findUnique({
    where: { id: "free" },
    select: { productLimit: true },
  });
  const freeProductLimit = free?.productLimit ?? null;

  const due = await prisma.subscription.findMany({
    where: { cancelledAt: { not: null }, endsAt: { lte: now }, status: { not: "cancelled" } },
    select: {
      businessId: true,
      planId: true,
      term: true,
      plan: { select: { monthlyPriceAed: true, annualMonthsCharged: true } },
    },
  });

  for (const subscription of due) {
    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { businessId: subscription.businessId },
        data: { status: "cancelled", planId: "free" },
      });

      /*
         And the half of the promise that was never kept.

         `cancelSubscription` has returned `kept: ["listing", "products", ...]`
         since handoff 5 and nothing anywhere hid a product, so a Pro seller who
         cancelled carried a hundred and fifty live products onto Free and the
         cap the ladder rests on stopped meaning anything after the first
         downgrade. Board 2e puts the sentence in the rail — "hidden, not
         deleted" — which is criterion 20, and this is where it becomes true.
      */
      await hideOverPlanCap(subscription.businessId, { productLimit: freeProductLimit }, tx);

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
        // What the account was worth a month, which on an annual term is not
        // the list price. Same function `mrrNow` values it with.
        beforeFils: monthlyValueFils(
          {
            monthlyPriceAed: Number(subscription.plan.monthlyPriceAed),
            annualMonthsCharged: subscription.plan.annualMonthsCharged,
          },
          subscription.term,
        ),
        afterFils: 0,
        occurredAt: now,
        note: "Cancellation reached its end date",
      });
      await tx.business.update({
        where: { id: subscription.businessId },
        data: { planId: "free" },
      });
      /*
         There was a second hide here, and it undid the first.

         `hideOverPlanCap` above drafts what the Free cap has no room for and
         leaves the ten that stay. Directly after it, this drafted *every*
         remaining live product — so a cancelling Pro seller with 1,204 products
         ended on Free with none live, and the call above did nothing that
         survived the same transaction.

         That is exactly the sentence board 3m's fourth correction is about,
         reached from the opposite side: the boards claimed all 1,204 "stay saved
         but hidden", and the code made the claim true. The rule `3f` §6 owns is
         that **ten stay live and the seller picks which**, and criterion 9
         restates it for the cancel path. Deleting these four lines is what makes
         both true.

         The verification tier is still deliberately untouched: it records what
         we checked, and cancelling a subscription does not un-check it.
      */
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
        /*
           Through `issueInvoice`, not a bare `create`.

           This wrote its row inline and so carried none of what board 11g's
           document needs: no stored totals, no supplier snapshot, and a
           `CREDIT-…` reference rather than one from the `BL-INV-` series. It
           was the last writer still doing that, and the tax-invoice screen would
           have rendered it with derived figures and an empty supplier block.

           A `credit_note`, with no `correctsId`: this is a goodwill credit
           finance issues against an account rather than a correction to one
           specific document, and a negative total on something headed
           `TAX INVOICE` would be the wrong heading on a legal record.
        */
        const invoice = await issueInvoice(
          {
            businessId: business.id,
            docType: "credit_note",
            issuedAt: now,
            lines: [
              {
                kind: "subscription_credit",
                description: input.description,
                fils: -input.fils,
              },
            ],
          },
          tx,
        );
        return {
          result: invoice.id,
          before: null,
          after: { invoiceRef: invoice.ref, fils: input.fils },
        };
      },
    ),
  );

  // Outside the transaction, for the reason `changePlan` states: object storage
  // is a different system and a write transaction must not wait on one.
  await writeInvoicePdf(invoiceId);

  return { ok: true, invoiceId };
}
