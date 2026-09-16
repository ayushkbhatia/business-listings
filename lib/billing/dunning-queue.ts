import "server-only";
import { prisma } from "@/lib/db/client";
import { FILS_PER_AED, vatOn } from "./proration";
import { priceForPeriod } from "./pricing";
import { paymentProvider } from "./provider";
import {
  daysPastDue,
  dropsToFreeAt,
  nextAction,
  type DunningAction,
  type DunningStage,
} from "./dunning";

/**
 * The failed-payments queue, read.
 *
 * The screen shows what the sequence will do next rather than only where each
 * account is, because "emailed" answers a question nobody asked — the question
 * is what happens tomorrow, and to whom.
 *
 * ## The amount is VAT-inclusive, and says so
 *
 * Board 12e `B3`: plan prices are stored and quoted **ex-VAT**, VAT 5% is
 * always its own line, and every total carries `incl. VAT`. A failed payment is
 * a total — it is what the card was asked for and refused — so it is the one
 * figure on these two screens where an inclusive number belongs, and the column
 * head names it rather than leaving the reader to work out which of the two
 * conventions this column follows.
 */

export interface DunningRow {
  subscriptionId: string;
  businessId: string;
  businessName: string;
  slug: string;
  planId: string;
  planName: string;
  stage: DunningStage;
  daysPastDue: number;
  next: DunningAction;
  attempts: number;
  /** What the provider said, where it said anything. `Card expired`. */
  lastAttemptFailed: string | null;
  /**
   * What the card was asked for, in fils, VAT included.
   *
   * From the failed attempt where there is one, not from the plan. A dropped
   * account is on Free by the time anybody reads this row — that is what the
   * sequence does — so deriving the figure from the plan would print `AED 0.00`
   * against the payment that failed. Falling back to the plan covers the case
   * with no attempt at all, which is every row while no gateway is configured.
   */
  amountFils: number;
  /**
   * When this account's plan changes to Free. Null once it already has.
   *
   * Never "suspends" — see `dropsToFreeAt`. A drop is a plan change and nothing
   * else: the listing stays live, the catalogue stays visible, and the badge
   * stays, because it records what we checked and a card expiring does not
   * unverify a trade licence.
   */
  dropsToFreeAt: Date | null;
}

export interface DunningQueue {
  rows: DunningRow[];
  /** False when no gateway is configured, so the screen can say so. */
  gatewayLive: boolean;
}

const QUEUE_SELECT = {
  id: true,
  businessId: true,
  planId: true,
  term: true,
  dunningStage: true,
  pastDueSince: true,
  business: { select: { displayName: true, slug: true } },
  plan: { select: { name: true, monthlyPriceAed: true, annualMonthsCharged: true } },
  /*
     One `orderBy` key, not two.

     `QUEUE_SELECT` is `as const`, so an array of keys here becomes a readonly
     tuple that Prisma's `include` types reject — and the rejection is silent:
     the relation drops out of the inferred row type and `subscription.attempts`
     stops existing, twenty lines further down. There is no `take` on this read,
     so it is not one `check:ordering` governs; the order only picks which
     message the row shows.
  */
  attempts: {
    orderBy: { attemptedAt: "desc" },
    select: { succeeded: true, providerMessage: true, amountFils: true },
  },
} as const;

/** Past due, or somewhere in the sequence. */
const IN_SEQUENCE = { OR: [{ status: "past_due" as const }, { dunningStage: { not: "none" as const } }] };

export async function dunningQueue(now = new Date()): Promise<DunningQueue> {
  const subscriptions = await prisma.subscription.findMany({
    where: IN_SEQUENCE,
    orderBy: [{ pastDueSince: "asc" }, { id: "asc" }],
    select: QUEUE_SELECT,
  });

  return {
    gatewayLive: paymentProvider().live,
    rows: subscriptions.map((subscription) => {
      const since = subscription.pastDueSince;
      const stage = subscription.dunningStage as DunningStage;
      const failed = subscription.attempts.find((attempt) => !attempt.succeeded);
      return {
        subscriptionId: subscription.id,
        businessId: subscription.businessId,
        businessName: subscription.business.displayName,
        slug: subscription.business.slug,
        planId: subscription.planId,
        planName: subscription.plan.name,
        stage,
        daysPastDue: since ? daysPastDue(since, now) : 0,
        // A row with no start date has not begun; the sequence would start it
        // on the next run, and saying "nothing due" would be wrong.
        next: since ? nextAction(stage, since, now) : { kind: "retry_silently", stage: "retry" },
        attempts: subscription.attempts.length,
        lastAttemptFailed: failed?.providerMessage ?? null,
        amountFils: failed?.amountFils ?? chargeFils(subscription),
        dropsToFreeAt: since && stage !== "dropped" ? dropsToFreeAt(since) : null,
      };
    }),
  };
}

/** What one past-due subscription owes, in fils, VAT included. */
function chargeFils(subscription: {
  term: "monthly" | "annual";
  plan: { monthlyPriceAed: unknown; annualMonthsCharged: number | null };
}): number {
  const net =
    priceForPeriod(
      {
        monthlyPriceAed: Number(subscription.plan.monthlyPriceAed),
        annualMonthsCharged: subscription.plan.annualMonthsCharged,
      },
      subscription.term === "annual" ? "annual" : "monthly",
    ) ?? 0;
  const netFils = Math.round(net * FILS_PER_AED);
  return netFils + vatOn(netFils);
}

export interface DunningSummary {
  /** Subscriptions somewhere in the sequence, including the ones that dropped. */
  count: number;
  /** Still recoverable: past due and not yet dropped to Free. */
  inSequence: number;
  /**
   * What is still at risk, in fils, VAT included.
   *
   * Only the rows that have not dropped. An account already on Free has
   * finished the sequence — there is nothing left to lose on it, and counting
   * its failed payment as "at risk" would make the figure a running total of
   * everything that ever failed rather than what a call today could recover.
   */
  atRiskFils: number;
  /** How many drop to Free inside the next seven days. */
  droppingSoon: number;
}

/**
 * The count and the money, for the card on `/admin/plans`.
 *
 * Board 12e Q1, answered as the spec recommends: *"this panel becomes a count
 * and a link to `/admin/dunning`. `12i` owns the list and `12j` owns the
 * actions; a third copy on the plan-config screen will drift again."* The board
 * drew a third table of the same failed payments — 64 over three businesses
 * against `12i`'s 12 over four different ones — and two counts with no shared
 * row set is how a directory stops being believed.
 *
 * So there is one query and one list. This returns what a summary card may
 * honestly say without restating it.
 */
export async function dunningSummary(now = new Date()): Promise<DunningSummary> {
  const queue = await dunningQueue(now);
  const soon = new Date(now.getTime() + 7 * 86_400_000);
  const live = queue.rows.filter((row) => row.stage !== "dropped");
  return {
    count: queue.rows.length,
    inSequence: live.length,
    atRiskFils: live.reduce((total, row) => total + row.amountFils, 0),
    droppingSoon: queue.rows.filter((row) => row.dropsToFreeAt !== null && row.dropsToFreeAt <= soon)
      .length,
  };
}
