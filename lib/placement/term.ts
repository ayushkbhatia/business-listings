import "server-only";
import type { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { daysRemaining, lineFils } from "@/lib/billing/proration";
import { periodPriceAed } from "@/lib/billing/period";
import type { BillingTerm } from "@/lib/db/generated/enums";
import { issueInvoice } from "@/lib/billing/invoice";
import { t } from "@/lib/i18n";

/**
 * A sponsored slot belongs to the subscription that bought it. Decision D2.
 *
 * Settled 9 Sep 2026 against the alternative — a placement running its own term
 * regardless of what happens to the account under it. Three things decided it,
 * and all three are in the tree rather than in an opinion:
 *
 *   - `sponsoredEligible` is a plan column with an admin editor, a row on the
 *     plan comparison grid and a promise in onboarding copy. The other answer
 *     means deleting it from four shipped screens.
 *   - The buyer has already been told "Pro subscribers appear in the top slot".
 *   - A placement with its own term has to be billable on its own, and
 *     `lib/billing/provider.ts` has no live gateway. That answer cannot be
 *     finished; this one can.
 *
 * ## Why one function and not three
 *
 * A slot ends for three reasons — the subscription was cancelled, it was
 * downgraded off eligibility, or it lapsed through dunning — and all three ran
 * in different files. Three enders is three chances for one of them to forget
 * the waitlist, or the credit, or to leave a Free account holding the top of a
 * category. This codebase already has a scar from a second path that kept none
 * of the first one's promises.
 *
 * ## What ending a slot actually owes
 *
 * Three things, in this order:
 *
 *   1. The slot stops. `endsOn` moves to now rather than the row being deleted,
 *      so `4g` can still report what was sold and for how long.
 *   2. The unused part of what they paid comes back, where they paid. See
 *      `creditUnusedPlacement` — and note that on any account whose placement
 *      was never billed there is nothing to return, which is the honest answer
 *      rather than a missing one.
 *   3. The next business in the queue is told the same day.
 */

/**
 * The term a slot is sold in before any renewal has touched it.
 *
 * `takeSlot` writes `endsOn` from this — and for months it wrote the same
 * arithmetic as a literal instead, so the constant documented a caller it did
 * not have.
 *
 * **It is not the period a placement is billed over.** Since D2 the slot belongs
 * to the subscription: the first renewal after a purchase moves `endsOn` to the
 * subscription's own renewal date and charges the placement for that whole
 * period. On an annual account that period is a year. Anything dividing a
 * placement's value by this constant after that point is dividing a year by
 * thirty days — see `unusedPlacementFils`.
 */
export const SLOT_TERM_DAYS = 30;

export type PlacementEndReason = "cancelled" | "downgraded" | "lapsed";

export interface EndedPlacement {
  slotId: string;
  categoryId: string;
  /** Null is the national slot. */
  emirate: string | null;
  /** Days the seller had left and will not get. */
  unusedDays: number;
  /** What those days were worth, at what this slot actually cost. */
  unusedFils: number;
  monthlyPriceAed: number;
  /**
   * Start of the period this placement was charged for, where one exists.
   *
   * Carried so the credit can look for the invoice that charged for **this**
   * period rather than the most recent one holding a placement line of any age.
   */
  billedFrom: Date | null;
  /** Who is now first in the queue for this scope, or null where nobody is. */
  nextInQueue: string | null;
  /** Why it ended, carried so a caller can report it rather than infer it. */
  reason: PlacementEndReason;
}

/**
 * The period a placement was actually charged for, and how long it ran.
 *
 * Both halves come from the subscription, because since D2 that is what a slot
 * is billed against: `runRenewals` prices a placement through `periodPriceAed`
 * — the same helper the plan uses, so an annual account gets the annual
 * treatment — and then moves `endsOn` to the subscription's next renewal date.
 */
export interface BilledPeriod {
  /** What this placement cost for the whole period, in AED. */
  periodAed: number;
  /** How many days that charge bought. */
  periodDays: number;
}

/**
 * What a placement was billed for, derived from the subscription behind it.
 *
 * Falls back to a thirty-day term at the monthly price when there is no
 * subscription period to read — a slot bought mid-period that no renewal has
 * reached yet. Nothing has been charged for such a slot, so `creditUnusedPlacement`
 * will find no source invoice and credit nothing; the fallback exists so the
 * arithmetic is defined rather than because that number is ever paid out.
 */
export function billedPeriodFor(
  monthlyPriceAed: number,
  subscription: {
    term: BillingTerm;
    periodStartedAt: Date;
    renewsAt: Date;
    plan: { annualMonthsCharged: number | null };
  } | null,
): BilledPeriod {
  if (!subscription) return { periodAed: monthlyPriceAed, periodDays: SLOT_TERM_DAYS };

  const periodDays = daysRemaining(subscription.periodStartedAt, subscription.renewsAt);
  // An annual term on a plan sold only monthly has no annual price; rather than
  // letting `periodPriceAed` throw inside a cancellation, fall back.
  if (periodDays <= 0) return { periodAed: monthlyPriceAed, periodDays: SLOT_TERM_DAYS };
  if (subscription.term === "annual" && subscription.plan.annualMonthsCharged === null) {
    return { periodAed: monthlyPriceAed, periodDays: SLOT_TERM_DAYS };
  }

  return {
    periodAed: periodPriceAed(
      {
        monthlyPriceAed,
        annualMonthsCharged: subscription.plan.annualMonthsCharged,
      },
      subscription.term,
    ),
    periodDays,
  };
}

/**
 * What a seller is owed for a slot that ends early.
 *
 * Pure, and separate from the write, because the arithmetic is the part worth
 * testing and the part a seller will argue with. `lineFils` is the same helper
 * a plan proration uses and rounds half-up for the same reason: agreeing with
 * the document the seller keeps beats being right about half a fil.
 *
 * ## Why this takes a period rather than a monthly price
 *
 * It used to be `lineFils(monthlyPriceAed, SLOT_TERM_DAYS, days)` — the monthly
 * price over a fixed thirty days — and `endsOn` stopped meaning "thirty days
 * from purchase" the moment D2 landed. `runRenewals` sets `endsOn` to the
 * subscription's next renewal and charges the placement for that whole period.
 *
 * On an annual account that is a year. A seller on a ten-month year paid
 * 450 x 10 = 4,500 AED for 365 days of placement, cancelled the next day, and
 * was credited 450 x 365/30 = 5,475 AED — **975 AED more than they were ever
 * charged**, issued as a real credit note correcting a real tax invoice. And on
 * a monthly term the denominator was wrong in every month that is not exactly
 * thirty days: 31 days of a 450 AED month credited 465.
 *
 * The rule now is the one the charge already follows — what it cost for the
 * period, times the share of that period they will not get.
 */
export function unusedPlacementFils(
  period: BilledPeriod,
  endsOn: Date | null,
  now: Date,
): { days: number; fils: number } {
  if (!endsOn) return { days: 0, fils: 0 };
  const days = daysRemaining(now, endsOn);
  /*
     Never more than the whole period.

     `endsOn` and the period are written by the same renewal, so `days` cannot
     normally exceed `periodDays` — but they are two columns and a support fix
     to one of them would otherwise be able to credit more than was ever taken.
     A credit note larger than its invoice is the one outcome this function must
     not be able to produce.
  */
  const billable = Math.min(days, period.periodDays);
  return { days, fils: lineFils(period.periodAed, period.periodDays, billable) };
}

/**
 * End every slot this business holds, whatever emirate it is scoped to.
 *
 * Not `emirate: null`. `slotsFor` and `takeSlot` only ever look at the national
 * slot, which is a limitation of the buying screen — but a seller who somehow
 * holds an emirate-scoped slot must not keep it because the ender inherited the
 * buying screen's blind spot. The seed carries exactly such a slot, so this is
 * a case that exists rather than one being defended against.
 */
export async function endPlacementsFor(
  tx: Prisma.TransactionClient,
  businessId: string,
  now: Date,
  reason: PlacementEndReason,
): Promise<EndedPlacement[]> {
  const live = await tx.placementSlot.findMany({
    where: {
      businessId,
      startsOn: { lte: now },
      OR: [{ endsOn: null }, { endsOn: { gt: now } }],
    },
    select: { id: true, categoryId: true, emirate: true, endsOn: true, monthlyPriceAed: true },
  });
  if (live.length === 0) return [];

  /*
     The subscription the slots are billed against — read once, not per slot.

     This is what makes the credit agree with the charge. `runRenewals` prices a
     placement over the subscription's period and moves `endsOn` to match, so the
     period it was sold in is a property of the subscription and not of the slot
     row, and nothing on `placement_slot` records it.
  */
  const subscription = await tx.subscription.findUnique({
    where: { businessId },
    select: {
      term: true,
      periodStartedAt: true,
      renewsAt: true,
      plan: { select: { annualMonthsCharged: true } },
    },
  });

  const ended: EndedPlacement[] = [];

  for (const slot of live) {
    await tx.placementSlot.update({
      where: { id: slot.id },
      data: { endsOn: now },
    });

    const period = billedPeriodFor(Number(slot.monthlyPriceAed), subscription);
    const unused = unusedPlacementFils(period, slot.endsOn, now);

    /*
       The next in line, told the day it frees.

       `notifiedAt` has been a column with no writer since the model was drawn.
       Written here rather than left for a sweep, because the whole value of a
       queue is that the person at the front hears about it before the slot is
       stale — and there is no sweep to add it to now that the hourly one has
       lost its only placement step.

       In-product rather than a message, deliberately. A new `NotificationEvent`
       needs a live `NotificationTemplate` to render, and templates are database
       rows that a commit cannot create in production — `ramadan_dates_moved`
       fires nightly against no template and writes a silent skipped delivery
       for exactly that reason. `/dashboard/promote` reads `notifiedAt` and says
       so on the screen. The outbound message is owed once `12g` can author a
       template without a seed run.
    */
    const next = await tx.placementWaitlist.findFirst({
      where: { categoryId: slot.categoryId, emirate: slot.emirate, notifiedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, businessId: true },
    });
    if (next) {
      await tx.placementWaitlist.update({
        where: { id: next.id },
        data: { notifiedAt: now },
      });
    }

    ended.push({
      slotId: slot.id,
      categoryId: slot.categoryId,
      emirate: slot.emirate,
      unusedDays: unused.days,
      unusedFils: unused.fils,
      monthlyPriceAed: Number(slot.monthlyPriceAed),
      billedFrom: subscription?.periodStartedAt ?? null,
      nextInQueue: next?.businessId ?? null,
      reason,
    });
  }

  return ended;
}

/**
 * Give back the unused part of a placement that was actually charged for.
 *
 * Runs outside the ender's transaction and after it, because issuing a credit
 * note is a document with its own reference sequence and a failure to write one
 * must not roll back the subscription change that caused it. A seller whose
 * slot ended and whose credit did not issue is a support ticket; a cancellation
 * that silently un-cancelled itself is a billing incident.
 *
 * **Nothing is credited where nothing was charged.** Placement has never been
 * billed — `runRenewals` writes the line as of this change and no invoice
 * before it carries one — so on most accounts this finds no source invoice and
 * returns zero. That is the truthful answer: crediting money that was never
 * taken would put a negative number on a seller's account for a period they
 * paid nothing for.
 */
export async function creditUnusedPlacement(
  ended: readonly EndedPlacement[],
  businessId: string,
  now: Date,
): Promise<{ credited: number; fils: number }> {
  let credited = 0;
  let fils = 0;

  for (const slot of ended) {
    if (slot.unusedFils <= 0) continue;

    /*
       The invoice that charged for this placement, if one did.

       Matched on the line rather than on the subscription, because that is the
       question being asked: was this seller charged for a placement in a period
       that has not finished. An invoice with no placement line is not a source
       for a placement credit however recent it is.
    */
    const source = await prisma.invoice.findFirst({
      where: {
        businessId,
        docType: "tax_invoice",
        status: { notIn: ["draft", "void"] },
        lines: { some: { kind: "placement" } },
        /*
           Issued in the period that has not finished — which is what the
           paragraph above has always claimed and what the query did not check.

           Without it the most recent placement invoice qualified however old it
           was, so a seller whose placement was billed a year ago, ran its full
           term and was bought again mid-period could have a fresh credit note
           raised against a document from a closed period. On an annual account
           that invoice is a year old.
        */
        ...(slot.billedFrom ? { issuedAt: { gte: slot.billedFrom } } : {}),
      },
      orderBy: { issuedAt: "desc" },
      select: { id: true, vatRate: true },
    });
    if (!source) continue;

    await issueInvoice({
      businessId,
      docType: "credit_note",
      correctsId: source.id,
      issuedAt: now,
      vatRate: Number(source.vatRate),
      lines: [
        {
          kind: "subscription_credit",
          description: t("placement.credit_line", { days: String(slot.unusedDays) }),
          fils: -slot.unusedFils,
        },
      ],
    });

    credited += 1;
    fils += slot.unusedFils;
  }

  return { credited, fils };
}
