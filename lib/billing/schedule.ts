import "server-only";
import {
  creditUnusedPlacement,
  endPlacementsFor,
  type EndedPlacement,
} from "@/lib/placement/term";
import { Prisma, type CancelReason, type SubscriptionChangeKind } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { assertCanChangePlan } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { removeSeat } from "@/lib/team/invite";
import { actorFromDevSeller } from "@/lib/auth/dev-seller";
import { snapshotOf, type PlanCaps } from "@/lib/plan/entitlements";
import { hideOverPlanCap, restoreHiddenByPlan } from "./plan-caps";
import { monthlyValueFils, type BillingTerm } from "./period";
import { recordMovement } from "./mrr";

/**
 * Board 11f — the change that has not happened yet.
 *
 * *"A downgrade takes effect at the end of the period."* Nothing is charged on
 * the day, nothing on the listing moves, and the seller can withdraw it right up
 * to the date. Three consequences, and all three are why this is a table rather
 * than three columns on `Subscription`:
 *
 *   1. **It is withdrawable.** Withdrawing a row is one write. Withdrawing three
 *      nullable columns is three writes and a bet that nothing read them apart.
 *   2. **It carries the seller's choice.** Basic holds less than this seller has,
 *      so the screen hands over which products, branches and seats survive. That
 *      choice belongs to the change: withdraw the change and it goes with it.
 *   3. **There is at most one.** Q8. A partial unique index in the migration,
 *      not a check here — two pending changes make the effective-date arithmetic
 *      uncheckable, because the second would have to know whether the first had
 *      landed to know what it was changing from.
 *
 * ## Why an upgrade does not come through here
 *
 * An upgrade applies on payment and pro-rates — `changePlan` in ./service. The
 * asymmetry is deliberate and it is the seller's: waiting for a downgrade costs
 * them nothing and keeps what they paid for, while waiting for an upgrade would
 * charge them for a plan they are not yet on.
 */

/** The three shortfalls a seller picks between. Storage is not one — see plan-grid. */
export type KeepKind = "products" | "locations" | "seats";

export interface PendingChange {
  id: string;
  /**
   * Which act this row is. Boards 11h and 11j.
   *
   * A cancellation is a scheduled move to Free carrying the same keep lists, so
   * it lives in this table — but it is not a downgrade and must not be rendered
   * as one. `3m` shows the cancellation banner for one and the "moving to
   * Basic" note for the other; `11f` offers to withdraw a plan change and sends
   * a cancellation back to `11h`.
   */
  kind: SubscriptionChangeKind;
  /** Set on a cancellation, and never surfaced to the seller. Build note B6. */
  cancelReason: CancelReason | null;
  cancelNote: string | null;
  fromPlan: { id: string; name: string };
  toPlan: { id: string; name: string };
  fromTerm: BillingTerm;
  toTerm: BillingTerm;
  effectiveAt: Date;
  keepProductIds: string[] | null;
  keepLocationIds: string[] | null;
  keepSeatIds: string[] | null;
}

const CHANGE_SELECT = {
  id: true,
  kind: true,
  cancelReason: true,
  cancelNote: true,
  fromPlanId: true,
  toPlanId: true,
  fromTerm: true,
  toTerm: true,
  effectiveAt: true,
  keepProductIds: true,
  keepLocationIds: true,
  keepSeatIds: true,
  fromPlan: { select: { id: true, name: true } },
  toPlan: { select: { id: true, name: true } },
} as const;

