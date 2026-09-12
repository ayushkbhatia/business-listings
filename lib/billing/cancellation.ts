import "server-only";
import { Prisma, type CancelReason } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { storageUsedBytes } from "@/lib/media/service";
import { assertCanChangePlan } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { effectiveCaps, monthStart, type PlanCaps } from "@/lib/plan/entitlements";
import { resolveNotificationSenders } from "@/lib/notify/senders";
import { absoluteUrl, siteUrl } from "@/lib/site";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { consequenceTable, lastPaidDay, type CancelFacts, type ConsequenceRow } from "./cancel-table";
import { periodPriceAed, type BillingTerm } from "./period";
import { FILS_PER_AED, VAT_RATE, vatOn } from "./proration";
import { pendingChangeFor, type PendingChange } from "./schedule";
import { seatsUsed } from "./summary";
import { billingRecipient } from "./tax-invoice";
import type { Usage } from "./plan-grid";

/**
 * Boards 11h + 11j — cancelling, in two steps and one read.
 *
 * ## The rule this runs on
 *
 * **Nothing is taken away on the day the seller cancels.** The period that was
 * paid for runs to its end and is neither refunded nor shortened; Free starts
 * the morning after. Every consequence on both screens is dated, and every date
 * derives from one value — `freeStartsOn`, which is the subscription's renewal
 * moment. There is no second date to keep in step, which is criterion 1.
 *
 * ## Why the cancellation is a `subscription_change` row
 *
 * Because that is what it is. Same effective date, same withdraw-before-then,
 * and the same *which ten products stay live* choice a downgrade already
 * carries in `keepProductIds`. Board 11h's spec is explicit that the picker is
 * reused rather than rebuilt — *"no new platform dependency, which is the point
 * of scheduling the choice instead of building a second picker"* — and reusing
 * the picker means reusing the row it writes into.
 *
 * `Subscription.cancelledAt` / `endsAt` stay where they are: the renewal job,
 * dunning and the revenue waterfall all read them. The change row carries the
 * two things that had nowhere to live at all — the seller's choice, and their
 * reason.
 *
 * The pair is written and cleared in one transaction, both times. An `endsAt`
 * with no change row is a period end nothing acts on; a change row with no
 * `endsAt` is a subscription that renews while a cancellation is pending.
 */

/**
 * The six on board 11j, in the order they are asked.
 *
 * Required — criterion 6, and the wave 4 decision behind it: this is the only
 * churn signal the product gets, and a cancellation flow that does not ask is
 * one that learns nothing. The optional free-text box never blocks confirming.
 */
export const CANCEL_REASONS = [
  "too_expensive",
  "not_enough_enquiries",
  "poor_quality_enquiries",
  "another_platform",
  "business_closing",
  "something_else",
] as const;

export type CancelReasonValue = (typeof CANCEL_REASONS)[number];

/**
 * The reason that is a fork rather than a reason.
 *
 * Choosing it cancels **nothing**. Cancelling leaves the listing in the
 * directory on Free; closing removes it altogether, and that is board `11i`,
 * which is not drawn and is blocked. Criterion 7 is the assertion that this
 * distinction is real in the code and not only in the copy.
 */
export const CLOSING_REASON: CancelReasonValue = "business_closing";

/** The one reason whose free-text box stops being optional. */
export const REASON_NEEDING_A_NOTE: CancelReasonValue = "something_else";

export function isCancelReason(value: string): value is CancelReasonValue {
  return (CANCEL_REASONS as readonly string[]).includes(value);
}

/** How long a note may be. Long enough for a paragraph, short of an essay. */
export const MAX_NOTE_LENGTH = 1000;

export interface CancellationView {
  planName: string;
  term: BillingTerm;
  /** The renewal moment. Free starts here and the next invoice would fall due here. */
  freeStartsOn: Date;
  /** The last day of the period already paid for. Derived, never stored. */
  paidTo: Date;
  rows: ConsequenceRow[];
  /** The seller's own count from last calendar month, for the evidence panel. */
  enquiriesLastMonth: number;
  /** What Free allows a month. Null where Free is unlimited, which it is not. */
  freeEnquiriesPerMonth: number | null;
  /** What the next invoice would have been, incl. VAT. Reconciles with `3m`. */
  nextInvoiceFils: number;
  /** Where the confirmation goes — `7e`'s setting, then finance, then owner. */
  billingEmail: string | null;
  /** Set once a cancellation is scheduled. Both routes then stop being reachable. */
  scheduled: PendingChange | null;
  /** True where Free holds everything the seller has, so nothing is reduced. */
  nothingReduced: boolean;
}

