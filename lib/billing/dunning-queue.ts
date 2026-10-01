import "server-only";
import { prisma } from "@/lib/db/client";
import { paymentProvider } from "./provider";
import { priceRenewal, RENEWAL_SELECT } from "./renewal-job";
import {
  daysPastDue,
  dropsToFreeAt,
  episodeAttempts,
  nextAction,
  summariseQueue,
  type DunningAction,
  type DunningStage,
  type QueueSummary,
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
  /** Attempts made since this account went past due. Not its whole history. */
  attempts: number;
  /** What the provider said, where it said anything. `Card expired`. */
  lastAttemptFailed: string | null;
  /**
   * What the card was asked for, in fils, VAT included.
   *
   * From the failed attempt where there is one, not from the plan. A dropped
   * account is on Free by the time anybody reads this row — that is what the
   * sequence does — so deriving the figure from the plan would print `AED 0.00`
   * against the payment that failed.
   *
   * With no attempt yet, what the retry will ask for: `priceRenewal`, the
   * function the retry itself calls. It used to be a third derivation, the
   * plan's period with VAT and without the placements, which agreed with
   * neither of the two charges.
   *
   * Null for a dropped account nothing was ever charged on. There is no
   * payment that failed and none still to come, and the plan it is on now is
   * Free — so any figure here would be one this row invented.
   */
  amountFils: number | null;
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
  /** The header's figures, from `summariseQueue` — the card's figures too. */
  summary: QueueSummary;
  /** False when no gateway is configured, so the screen can say so. */
  gatewayLive: boolean;
}

const QUEUE_SELECT = {
  ...RENEWAL_SELECT,
  dunningStage: true,
  pastDueSince: true,
  business: { select: { displayName: true, slug: true } },
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
    select: { succeeded: true, providerMessage: true, amountFils: true, attemptedAt: true },
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

  const rows = await Promise.all(
    subscriptions.map(async (subscription): Promise<DunningRow> => {
      const stage = subscription.dunningStage as DunningStage;
      /*
         No start date means the sequence starts on the next run — the job's
         own rule, `pastDueSince ?? now` — so the row is read the way the job
         will treat it: day zero, a retry due, and a drop date fifteen days out.

         It was read as "already on Free". `dropsToFreeAt` was null for two
         reasons, dropped and not started, and the column renders null as the
         first: an account that had not been retried yet was shown as one that
         had finished the sequence.
      */
      const since = subscription.pastDueSince ?? now;
      const attempts = episodeAttempts(subscription.attempts, subscription.pastDueSince);
      const failed = attempts.find((attempt) => !attempt.succeeded);
      return {
        subscriptionId: subscription.id,
        businessId: subscription.businessId,
        businessName: subscription.business.displayName,
        slug: subscription.business.slug,
        planId: subscription.planId,
        planName: subscription.plan.name,
        stage,
        daysPastDue: daysPastDue(since, now),
        next: nextAction(stage, since, now),
        attempts: attempts.length,
        lastAttemptFailed: failed?.providerMessage ?? null,
        amountFils:
          failed?.amountFils ??
          (stage === "dropped" ? null : (await priceRenewal(subscription, now)).chargeFils),
        dropsToFreeAt: stage === "dropped" ? null : dropsToFreeAt(since),
      };
    }),
  );

  return { gatewayLive: paymentProvider().live, rows, summary: summariseQueue(rows, now) };
}

/** The card's figures. The same object the page's header reads. */
export type DunningSummary = QueueSummary;

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
  return (await dunningQueue(now)).summary;
}
