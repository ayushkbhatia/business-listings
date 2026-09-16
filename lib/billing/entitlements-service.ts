import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { effectiveCaps, snapshotOf, toCaps, type PlanCaps } from "@/lib/plan/entitlements";
import {
  PLAN_FIELDS,
  planFieldSpec,
  type PlanEditableField,
} from "@/lib/plan/plan-fields";
import {
  diffPlanEdits,
  fingerprintOf,
  type PlanChangeSet,
  type PlanConfigState,
  type PlanEdit,
  type PlanFieldValue,
} from "./plan-diff";

/**
 * Board 12e — entitlements as data.
 *
 * *"Entitlements are data, not code — changing a number affects every account on
 * that plan, and existing accounts are grandfathered unless 'apply to existing'
 * is explicitly ticked."*
 *
 * Both halves of that sentence were untrue once, in opposite directions. The
 * caps have always been columns on `Plan`, so the first half held. The second
 * did not: `Subscription.entitlementSnapshot` promised grandfathering in its
 * own doc comment and stored `{ planId, capturedAt }` — no numbers — and
 * nothing read it. Changing a plan moved **every** account on it immediately,
 * including ones that had paid for something else.
 *
 * ## What the 12e revision changed
 *
 * The board widened the screen from seven caps to the whole config — *"every
 * numeric cell across Free, Basic and Pro is now an editable input"* — and put
 * three demands on this module with it:
 *
 *   `B7`  Apply-to-existing needs a scope, a preview and a confirm. So the
 *         writer takes a **set** of edits across plans, a diff is computed
 *         before anything is written, and the commit refuses a set computed
 *         against numbers that have since moved.
 *   `B12` Every write here is audited with the actor, the same as a weight
 *         change on `12c`. One audit row per plan touched, inside one
 *         transaction, so a four-plan edit is four rows and one commit.
 *   `B2`  No ranking field. `rankingMultiplier` is a column this module reads
 *         and never writes; `lib/search/ranking.ts` is the model's home.
 */

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true, serviceLimit: true,
  locationLimit: true, photoLimit: true, publicPhotoLimit: true,
  categoryLimit: true, storageMb: true, teamSeats: true, rankingMultiplier: true,
  customDomain: true, analytics: true, csvImport: true, sponsoredEligible: true,
  sortOrder: true,
  /*
     Months charged for a year — the annual price, as a multiplier rather than
     a second price column. Board 12e flag 4: `3m` quotes an annual figure and
     says it *"should come from the config rather than from arithmetic on the
     page"*, which it now does, because this is the config and the page reads
     `monthlyPriceAed × annualMonthsCharged`.
  */
  annualMonthsCharged: true,
  // Not a cap and not in `PlanCaps` — read so the withdrawal can be compared by
  // value rather than written blind.
  withdrawnAt: true,
} as const;

export interface PlanRow extends PlanCaps {
  /** Months charged for a year. Null means this plan is monthly-only. */
  annualMonthsCharged: number | null;
  /** Live subscriptions on this plan. The blast radius of an edit. */
  subscriptions: number;
  /** How many of those are grandfathered on different numbers. */
  grandfathered: number;
  /** Board 1l criterion 12. Null means on sale. Not a cap, so not in PlanCaps. */
  withdrawnAt: Date | null;
}

/** The subset of a plan row the diff reads, without the rest of the row. */
export function toConfigState(plan: PlanRow, now: Date = new Date()): PlanConfigState {
  const values = {} as Record<PlanEditableField, PlanFieldValue>;
  for (const spec of PLAN_FIELDS) {
    values[spec.field] = plan[spec.field] as PlanFieldValue;
  }
  return {
    id: plan.id,
    name: plan.name,
    values,
    onSale: plan.withdrawnAt === null || plan.withdrawnAt > now,
    subscriptions: plan.subscriptions,
    grandfathered: plan.grandfathered,
  };
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
      // Not caps, so not in `caps` — carried through for the screen, which has
      // a control for both.
      annualMonthsCharged: plan.annualMonthsCharged,
      withdrawnAt: plan.withdrawnAt,
      subscriptions: plan.subscriptions.length,
      grandfathered,
    };
  });
}

/** Every plan as the diff reads it, in one call. */
export async function planStates(now: Date = new Date()): Promise<PlanConfigState[]> {
  const plans = await planLibrary();
  return plans.map((plan) => toConfigState(plan, now));
}

export type PlanEditError = "not_found" | "out_of_range" | "nothing_changed" | "stale";