/**
 * What the two cancel routes get back. Board 11c's follow-up audit.
 *
 * `cancellationView` returned `CancellationView | null` and the routes 404'd on
 * the null, which was right for a seller already on Free and wrong for one on a
 * **trial**: they reached the page from the Cancel card on `3m` and met a
 * not-found. Worse, `scheduleCancellation` accepted them — its guards excluded
 * only `cancelled` and `expired` — and wrote `status: "active"`, which took the
 * subscription out of `expireTrials`, started counting it in `mrrNow` for money
 * nobody had paid, and then booked a full-value churn movement at trial end.
 *
 * A trial already ends by itself into `expired` and drops to Free. So
 * cancelling one is asking for exactly what is going to happen, and the honest
 * answer is a sentence rather than a state change.
 */
export type CancellationOutcome =
  | ({ kind: "cancellable" } & CancellationView)
  | { kind: "trial"; planName: string; trialEndsOn: Date };

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true, serviceLimit: true,
  locationLimit: true, photoLimit: true, publicPhotoLimit: true, categoryLimit: true, storageMb: true, teamSeats: true,
  rankingMultiplier: true, customDomain: true, analytics: true, csvImport: true,
  sponsoredEligible: true, sortOrder: true, annualMonthsCharged: true,
} as const;

type PlanRow = {
  monthlyPriceAed: Prisma.Decimal | number;
  rankingMultiplier: Prisma.Decimal | number;
} & Omit<PlanCaps, "monthlyPriceAed" | "rankingMultiplier">;

function toCaps(row: PlanRow): PlanCaps {
  return {
    ...row,
    monthlyPriceAed: Number(row.monthlyPriceAed),
    rankingMultiplier: Number(row.rankingMultiplier),
  };
}

/**
 * Everything both screens render, in one read.
 *
 * Returns null where there is nothing to cancel — a seller already on Free, or
 * one whose cancellation has already landed. Both routes 404 on it, which is
 * criterion 9's second half and criterion 10. A **trial** comes back as its own
 * outcome rather than as a null: there is something to say, and a 404 to a
 * seller who clicked Cancel on `3m` says none of it.
 *
 * Owner only. The permission matrix gives *Change plan or cancel* to the owner
 * and to nobody else, and `11f` fences the same capability the same way — the
 * spec's data table says "Owner and Billing roles", which is the matrix's
 * *See invoices & billing* row rather than this one. A finance seat reads the
 * invoices; it does not decide what the business buys.
 */
