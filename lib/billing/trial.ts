import "server-only";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { assertCanChangePlan } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { snapshotOf } from "@/lib/plan/entitlements";
import { hideOverPlanCap } from "./plan-caps";

/**
 * The Pro trial — fourteen days, no card, and it ends by dropping to Free.
 *
 * Board 2e, criteria 11 to 14. Every one of them is a rule about *not* doing
 * something, which is what makes the feature small: a trial that takes no card
 * has nothing to charge at the end of it, so there is no provider call, no
 * invoice, no dunning branch and no retry. The account simply stops being on
 * Pro.
 *
 * That is why this could be built now. `docs/` and the billing notes are
 * explicit that trials were left out because *"a trial hangs off the renewal
 * cycle — `trialing` → first charge at trial end — so building one means
 * changing `runRenewals` and adding a branch to dunning"*. That is true of a
 * card-capturing trial and this is not one: board 2e says so twice, in
 * criterion 12 and in `1l`'s own words, *"a trial that captures a card is a
 * subscription with a delay"*. `runRenewals` and `runDunning` are untouched —
 * both skip `trialing` because neither has a `renewsAt` to act on until the
 * seller chooses to pay.
 *
 * ## The three rules that are easy to get wrong
 *
 * **Once, ever.** `trialStartedAt` is set on the first trial and nothing clears
 * it. A seller who trialled, dropped, and came back sees no trial language at
 * all — criterion 11 — rather than a second free fortnight every time they
 * cancel.
 *
 * **Pro only.** Criterion 14. Basic's CTA never implies one, and this refuses a
 * trial on any other plan rather than trusting the screen not to offer it.
 *
 * **Ends by dropping, never by suspending.** Criterion 13. Products over the
 * new cap are hidden, not deleted, which is the same sentence the No lock-in
 * card makes and the same code path a cancellation takes.
 */

/** Fourteen days, as `1l` and board 2e both state it. */
export const TRIAL_DAYS = 14;

/** The one plan a trial is offered on. */
export const TRIAL_PLAN_ID = "pro";

export interface TrialState {
  /** True once a trial has ever been started. Suppresses all trial language. */
  used: boolean;
  /** Set while one is running. */
  endsAt: Date | null;
  /** Running right now. */
  active: boolean;
}

export function trialEndsAt(startedAt: Date, days = TRIAL_DAYS): Date {
  const ends = new Date(startedAt);
  ends.setUTCDate(ends.getUTCDate() + days);
  return ends;
}

/** What the plan step needs to know before it renders a single word about trials. */
export async function trialStateFor(businessId: string, now = new Date()): Promise<TrialState> {
  const subscription = await prisma.subscription.findUnique({
    where: { businessId },
    select: { trialStartedAt: true, trialEndsAt: true, status: true },
  });
  if (!subscription?.trialStartedAt) return { used: false, endsAt: null, active: false };

  return {
    used: true,
    endsAt: subscription.trialEndsAt,
    active:
      subscription.status === "trialing" &&
      subscription.trialEndsAt !== null &&
      subscription.trialEndsAt > now,
  };
}

export type StartTrialResult =
  | { ok: true; endsAt: Date }
  | { ok: false; reason: "already_used" | "wrong_plan" | "already_paid" | "not_found" };

/**
 * Start it. Criterion 12: no card, and nothing here asks a provider for one.
 *
 * A subscription row is created if the business has none, because until now a
 * Free account has no row — Free is a plan, not a subscription, and nothing was
 * billing it. The row a trial creates carries no `providerRef` and writes no
 * invoice and no `MrrMovement`: a trial is worth nothing a month, and booking
 * expansion for it would put fourteen days of imaginary revenue into board 4g's
 * waterfall and take it out again a fortnight later.
 *
 * `renewsAt` is the trial's own end. Nothing renews it — `runRenewals` skips
 * `trialing` — but the column is `NOT NULL` and a date that lies about when the
 * period ends is worse than one that agrees with `trialEndsAt`.
 */