export type EntitlementResult =
  | { ok: true; existingUpdated: number; plansChanged: string[] }
  | { ok: false; error: PlanEditError; message: string };

export interface EditPlanConfigInput {
  actor: Actor;
  /** One entry per plan the form touched. Unchanged plans cost nothing. */
  edits: readonly PlanEdit[];
  /**
   * Rewrite the snapshots of everybody already on the plans whose caps moved.
   *
   * Off by default, and the default is the point: an account that signed up on
   * forty enquiries a month keeps forty until a person decides otherwise and
   * says why.
   */
  applyToExisting: boolean;
  reason: string;
  /**
   * The fingerprint the preview was computed against.
   *
   * Absent for a caller with no preview step — the service layer, a test, a
   * job. Present from the console, where an ops lead confirmed a specific diff
   * and must not commit a different one because somebody else moved a row in
   * between.
   */
  expect?: string;
}

/**
 * The widest a number on this table may be.
 *
 * One ceiling for caps and prices both. A cap of 100,000 products is a cap
 * nobody reaches and a price of AED 100,000 a month is not a plan; past that
 * the likelier explanation is a typed extra digit, and a refusal that names the
 * range is cheaper than an invoice that does not.
 */
const CAP_CEILING = 100_000;
const MONTHS_IN_YEAR = 12;

/** Whether one posted value is legal for its field. */
function rangeErrorFor(field: PlanEditableField, value: PlanFieldValue): string | null {
  const spec = planFieldSpec(field);
  if (!spec) return `${field} is not a plan field.`;

  if (spec.kind === "switch") {
    return typeof value === "boolean" ? null : `${field} is on or off.`;
  }
  if (value === null) {
    return spec.empty === null ? `${field} needs a number.` : null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > CAP_CEILING) {
    return `${field} is a whole number from 0 to ${CAP_CEILING}.`;
  }
  /*
     Months charged for a year, not months of anything else. Zero would be a
     free year on a paid plan and thirteen is not a year — both are a typo
     rather than a decision, and both would reach `annualPriceAed` as arithmetic
     nobody could check.
  */
  if (field === "annualMonthsCharged" && (value < 1 || value > MONTHS_IN_YEAR)) {
    return `annualMonthsCharged is 1 to ${MONTHS_IN_YEAR} months, or empty for monthly-only.`;
  }
  return null;
}

/**
 * What these edits would do, without doing it.
 *
 * `B7`'s middle step. The count on the commit button comes from here, and so
 * does the fingerprint that ties the two together.
 */
export async function previewPlanConfig(
  edits: readonly PlanEdit[],
  now: Date = new Date(),
): Promise<PlanChangeSet> {
  return diffPlanEdits(await planStates(now), edits);
}

/**
 * Write a plan-config change set.
 *
 * One transaction, one audit row per plan, one reason across all of them —
 * because it is one decision. Splitting a four-plan repricing into four
 * separately-reasoned writes would make the log harder to read, not easier: the
 * reason is why the table moved, and the rows say which numbers moved where.
 */
export async function editPlanConfig(
  input: EditPlanConfigInput,
  now: Date = new Date(),
): Promise<EntitlementResult> {
  /*
     Checked before anything is read, and again inside `staffMutation`.

     The second check is the one that cannot be skipped, but it only happens
     once there is something to write — so without this a moderator could post a
     change set and be told "those are the numbers it already has", which is a
     small fact about the plan table they have no grant to ask for.
  */
  assertCan(input.actor, "plan.entitlements.write");

  for (const edit of input.edits) {
    for (const [field, value] of Object.entries(edit.values)) {
      const error = rangeErrorFor(field as PlanEditableField, value as PlanFieldValue);
      if (error) {
        return {
          ok: false,
          error: "out_of_range",
          message: `${error} Leave a cap empty for unlimited.`,
        };
      }
    }
  }

  const states = await planStates(now);
  const known = new Set(states.map((plan) => plan.id));
  const unknown = input.edits.find((edit) => !known.has(edit.planId));
  if (unknown) {
    return { ok: false, error: "not_found", message: "That plan is not one we sell." };
  }

  /*
     The preview and the commit have to be about the same numbers.

     Two ops leads on one screen, or one who left the tab open, would otherwise
     confirm a diff and write a different one. The comparison is against the
     *before* values the preview read, so an unrelated edit to an untouched
     field does not block the commit — only a change to something this set is
     about.
  */
  if (input.expect !== undefined && input.expect !== fingerprintOf(states, input.edits)) {
    return {
      ok: false,
      error: "stale",
      message: "Those numbers moved while this was open. Review the change again.",
    };
  }

  const changeSet = diffPlanEdits(states, input.edits);
  if (changeSet.changes.length === 0) {
    return { ok: false, error: "nothing_changed", message: "Those are the numbers it already has." };
  }

  const updated = await prisma.$transaction(async (tx) => {
    let existingUpdated = 0;
    for (const change of changeSet.changes) {
      existingUpdated += await writeOnePlan({
        tx,
        actor: input.actor,
        reason: input.reason,
        change,
        applyToExisting: input.applyToExisting,
        now,
      });
    }
    return existingUpdated;
  });

  return {
    ok: true,
    existingUpdated: updated,
    plansChanged: changeSet.changes.map((change) => change.planId),
  };
}