export async function cancellationView(
  actor: Actor,
  businessId: string,
  now = new Date(),
): Promise<CancellationOutcome | null> {
  assertCanChangePlan(actor);
  if (actor.businessId !== businessId) return null;

  const since = monthStart(now);
  const lastMonthStart = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth() - 1, 1));

  const [
    business,
    freePlan,
    products,
    locations,
    photos,
    categories,
    seats,
    storageBytes,
    enquiries,
    importRun,
    placement,
    pending,
    recipient,
  ] =
    await Promise.all([
      prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: {
          slug: true,
          verificationTier: true,
          reviewCount: true,
          plan: { select: PLAN_SELECT },
          customDomain: { select: { hostname: true, verifiedAt: true } },
          subscription: {
            select: {
              term: true,
              status: true,
              trialEndsAt: true,
              renewsAt: true,
              cancelledAt: true,
              endsAt: true,
              entitlementSnapshot: true,
            },
          },
        },
      }),
      prisma.plan.findUnique({ where: { id: "free" }, select: PLAN_SELECT }),
      prisma.product.count({ where: { businessId, status: "live" } }),
      prisma.location.count({ where: { businessId, published: true } }),
      // The two the grid gained in D1. Counted here too so the cancellation
      // table and the change table are measuring the same seller.
      prisma.media.count({ where: { businessId, kind: "gallery" } }),
      prisma.businessCategory.count({ where: { businessId } }),
      seatsUsed(businessId, now),
      /*
         Through the one definition, not a fourth reading of the table.

         This aggregated *all* media — buyers' review photographs included — and
         no documents, while `storageUsedBytes` refused an upload on a different
         set. So the meter a seller read was not the number that stopped them.
      */
      storageUsedBytes(businessId),
      /*
         Last *calendar* month, not the last thirty days.

         The Free allowance resets on the first, so the comparison the panel
         makes — 86 against 3 — is only a comparison if both sides are measured
         over the same kind of month. A rolling window against a calendar cap is
         two different questions with one answer printed between them.
      */
      prisma.enquiryRecipient.count({
        where: { businessId, createdAt: { gte: lastMonthStart, lt: since } },
      }),
      prisma.importRun.findFirst({
        where: { businessId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      prisma.placementSlot.findFirst({
        where: { businessId, OR: [{ endsOn: null }, { endsOn: { gte: now } }] },
        orderBy: { startsOn: "asc" },
        select: { endsOn: true, emirate: true, category: { select: { name: true } } },
      }),
      pendingChangeFor(businessId),
      billingRecipient(businessId),
    ]);

  const subscription = business.subscription;
  /*
     Nothing to cancel, three ways.

     No subscription row at all is the ordinary Free account. A `cancelled` or
     `expired` one has already ended. And a subscription still sitting on a plan
     that costs nothing is the third — board 11h's `Already on Free` state,
     which redirects rather than rendering a table whose two columns would be
     identical. It also stops the flow writing a change row from Free to Free,
     which `subscription_change_moves` refuses: a change that goes nowhere is a
     row nothing should have written.
  */
  if (!subscription || !business.plan) return null;
  if (subscription.status === "cancelled" || subscription.status === "expired") return null;
  if (Number(business.plan.monthlyPriceAed) === 0) return null;
  if (!freePlan) return null;

  /*
     A trial is not a subscription to cancel.

     `expireTrials` ends it into `expired` and drops the business to Free on its
     own date, and writes no churn movement because nobody paid. Letting the
     cancel flow through instead wrote `status: "active"` over the trial — which
     took it out of that sweep, started counting it as recurring revenue in
     `mrrNow`, and then booked a churn at the full monthly value the trial had
     never generated.

     So the routes render a sentence and write nothing. Same shape as the
     already-on-Free case above; the difference is that this one has something
     worth saying, so it is a state rather than a 404.
  */
  if (subscription.status === "trialing" && subscription.trialEndsAt) {
    return {
      kind: "trial",
      planName: business.plan.name,
      trialEndsOn: subscription.trialEndsAt,
    };
  }

  const plan = effectiveCaps(toCaps(business.plan), subscription.entitlementSnapshot);
  const free = toCaps(freePlan);

  const usage: Usage = {
    products,
    locations,
    photos,
    categories,
    seats,
    storageMb: Math.ceil(storageBytes / (1024 * 1024)),
  };

  const facts: CancelFacts = {
    plan,
    free,
    usage,
    freeStartsOn: subscription.renewsAt,
    enquiriesLastMonth: enquiries,
    // The badge follows the licence, and `3e` owns the ladder. Tier 2 is the
    // top achievable one; anything at or above it is "Licence verified".
    verified: business.verificationTier >= 2,
    reviewCount: business.reviewCount,
    domain: business.customDomain?.verifiedAt ? business.customDomain.hostname : null,
    /*
       The address the storefront stays reachable at, written as a person reads
       it — `businesslistings.ae/b/al-waha`, no scheme.

       Never omitted. A custom domain that stops resolving with no replacement
       named breaks every printed card and every earned backlink silently, and
       the seller cannot set up a redirect to somewhere they were not told about.
    */
    storefrontUrl: `${siteUrl().replace(/^https?:\/\//, "")}/b/${business.slug}`,
    csvImportLastUsedAt: importRun?.createdAt ?? null,
    placement: placement
      ? { label: t("cancel.now.sponsored", { what: placement.category.name }), endsOn: placement.endsOn }
      : null,
  };

  const rows = consequenceTable(facts);

  return {
    kind: "cancellable",
    planName: business.plan.name,
    term: subscription.term,
    freeStartsOn: subscription.renewsAt,
    paidTo: lastPaidDay(subscription.renewsAt),
    rows,
    enquiriesLastMonth: enquiries,
    freeEnquiriesPerMonth: free.enquiriesPerMonth,
    nextInvoiceFils: nextInvoiceFils(plan, subscription.term, business.plan.annualMonthsCharged),
    billingEmail: recipient,
    scheduled: pending?.kind === "cancellation" ? pending : null,
    nothingReduced: rows.every((row) => row.mark === "unchanged"),
  };
}