/** A stored id list, defensively. Anything that is not a list of ids is none. */
export function readIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function toPending(row: {
  id: string;
  kind: SubscriptionChangeKind;
  cancelReason: CancelReason | null;
  cancelNote: string | null;
  fromTerm: BillingTerm;
  toTerm: BillingTerm;
  effectiveAt: Date;
  keepProductIds: Prisma.JsonValue;
  keepLocationIds: Prisma.JsonValue;
  keepSeatIds: Prisma.JsonValue;
  fromPlan: { id: string; name: string };
  toPlan: { id: string; name: string };
}): PendingChange {
  return {
    id: row.id,
    kind: row.kind,
    cancelReason: row.cancelReason,
    cancelNote: row.cancelNote,
    fromPlan: row.fromPlan,
    toPlan: row.toPlan,
    fromTerm: row.fromTerm,
    toTerm: row.toTerm,
    effectiveAt: row.effectiveAt,
    keepProductIds: readIds(row.keepProductIds),
    keepLocationIds: readIds(row.keepLocationIds),
    keepSeatIds: readIds(row.keepSeatIds),
  };
}

/**
 * The pending change, if there is one.
 *
 * Neither applied nor withdrawn is what "pending" means, and it is the same
 * predicate the partial unique index uses — so this can never return two.
 */
export async function pendingChangeFor(businessId: string): Promise<PendingChange | null> {
  const row = await prisma.subscriptionChange.findFirst({
    where: { businessId, appliedAt: null, withdrawnAt: null },
    orderBy: { createdAt: "desc" },
    select: CHANGE_SELECT,
  });
  return row ? toPending(row) : null;
}

export type ScheduleResult =
  | { ok: true; change: PendingChange }
  | { ok: false; error: "no_subscription" | "already_pending" | "same_plan" };

/**
 * Schedule a change for the end of the period.
 *
 * `effectiveAt` is copied from `renewsAt` rather than read at apply time, because
 * the renewal date can move underneath a pending change — a term switch opens a
 * new period today — and the date on the button was a promise. Board 11f prints
 * it twice: *"Your Pro features run to 13 Sep"* and *"Withdraw any time before
 * 13 Sep."*
 */
export async function scheduleChange(
  actor: Actor,
  businessId: string,
  toPlanId: string,
  toTerm: BillingTerm,
): Promise<ScheduleResult> {
  assertCanChangePlan(actor);
  if (actor.businessId !== businessId) return { ok: false, error: "no_subscription" };

  const subscription = await prisma.subscription.findUnique({
    where: { businessId },
    select: { planId: true, term: true, renewsAt: true },
  });
  if (!subscription) return { ok: false, error: "no_subscription" };

  if (subscription.planId === toPlanId && subscription.term === toTerm) {
    return { ok: false, error: "same_plan" };
  }

  const existing = await pendingChangeFor(businessId);
  if (existing) return { ok: false, error: "already_pending" };

  try {
    const row = await prisma.subscriptionChange.create({
      data: {
        businessId,
        fromPlanId: subscription.planId,
        toPlanId,
        fromTerm: subscription.term,
        toTerm,
        effectiveAt: subscription.renewsAt,
      },
      select: CHANGE_SELECT,
    });
    return { ok: true, change: toPending(row) };
  } catch (error) {
    /*
       The index, not the read above, is what actually enforces one pending
       change. Two requests a millisecond apart both find nothing and both
       insert; only the second gets this. Reporting it as `already_pending` is
       the truth — by the time it failed, there was one.
    */
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "already_pending" };
    }
    throw error;
  }
}

export type WithdrawResult = { ok: true } | { ok: false; error: "not_pending" };

/**
 * Take it back. `Keep Pro` on the board, and the reason the change is a route
 * rather than a confirmation dialog.
 */
export async function withdrawChange(
  actor: Actor,
  businessId: string,
  now = new Date(),
  kind: SubscriptionChangeKind | null = "plan_change",
): Promise<WithdrawResult> {
  assertCanChangePlan(actor);
  if (actor.businessId !== businessId) return { ok: false, error: "not_pending" };

  /*
     Scoped to one kind by default, and that default is `plan_change`.

     `11f`'s rail and `11h`'s banner both sit over this table, and an unscoped
     withdraw would let `Keep Pro` on the change screen silently take back a
     *cancellation* — leaving `subscription.cancelledAt` set with nothing
     scheduled to act on it. Resuming goes through `resumeSubscription`, which
     clears both together. Passing null withdraws whatever is pending and is for
     the paths that own both, such as scheduling a cancellation over a downgrade.
  */
  const updated = await prisma.subscriptionChange.updateMany({
    where: { businessId, appliedAt: null, withdrawnAt: null, ...(kind ? { kind } : {}) },
    data: { withdrawnAt: now },
  });

  return updated.count > 0 ? { ok: true } : { ok: false, error: "not_pending" };
}