/** One plan's half of a change set, inside the caller's transaction. */
async function writeOnePlan({
  tx,
  actor,
  reason,
  change,
  applyToExisting,
  now,
}: {
  tx: Prisma.TransactionClient;
  actor: Actor;
  reason: string;
  change: PlanChangeSet["changes"][number];
  applyToExisting: boolean;
  now: Date;
}): Promise<number> {
  const data: Record<string, PlanFieldValue | Date | null> = {};
  for (const field of change.fields) {
    if (field.field === "onSale") {
      // An intent, not a date: the column stores *when*, and that is this
      // function's to stamp. A caller-supplied date is one somebody could
      // choose, and re-saving a withdrawn plan would move it — which would make
      // "withdrawn on the 14th" mean the date of the last edit.
      data["withdrawnAt"] = field.after === true ? null : now;
    } else {
      data[field.field] = field.after;
    }
  }

  /*
     Only a plan whose *caps* moved has snapshots worth rewriting.

     A price is not in the snapshot and never has been — `effectiveCaps` takes
     the name, the price and the ranking multiplier from the live plan, because
     those are facts about the plan today rather than about what somebody
     bought. So applying a price-only change to existing accounts would rewrite
     every snapshot to today's caps and silently end the grandfathering on caps
     this edit never touched.
  */
  const capsMoved = change.fields.some(
    (field) =>
      field.field !== "onSale" &&
      field.field !== "monthlyPriceAed" &&
      field.field !== "annualMonthsCharged",
  );

  return staffMutation(
    {
      actor,
      capability: "plan.entitlements.write",
      subject: `Plan:${change.planId}`,
      reason,
      tx,
    },
    async () => {
      await tx.plan.update({ where: { id: change.planId }, data });

      let updated = 0;
      if (applyToExisting && capsMoved) {
        /*
         * The destructive path. Every live subscription's snapshot is rewritten
         * to this plan's numbers in full — not only the fields this edit moved
         * — which is what "apply to existing" means: everybody on the plan is
         * on the plan's numbers. It is off by default for the same reason.
         */
        const after = await tx.plan.findUniqueOrThrow({
          where: { id: change.planId },
          select: PLAN_SELECT,
        });
        const live = await tx.subscription.findMany({
          where: { planId: change.planId, status: { in: ["active", "trialing", "past_due"] } },
          select: { id: true },
        });
        const frozen = snapshotOf(toCaps(after), now) as unknown as object;
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
        before: Object.fromEntries(change.fields.map((field) => [field.field, field.before])),
        after: {
          ...Object.fromEntries(change.fields.map((field) => [field.field, field.after])),
          applyToExisting: applyToExisting && capsMoved,
          existingUpdated: updated,
          /*
             Recorded on the row rather than inferred from it later. A price
             change reaches every live subscription at its next renewal whether
             or not anybody ticked apply-to-existing, and the log should not
             need the reader to know that.
          */
          ...(change.repricing ? { repricedAtRenewal: change.subscriptions } : {}),
        },
        /*
           Board 4i `B4`: the live subscriptions whose snapshot was rewritten.
           Without "apply to existing" the edit touches the plan row alone.
        */
        blastRadius: applyToExisting && capsMoved
          ? { count: updated, unit: "subscriptions" as const }
          : null,
      };
    },
  );
}

export interface CreatePlanInput {
  actor: Actor;
  /** The plan id, which is its slug and is immutable once anything is on it. */
  id: string;
  name: string;
  monthlyPriceAed: number;
  /** The plan whose caps the new one starts from. */
  copyFromPlanId: string;
  reason: string;
}