export async function startTrial(
  actor: Actor,
  businessId: string,
  now = new Date(),
): Promise<StartTrialResult> {
  assertCanChangePlan(actor);
  if (actor.businessId !== businessId) return { ok: false, reason: "not_found" };

  const [business, plan] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: { planId: true, subscription: { select: { trialStartedAt: true, status: true } } },
    }),
    prisma.plan.findUnique({
      where: { id: TRIAL_PLAN_ID },
      select: {
        id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true,
        productLimit: true,
        serviceLimit: true, locationLimit: true, photoLimit: true, publicPhotoLimit: true,
  categoryLimit: true, storageMb: true, teamSeats: true,
        rankingMultiplier: true, customDomain: true,
        analytics: true, csvImport: true, sponsoredEligible: true,
        sortOrder: true, withdrawnAt: true,
      },
    }),
  ]);
  if (!business || !plan) return { ok: false, reason: "not_found" };
  if (plan.withdrawnAt) return { ok: false, reason: "wrong_plan" };

  // Criterion 11, enforced rather than assumed. The screen hides the offer; this
  // refuses it, so a stale tab cannot take a second fortnight.
  if (business.subscription?.trialStartedAt) return { ok: false, reason: "already_used" };

  /*
     A seller who is already paying does not get a trial of what they have.
     Board 2e's own edge case: somebody who bought on `1l` before onboarding
     sees a one-line confirmation instead of three cards, and this is the same
     rule behind it.
  */
  if (business.planId && business.planId !== "free") return { ok: false, reason: "already_paid" };

  const ends = trialEndsAt(now);
  const frozen = snapshotOf(
    { ...plan, monthlyPriceAed: Number(plan.monthlyPriceAed), rankingMultiplier: Number(plan.rankingMultiplier) },
    now,
  ) as unknown as object;

  await prisma.$transaction(async (tx) => {
    await tx.business.update({ where: { id: businessId }, data: { planId: TRIAL_PLAN_ID } });
    await tx.subscription.upsert({
      where: { businessId },
      create: {
        businessId,
        planId: TRIAL_PLAN_ID,
        status: "trialing",
        startedAt: now,
        periodStartedAt: now,
        renewsAt: ends,
        anchorDay: now.getUTCDate(),
        trialStartedAt: now,
        trialEndsAt: ends,
        entitlementSnapshot: frozen,
      },
      update: {
        planId: TRIAL_PLAN_ID,
        status: "trialing",
        periodStartedAt: now,
        renewsAt: ends,
        trialStartedAt: now,
        trialEndsAt: ends,
        entitlementSnapshot: frozen,
        // A trial is not a cancellation. Clearing these stops the ended-
        // cancellation sweep from dropping the account on the old end date.
        cancelledAt: null,
        endsAt: null,
      },
    });
  });

  return { ok: true, endsAt: ends };
}

export interface TrialSweep {
  /** How many trials ran out on this pass. */
  ended: number;
  /** How many products were hidden by the drop, across all of them. */
  hidden: number;
}

/**
 * Drop every trial that has run out. Criterion 13.
 *
 * Runs in the daily job **before** renewals, because a trial that ended today
 * must be off Pro before anything reads the row looking for something to
 * charge. It drops to Free rather than suspending, and it hides the products the
 * Free cap has no room for rather than deleting them — the same guarantee the
 * No lock-in card makes, through the same code.
 *
 * No `MrrMovement`. The account was worth nothing a month before this and is
 * worth nothing after it, and a churn row for revenue that never existed is the
 * kind of invented metric board 4g's waterfall exists to avoid.
 *
 * Idempotent: `status: "trialing"` is the guard, so a second pass on the same
 * day finds nothing.
 */
export async function expireTrials(now = new Date()): Promise<TrialSweep> {
  const due = await prisma.subscription.findMany({
    where: { status: "trialing", trialEndsAt: { lte: now } },
    select: { businessId: true },
  });
  if (due.length === 0) return { ended: 0, hidden: 0 };

  const free = await prisma.plan.findUnique({
    where: { id: "free" },
    select: { productLimit: true },
  });

  let hidden = 0;
  for (const subscription of due) {
    await prisma.$transaction(async (tx) => {
      await tx.business.update({
        where: { id: subscription.businessId },
        data: { planId: "free" },
      });
      await tx.subscription.update({
        where: { businessId: subscription.businessId },
        data: {
          planId: "free",
          /*
             `expired`, not `cancelled`. Nobody cancelled anything — the trial
             reached its own end — and board 11f's screens read `cancelledAt` to
             decide whether to say "ending on the 14th". A trial that set it
             would put a cancellation in a seller's billing history that they
             never made.
          */
          status: "expired",
          trialEndsAt: null,
          entitlementSnapshot: Prisma.DbNull,
        },
      });
      // `trialStartedAt` is deliberately left. It is the record that stops a
      // second trial, and clearing it here would hand out one a fortnight.
      const outcome = await hideOverPlanCap(
        subscription.businessId,
        { productLimit: free?.productLimit ?? null },
        tx,
      );
      hidden += outcome.hidden;
    });
  }

  return { ended: due.length, hidden };
}