export type KeepResult = { ok: true; kept: number } | { ok: false; error: "not_pending" | "too_many" };

/**
 * Record which items survive the change.
 *
 * Refuses a list longer than the target plan allows, because the whole point of
 * the step is that the plan holds fewer — accepting an over-long list would
 * silently drop the tail at apply time and pick for the seller anyway, which is
 * the choice they were just given.
 *
 * A shorter list is fine and is not padded. A seller who keeps three products
 * when Basic would hold a hundred has decided something, and inventing
 * ninety-seven more would be the platform choosing.
 */
export async function saveKeep(
  actor: Actor,
  businessId: string,
  kind: KeepKind,
  ids: readonly string[],
  cap: number | null,
): Promise<KeepResult> {
  assertCanChangePlan(actor);
  if (actor.businessId !== businessId) return { ok: false, error: "not_pending" };
  if (cap !== null && ids.length > cap) return { ok: false, error: "too_many" };

  const unique = [...new Set(ids)];
  const column =
    kind === "products"
      ? { keepProductIds: unique as unknown as Prisma.InputJsonValue }
      : kind === "locations"
        ? { keepLocationIds: unique as unknown as Prisma.InputJsonValue }
        : { keepSeatIds: unique as unknown as Prisma.InputJsonValue };

  const updated = await prisma.subscriptionChange.updateMany({
    where: { businessId, appliedAt: null, withdrawnAt: null },
    data: column,
  });

  return updated.count > 0 ? { ok: true, kept: unique.length } : { ok: false, error: "not_pending" };
}

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true,
  locationLimit: true, photoLimit: true, publicPhotoLimit: true, categoryLimit: true, storageMb: true, teamSeats: true,
  rankingMultiplier: true, customDomain: true, analytics: true, csvImport: true,
  sponsoredEligible: true, sortOrder: true, annualMonthsCharged: true,
} as const;

export interface AppliedChanges {
  applied: number;
  ranAt: Date;
  /** Sponsored slots ended by a downgrade off eligibility. D2. */
  placementsEnded: number;
}

/**
 * Apply every change whose date has arrived. The daily job runs this.
 *
 * Ordered after dunning and after `applyEndedCancellations`, because both can
 * move the plan underneath a pending change. A change from Pro that finds the
 * account already on Free is applied anyway and lands on the same plan it would
 * have: the target is what the seller chose, and the route they took to Free
 * does not change what they asked for next.
 *
 * Idempotent by `appliedAt`, so a job that runs twice in a day applies nothing
 * twice.
 */