/**
 * What the next invoice would have been, incl. VAT — `AED 313.95`.
 *
 * The same arithmetic `3m`'s `THIS PERIOD` panel does, and it has to reconcile
 * with it: two screens naming one figure differently is the defect the whole
 * `3m`/`11f` pair was drawn to fix. Subscription only — a placement runs to its
 * own term under its own booking and is stated as its own row, which is Q1.
 */
function nextInvoiceFils(
  plan: PlanCaps,
  term: BillingTerm,
  annualMonthsCharged: number | null,
): number {
  const net = Math.round(periodPriceAed({ ...plan, annualMonthsCharged }, term) * FILS_PER_AED);
  return net + vatOn(net, VAT_RATE);
}

export interface CancelInput {
  reason: CancelReasonValue;
  /** Required under `something_else`, optional and never blocking elsewhere. */
  note?: string | null;
}

export type ScheduleCancelResult =
  | { ok: true; freeStartsOn: Date; paidTo: Date; emailedTo: string | null }
  | {
      ok: false;
      error:
        | "no_subscription"
        | "already_cancelling"
        | "bad_reason"
        | "note_required"
        | "closing_is_not_a_cancellation"
        /** A trial ends by itself. See the guard, and `expireTrials`. */
        | "on_trial";
    };

/**
 * Schedule the cancellation. Board 11j's confirm.
 *
 * Writes three things together, or none of them: the pair on `Subscription`
 * that every other billing path reads, the change row that carries the reason
 * and will carry the seller's picks, and the withdrawal of any downgrade that
 * was already pending.
 *
 * ## A pending downgrade is withdrawn, not left beside this
 *
 * There is one pending row per business — a partial unique index, board 11f
 * Q8 — and the arithmetic depends on it: a second pending change would have to
 * know whether the first had landed to know what it was changing from. A seller
 * who scheduled a move to Basic and then cancelled has not asked for both on the
 * same date, and the cancellation is the later intention.
 *
 * ## The closing reason cancels nothing
 *
 * Criterion 7. `business_closing` is the fork to `11i` and is refused here
 * rather than handled, so no path through this function can cancel a
 * subscription on the strength of it — a screen bug would otherwise cancel and
 * *then* offer the fork.
 */
