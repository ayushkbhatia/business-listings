import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import { effectiveCaps, snapshotOf, type PlanCaps } from "@/lib/plan/entitlements";

/**
 * Board 12e — entitlements as data.
 *
 * *"Entitlements are data, not code — changing a number affects every account on
 * that plan, and existing accounts are grandfathered unless 'apply to existing'
 * is explicitly ticked."*
 *
 * Both halves of that sentence were untrue until now, in opposite directions.
 * The caps have always been columns on `Plan`, so the first half held. The
 * second did not: `Subscription.entitlementSnapshot` promised grandfathering in
 * its own doc comment and stored `{ planId, capturedAt }` — no numbers — and
 * nothing read it. Changing a plan moved **every** account on it immediately,
 * including ones that had paid for something else.
 *
 * So "apply to existing" now has something to do. Unticked, a plan edit changes
 * what new subscriptions get and leaves existing snapshots alone. Ticked, it
 * rewrites them — which is the destructive option, which is why it is a
 * separate decision with its own count on screen.
 */

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true,
  locationLimit: true, photoLimit: true, publicPhotoLimit: true,
  categoryLimit: true, storageMb: true, teamSeats: true, rankingMultiplier: true,
  customDomain: true, analytics: true, csvImport: true, sponsoredEligible: true,
  sortOrder: true,
  // Not a cap and not in `PlanCaps` — read so the withdrawal can be compared by
  // value rather than written blind. See `withdrawalMoved`.
  withdrawnAt: true,
} as const;

function toCaps(row: {
  id: string;
  name: string;
  monthlyPriceAed: unknown;
  enquiriesPerMonth: number | null;
  productLimit: number | null;
  locationLimit: number | null;
  photoLimit: number | null;
  publicPhotoLimit: number | null;
  storageMb: number | null;
  teamSeats: number;
  rankingMultiplier: unknown;
  customDomain: boolean;
  analytics: boolean;
  csvImport: boolean;
  sponsoredEligible: boolean;
  categoryLimit: number | null;
  sortOrder: number;
}): PlanCaps {
  return {
    ...row,
    monthlyPriceAed: Number(row.monthlyPriceAed),
    rankingMultiplier: Number(row.rankingMultiplier),
  };
}

export interface PlanRow extends PlanCaps {
  /** Live subscriptions on this plan. The blast radius of an edit. */
  subscriptions: number;
  /** How many of those are grandfathered on different numbers. */
  grandfathered: number;
  /** Board 1l criterion 12. Null means on sale. Not a cap, so not in PlanCaps. */
  withdrawnAt: Date | null;
}

/**
 * Every plan, with what an edit to it would move.
 *
 * The grandfathered count is the one that matters. "Changing this affects 12
 * accounts, 4 of which are on different numbers" is a different decision from
 * "changing this affects 12 accounts", and the difference is exactly what the
 * snapshot is for.
 */
export async function planLibrary(): Promise<PlanRow[]> {
  const plans = await prisma.plan.findMany({
    orderBy: { sortOrder: "asc" },
    select: {
      ...PLAN_SELECT,
      subscriptions: {
        where: { status: { in: ["active", "trialing", "past_due"] } },
        select: { entitlementSnapshot: true },
      },
    },
  });

  return plans.map((plan) => {
    const caps = toCaps(plan);
    let grandfathered = 0;
    for (const subscription of plan.subscriptions) {
      const effective = effectiveCaps(caps, subscription.entitlementSnapshot);
      if (
        effective.enquiriesPerMonth !== caps.enquiriesPerMonth ||
        effective.productLimit !== caps.productLimit ||
        effective.locationLimit !== caps.locationLimit ||
        effective.photoLimit !== caps.photoLimit ||
        effective.teamSeats !== caps.teamSeats ||
        effective.customDomain !== caps.customDomain
      ) {
        grandfathered += 1;
      }
    }
    return {
      ...caps,
      // Not a cap, so it is not in `caps` — carried through for the screen,
      // which now has a control for it. See `EditPlanInput.withdrawnAt`.
      withdrawnAt: plan.withdrawnAt,
      subscriptions: plan.subscriptions.length,
      grandfathered,
    };
  });
}

export type EntitlementResult =
  | { ok: true; existingUpdated: number }
  | { ok: false; error: "not_found" | "out_of_range" | "nothing_changed"; message: string };