export type CreatePlanResult =
  | { ok: true; planId: string }
  | { ok: false; error: "taken" | "not_found" | "bad_id" | "out_of_range"; message: string };

/** Lower-case letters, digits and single hyphens. The id reaches a URL and a seed. */
const PLAN_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MAX_PLAN_ID = 32;

/**
 * Add a plan — board 12e Q3, answered.
 *
 * *"Can a plan be added, and what happens to the four rows that already
 * exist?"* Nothing happens to them. A new plan is **born withdrawn from sale**:
 * `withdrawnAt` is stamped at creation, so `isPurchasable` is false, `/pricing`
 * does not render it, onboarding cannot select it and no trial can start on it.
 * It exists as a row an ops lead can then edit in the matrix, and it becomes
 * buyable only when somebody deliberately ticks it back on sale — which is its
 * own audited change with its own reason.
 *
 * Its caps are copied from an existing plan rather than defaulted. A plan
 * created with every cap null is a plan with unlimited everything, which is the
 * one shape of mistake this screen must not make easy; copying names the
 * starting point in the audit row.
 *
 * `rankingMultiplier` is *not* copied and defaults to 1. `B2`: plan tier's
 * weight in search is `12c`'s, and a new plan inheriting Pro's position in the
 * results by way of a copy button would be exactly the second writer that
 * correction 1 took off this board.
 */
export async function createPlan(
  input: CreatePlanInput,
  now: Date = new Date(),
): Promise<CreatePlanResult> {
  assertCan(input.actor, "plan.entitlements.write");

  const id = input.id.trim().toLowerCase();
  if (!PLAN_ID.test(id) || id.length > MAX_PLAN_ID) {
    return {
      ok: false,
      error: "bad_id",
      message: "A plan id is lower-case letters, digits and hyphens — pro-plus, not Pro Plus.",
    };
  }
  if (
    !Number.isInteger(input.monthlyPriceAed) ||
    input.monthlyPriceAed < 0 ||
    input.monthlyPriceAed > CAP_CEILING
  ) {
    return {
      ok: false,
      error: "out_of_range",
      message: `A monthly price is a whole number of dirhams from 0 to ${CAP_CEILING}, ex-VAT.`,
    };
  }
  if (input.name.trim().length === 0) {
    return { ok: false, error: "bad_id", message: "A plan needs a name a seller will read." };
  }

  const [existing, source] = await Promise.all([
    prisma.plan.findUnique({ where: { id }, select: { id: true } }),
    prisma.plan.findUnique({ where: { id: input.copyFromPlanId }, select: PLAN_SELECT }),
  ]);
  if (existing) {
    return { ok: false, error: "taken", message: "There is already a plan with that id." };
  }
  if (!source) {
    return { ok: false, error: "not_found", message: "That plan is not one we sell." };
  }

  const last = await prisma.plan.findFirst({
    // `id` is the tiebreak, because two plans may share a sort order and
    // `findFirst` without one picks whichever the planner hands back.
    orderBy: [{ sortOrder: "desc" }, { id: "desc" }],
    select: { sortOrder: true },
  });

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "plan.entitlements.write",
        subject: `Plan:${id}`,
        reason: input.reason,
        action: "plan_created",
        tx,
      },
      async () => {
        await tx.plan.create({
          data: {
            id,
            name: input.name.trim(),
            monthlyPriceAed: input.monthlyPriceAed,
            enquiriesPerMonth: source.enquiriesPerMonth,
            productLimit: source.productLimit,
            serviceLimit: source.serviceLimit,
            locationLimit: source.locationLimit,
            photoLimit: source.photoLimit,
            publicPhotoLimit: source.publicPhotoLimit,
            storageMb: source.storageMb,
            categoryLimit: source.categoryLimit,
            teamSeats: source.teamSeats,
            annualMonthsCharged: source.annualMonthsCharged,
            customDomain: source.customDomain,
            analytics: source.analytics,
            csvImport: source.csvImport,
            sponsoredEligible: source.sponsoredEligible,
            sortOrder: (last?.sortOrder ?? 0) + 1,
            // Born withdrawn. Nobody can buy it until somebody says so.
            withdrawnAt: now,
          },
        });

        return {
          result: id,
          before: null,
          after: {
            id,
            name: input.name.trim(),
            monthlyPriceAed: input.monthlyPriceAed,
            copiedFrom: source.id,
            onSale: false,
          },
          blastRadius: null,
        };
      },
    ),
  );

  return { ok: true, planId: id };
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