export async function scheduleCancellation(
  actor: Actor,
  businessId: string,
  input: CancelInput,
  now = new Date(),
): Promise<ScheduleCancelResult> {
  assertCanChangePlan(actor);
  if (actor.businessId !== businessId) return { ok: false, error: "no_subscription" };

  if (!isCancelReason(input.reason)) return { ok: false, error: "bad_reason" };
  if (input.reason === CLOSING_REASON) {
    return { ok: false, error: "closing_is_not_a_cancellation" };
  }

  const note = input.note?.trim().slice(0, MAX_NOTE_LENGTH) || null;
  // `Something else` is then the only place the reason exists, and the option
  // says so inline rather than letting the seller discover it on submit.
  if (input.reason === REASON_NEEDING_A_NOTE && !note) {
    return { ok: false, error: "note_required" };
  }

  const subscription = await prisma.subscription.findUnique({
    where: { businessId },
    select: {
      planId: true,
      term: true,
      renewsAt: true,
      cancelledAt: true,
      status: true,
      plan: { select: { monthlyPriceAed: true } },
    },
  });
  if (!subscription) return { ok: false, error: "no_subscription" };
  if (subscription.status === "cancelled" || subscription.status === "expired") {
    return { ok: false, error: "no_subscription" };
  }
  /*
     A trial, refused here and not only on the screen.

     `cancellationView` renders the sentence; this is the half that matters,
     because the screen is not what protects the record. Writing a cancellation
     over a trial set `status: "active"` — the subscription left `expireTrials`,
     entered `mrrNow` as recurring revenue nobody had paid, and a churn movement
     at the full monthly value followed at trial end. Three wrong numbers on the
     revenue board from one seller pressing a button.
  */
  if (subscription.status === "trialing") {
    return { ok: false, error: "on_trial" };
  }
  // A subscription on a plan that costs nothing has nothing to cancel, and the
  // change row it would write goes from Free to Free — which the
  // `subscription_change_moves` constraint refuses, correctly.
  if (Number(subscription.plan.monthlyPriceAed) === 0) {
    return { ok: false, error: "no_subscription" };
  }
  if (subscription.cancelledAt) return { ok: false, error: "already_cancelling" };

  const freeStartsOn = subscription.renewsAt;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.subscriptionChange.updateMany({
        where: { businessId, appliedAt: null, withdrawnAt: null },
        data: { withdrawnAt: now },
      });

      await tx.subscription.update({
        where: { businessId },
        data: {
          cancelledAt: now,
          // Paired by a check constraint: a cancellation that does not say when
          // it ends is one nothing can act on.
          endsAt: freeStartsOn,
          status: "active",
        },
      });

      await tx.subscriptionChange.create({
        data: {
          businessId,
          kind: "cancellation",
          fromPlanId: subscription.planId,
          toPlanId: "free",
          fromTerm: subscription.term,
          toTerm: subscription.term,
          effectiveAt: freeStartsOn,
          cancelReason: input.reason as CancelReason,
          cancelNote: note,
          requestedById: actor.id,
        },
      });
    });
  } catch (error) {
    /*
       The index is what enforces one pending row, not the read above. Two
       requests a millisecond apart both find nothing pending and both insert.
    */
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: "already_cancelling" };
    }
    throw error;
  }

  /*
     The confirmation, after the transaction rather than inside it.

     A carrier being slow must not hold a write transaction open, and a carrier
     being down must not roll back a cancellation the seller has confirmed. The
     screen names the address before the decision — *"a confirmation email to
     accounts@alwaha.ae"* — so the send is part of the promise, but it is not
     part of the record.
  */
  const emailedTo = await sendCancellationEmail(businessId, freeStartsOn);

  return { ok: true, freeStartsOn, paidTo: lastPaidDay(freeStartsOn), emailedTo };
}

/**
 * The confirmation email, to `7e`'s billing address.
 *
 * Direct rather than through `notify()`, and that is the board's choice: the
 * screen states an *address* before the seller confirms, and the notification
 * matrix routes to a seat's verified channels rather than to a stated address.
 * A supplier who has given the card to a bookkeeper has already told us where
 * billing mail goes by setting it — `billingRecipient` is 7e's setting, then
 * the finance seat, then the owner.
 *
 * Returns the address it reached, or null. A missing sender is not a silent
 * success: `emailInvoice` refuses the same way, and a staging environment that
 * reports delivery is how somebody comes to believe the mail works.
 */
async function sendCancellationEmail(businessId: string, freeStartsOn: Date): Promise<string | null> {
  const address = await billingRecipient(businessId);
  const sender = resolveNotificationSenders().email;
  if (!address || !sender) return null;

  try {
    const result = await sender.send({
      channel: "email",
      to: address,
      subject: t("cancel.email.subject"),
      body: t("cancel.email.body", {
        paidTo: formatDate(lastPaidDay(freeStartsOn)),
        freeFrom: formatDate(freeStartsOn),
      }),
      actionLabel: t("cancel.email.action"),
      actionUrl: absoluteUrl("/dashboard/billing"),
      businessId,
    });
    return result.delivered ? address : null;
  } catch (error) {
    // The cancellation is committed. A carrier that threw does not un-schedule
    // it, and the banner on `3m` is the record the seller actually acts from.
    console.error(`[billing] cancellation email for ${businessId} failed`, error);
    return null;
  }
}

/** The pending cancellation, if there is one. Null for a pending plan change. */
export async function pendingCancellationFor(businessId: string): Promise<PendingChange | null> {
  const pending = await pendingChangeFor(businessId);
  return pending?.kind === "cancellation" ? pending : null;
}