export interface EditPlanInput {
  actor: Actor;
  planId: string;
  changes: Partial<{
    enquiriesPerMonth: number | null;
    productLimit: number | null;
    locationLimit: number | null;
    photoLimit: number | null;
    publicPhotoLimit: number | null;
    /**
     * Megabytes of media. Null is unlimited, like every other cap here.
     *
     * It was the one cap with a column, a snapshot key, a meter on `3m`, a row
     * on `11f` and an enforcement point in the media library — and no way to
     * set it. So the value that decides whether a seller can upload was
     * reachable only by writing the row by hand, which skips the audit row
     * every other entitlement change writes.
     */
    storageMb: number | null;
    teamSeats: number;
    /**
     * Categories a listing may claim. The fifth numeric cap.
     *
     * Board 11f renders it as its own comparison row, so a seller reads it —
     * and until this batch nobody could change it without writing the row by
     * hand, which skips the audit row every other entitlement change writes.
     */
    categoryLimit: number | null;
    customDomain: boolean;
    /*
       The three switches board 11f renders beside the caps.

       Same argument as `storageMb` above: each is a row a seller compares plans
       on, each is read by real code — `analytics` gates /dashboard/analytics and
       its export, `csvImport` gates the mapper, `sponsoredEligible` gates the
       placement screen — and none had a writer.
    */
    analytics: boolean;
    csvImport: boolean;
    sponsoredEligible: boolean;
    }>;
  /**
   * Withdraw the plan from sale, or put it back. Board 1l criterion 12.
   *
   * Beside `changes` rather than inside it, because it is not an entitlement:
   * it changes nothing for anybody already on the plan, and it must not reach
   * `snapshotOf`. What it changes is whether the plan can be *bought*.
   *
   * Five surfaces read `Plan.withdrawnAt` — `isPurchasable`, the onboarding
   * plan step, the trial gate, `11f`'s change screen and the plan-cohort
   * metric — and nothing wrote it, so a plan could be taken off sale only in
   * the database.
   *
   * An intent rather than a date: the column stores *when*, and that is this
   * function's to stamp. A caller-supplied date is a date somebody could
   * choose, and re-saving an already-withdrawn plan would move it — which
   * would make "withdrawn on the 14th" mean the date of the last edit.
   */
  withdrawn?: boolean;
  /**
   * Rewrite the snapshots of everybody already on this plan.
   *
   * Off by default, and the default is the point: an account that signed up on
   * forty enquiries a month keeps forty until a person decides otherwise and
   * says why.
   */
  applyToExisting: boolean;
  reason: string;
}

const CAP_CEILING = 100_000;

/**
 * Edit a plan's entitlements.
 *
 * `plan.entitlements.write` is ops lead or finance — the one commercial row §07
 * gives them both. The price is deliberately not editable here: changing what a
 * plan costs is a decision with a proration and an invoice behind it, and it
 * does not belong on the same form as a cap.
 */
export async function editPlanEntitlements(
  input: EditPlanInput,
  now = new Date(),
): Promise<EntitlementResult> {
  const plan = await prisma.plan.findUnique({
    where: { id: input.planId },
    select: PLAN_SELECT,
  });
  if (!plan) return { ok: false, error: "not_found", message: "That plan is not one we sell." };

  for (const [key, value] of Object.entries(input.changes)) {
    if (typeof value !== "number") continue;
    if (!Number.isInteger(value) || value < 0 || value > CAP_CEILING) {
      return {
        ok: false,
        error: "out_of_range",
        message: `${key} is a whole number from 0 to ${CAP_CEILING}. Leave it empty for unlimited.`,
      };
    }
  }

  const before = toCaps(plan);
  const after: PlanCaps = { ...before, ...input.changes };

  const moved = (Object.keys(input.changes) as (keyof PlanCaps)[]).filter(
    (key) => before[key] !== after[key],
  );
  /*
     Withdrawal counts as a change, and it is a change of *state* rather than of
     date: on-sale to withdrawn, or back. Re-saving a plan that is already
     withdrawn moves nothing, which is what keeps `nothing_changed` honest and
     keeps the original date on the row.
  */
  const withdrawalMoved =
    input.withdrawn !== undefined && input.withdrawn !== (plan.withdrawnAt !== null);
  if (withdrawalMoved) moved.push("withdrawnAt" as keyof PlanCaps);
  if (moved.length === 0) {
    return {
      ok: false,
      error: "nothing_changed",
      message: "Those are the numbers it already has.",
    };
  }

  const existingUpdated = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "plan.entitlements.write",
        subject: `Plan:${plan.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        await tx.plan.update({
          where: { id: plan.id },
          data: {
            ...input.changes,
            ...(withdrawalMoved ? { withdrawnAt: input.withdrawn ? now : null } : {}),
          },
        });

        let updated = 0;
        if (input.applyToExisting) {
          /*
           * The destructive path. Every live subscription's snapshot is
           * rewritten to the new numbers, which is what "apply to existing"
           * means and why it is off by default — a seller who signed up on
           * forty enquiries a month is on forty until somebody decides
           * otherwise and writes down why.
           */
          const live = await tx.subscription.findMany({
            where: { planId: plan.id, status: { in: ["active", "trialing", "past_due"] } },
            select: { id: true },
          });
          const frozen = snapshotOf(after, now) as unknown as object;
          for (const subscription of live) {
            await tx.subscription.update({
              where: { id: subscription.id },
              data: { entitlementSnapshot: frozen },
            });
          }
          updated = live.length;
        }

        return {
          result: updated,
          before: Object.fromEntries(moved.map((key) => [key, before[key]])),
          after: {
            ...Object.fromEntries(moved.map((key) => [key, after[key]])),
            applyToExisting: input.applyToExisting,
            existingUpdated: updated,
          },
        };
      },
    ),
  );

  return { ok: true, existingUpdated };
}

/**
 * What one subscription is actually entitled to, snapshot and all.
 *
 * The screen that answers "why can this seller only add ten products when the
 * plan says fifty" — which, before the snapshot carried numbers, had no answer
 * because the difference did not exist.
 */
export async function effectiveFor(businessId: string): Promise<PlanCaps | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      plan: { select: PLAN_SELECT },
      subscription: { select: { entitlementSnapshot: true } },
    },
  });
  if (!business?.plan) return null;
  return effectiveCaps(toCaps(business.plan), business.subscription?.entitlementSnapshot);
}