export async function applyDueChanges(now = new Date()): Promise<AppliedChanges> {
  /*
     Plan changes only. A cancellation is applied by `applyEndedCancellations`,
     which runs immediately before this in the daily job.

     Both would otherwise act on the same row: the cancellation step moves the
     plan and books the churn, and this one would then apply the same move again
     and write a second MRR movement for it. One kind, one applier — and the
     step that owns a cancellation is the one that also has to set
     `subscription.status` to `cancelled`, which this has no business doing.
  */
  const due = await prisma.subscriptionChange.findMany({
    where: { kind: "plan_change", appliedAt: null, withdrawnAt: null, effectiveAt: { lte: now } },
    orderBy: { effectiveAt: "asc" },
    select: {
      id: true,
      businessId: true,
      fromPlanId: true,
      toPlanId: true,
      toTerm: true,
      keepProductIds: true,
      keepLocationIds: true,
      keepSeatIds: true,
      toPlan: { select: PLAN_SELECT },
      fromPlan: { select: { monthlyPriceAed: true, annualMonthsCharged: true } },
      business: { select: { subscription: { select: { term: true, anchorDay: true } } } },
    },
  });

  let applied = 0;
  let placementsEnded = 0;
  // Credited after the loop, outside the transaction. See the note on the same
  // pattern in `applyEndedCancellations`.
  const endedPlacements: { businessId: string; ended: EndedPlacement[] }[] = [];

  for (const change of due) {
    const toPlan: PlanCaps & { annualMonthsCharged: number | null } = {
      ...change.toPlan,
      monthlyPriceAed: Number(change.toPlan.monthlyPriceAed),
      rankingMultiplier: Number(change.toPlan.rankingMultiplier),
    };

    /*
       The seat evictions happen outside the transaction, before it.

       `removeSeat` reassigns the seat's open leads in its own transaction —
       7d §6.3, an orphaned lead is the same failure as an unroutable one — and
       nesting that inside this one would hold a write transaction open across
       an unbounded number of enquiry updates. A seat removed and a plan that
       then fails to switch is recoverable by re-inviting; a lead pointing at
       nobody is not visible in any scope board 3j offers.
    */
    await evictSeats(change.businessId, readIds(change.keepSeatIds), toPlan.teamSeats);

    await prisma.$transaction(async (tx) => {
      await tx.business.update({
        where: { id: change.businessId },
        data: { planId: change.toPlanId },
      });

      await tx.subscription.updateMany({
        where: { businessId: change.businessId },
        data: {
          planId: change.toPlanId,
          term: change.toTerm,
          // What was bought, frozen, so a later plan edit cannot rewrite what
          // this seller is entitled to for the period they are about to pay for.
          entitlementSnapshot: snapshotOf(toPlan, now) as unknown as Prisma.InputJsonValue,
        },
      });

      /*
         Restore first, then the seller's choice, then the cap. The order is
         load-bearing and getting it wrong is silent.

         `restoreHiddenByPlan` puts back what an *earlier* drop hid, as far as
         the new cap allows — the right thing on the way up, and a no-op when
         nothing was ever hidden. Running it after the keep list instead
         un-hides the very products the seller had just deselected, because it
         cannot tell the platform's old list from the seller's new decision. An
         integration test asserting one kept product found seventeen.

         So: put back what we hid, then let the seller's list decide, then catch
         whatever is still over the cap.
      */
      await restoreHiddenByPlan(change.businessId, toPlan, tx);

      await applyKeepLists(tx, change.businessId, {
        products: readIds(change.keepProductIds),
        locations: readIds(change.keepLocationIds),
      });

      /*
         The cap, for whatever the seller did not choose between: somebody who
         never opened the chooser, or who chose fewer products than the plan
         holds and then added more before the date. The oldest stay, which is
         `hideOverPlanCap`'s rule and the same answer the cancel path gives.
      */
      await hideOverPlanCap(change.businessId, toPlan, tx);

      await recordMovement(tx, {
        businessId: change.businessId,
        fromPlanId: change.fromPlanId,
        toPlanId: change.toPlanId,
        beforeFils: monthlyValueFils(
          {
            monthlyPriceAed: Number(change.fromPlan.monthlyPriceAed),
            annualMonthsCharged: change.fromPlan.annualMonthsCharged,
          },
          change.business.subscription?.term ?? "monthly",
        ),
        afterFils: monthlyValueFils(toPlan, change.toTerm),
        occurredAt: now,
        note: `Scheduled change to ${toPlan.name} reached its date`,
      });

      /*
         A downgrade off `sponsoredEligible` takes the slot with it. D2.

         Only when the new plan does not carry it, so an upgrade and a sideways
         move leave the placement alone — this is the plan losing the
         entitlement, not any plan change at all. `toPlan` is the snapshot being
         frozen onto the subscription three statements above, so it is the same
         answer every screen will give afterwards.
      */
      if (!toPlan.sponsoredEligible) {
        const ended = await endPlacementsFor(tx, change.businessId, now, "downgraded");
        if (ended.length > 0) {
          placementsEnded += ended.length;
          endedPlacements.push({ businessId: change.businessId, ended });
        }
      }

      await tx.subscriptionChange.update({
        where: { id: change.id },
        data: { appliedAt: now },
      });
    });

    applied += 1;
  }

  for (const row of endedPlacements) {
    await creditUnusedPlacement(row.ended, row.businessId, now);
  }

  return { applied, placementsEnded, ranAt: now };
}

/**
 * Unpublish the branches and unlist the products the seller did not keep.
 *
 * Only ever hides. A change must not unhide something the seller hid themselves
 * — criterion 11, and board 11f's fifth correction: `Branches published · All 4`
 * states the cap rather than the state, and on board 3c the Abu Dhabi branch is
 * `Hidden` by the seller's own choice. So a keep list is read as *"of the things
 * that are live, these stay"*, never as *"these are live"*.
 */
export async function applyKeepLists(
  tx: Prisma.TransactionClient,
  businessId: string,
  keep: { products: string[] | null; locations: string[] | null },
) {
  if (keep.products) {
    const dropped = await tx.product.findMany({
      where: { businessId, status: "live", id: { notIn: keep.products } },
      select: { id: true },
    });
    if (dropped.length > 0) {
      const ids = dropped.map((product) => product.id);
      await tx.product.updateMany({ where: { id: { in: ids } }, data: { status: "draft" } });

      /*
         Recorded as ours, so an upgrade puts them back.

         The same list `hideOverPlanCap` writes, and appended rather than
         replaced for the same reason: a Pro → Basic → Free walk has to restore
         correctly on the way up, and the second drop must not forget the first.
      */
      const subscription = await tx.subscription.findUnique({
        where: { businessId },
        select: { hiddenByPlan: true },
      });
      if (subscription) {
        const already = readIds(subscription.hiddenByPlan) ?? [];
        await tx.subscription.update({
          where: { businessId },
          data: {
            hiddenByPlan: [...new Set([...already, ...ids])] as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }
  }

  if (keep.locations) {
    await tx.location.updateMany({
      where: { businessId, published: true, id: { notIn: keep.locations } },
      data: { published: false },
    });
  }
}

/**
 * Remove the seats the seller did not keep, through the path that reassigns
 * their leads first.
 *
 * A no-op without a keep list. Seats are the one shortfall with no automatic
 * answer: the oldest product is a defensible thing to keep and the oldest
 * *colleague* is not, so a seller who never opened the chooser keeps everybody
 * and the team screen refuses the next invitation instead. That is the same
 * refusal `inviteSeat` already makes at the cap, and it is the direction to be
 * wrong in.
 */
export async function evictSeats(businessId: string, keep: string[] | null, cap: number) {
  if (!keep) return;

  const seats = await prisma.user.findMany({
    where: { businessId, roles: { hasSome: ["seller_manager", "seller_sales", "seller_finance"] } },
    select: { id: true, roles: true },
  });

  const owner = await prisma.user.findFirst({
    where: { businessId, roles: { has: "seller_owner" } },
    select: { id: true, roles: true },
  });
  // Without an owner there is nobody who could have authorised this, and
  // `removeSeat` asserts a capability rather than trusting its caller.
  if (!owner) return;

  const actor = actorFromDevSeller({ userId: owner.id, roles: owner.roles, businessId });
  const dropped = seats.filter((seat) => !keep.includes(seat.id));

  for (const seat of dropped) {
    // Their open leads go to the unassigned queue rather than to a seat this
    // job would have to pick. 7d §6.3 offers both and only one is defensible
    // without a person present.
    await removeSeat(actor, seat.id, { reassignToId: null });
  }

  // The cap is what the seller agreed to; the chooser is how they met it. If a
  // list somehow leaves them over it the team screen's own refusal takes over,
  // and nothing here removes somebody the seller did not deselect.
  void cap;
}
