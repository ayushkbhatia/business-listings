import "server-only";
import type { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { tabWhere } from "@/lib/leads/inbox";
import { getPipeline } from "@/lib/quotes/pipeline";
import type { SellerVisibleBuyer } from "@/lib/db/queries/seller-visibility";

/**
 * Board `11i` build note `B1` — the two things that stop a closure.
 *
 * > *A buyer waiting on your quote must not find you gone.*
 *
 * Read here once and used twice: by the screen, to render each blocker with its
 * route out, and by `requestClosure`, which calls this again **inside** its own
 * transaction at request time. A blocker enforced only as a disabled button is
 * a blocker a second tab walks past.
 *
 * ## Both numbers come from the screens that already count them
 *
 * *Open enquiries* is board 3j's `Open` tab through `tabWhere`, the same
 * function the sidebar badge reads. *A quote a buyer has not answered* is board
 * 3k's `Awaiting` state through `getPipeline`. A close-account screen that said
 * three open enquiries over an inbox showing five would be a screen a seller
 * could not act on, and would be wrong in the direction that matters: it would
 * let them close with a buyer still waiting.
 */

export interface SubscriptionBlocker {
  planName: string;
  /** The next date we would charge. "Active until" on the board. */
  renewsAt: Date;
  /** True while a failed payment is being retried — still charging. */
  pastDue: boolean;
}

export interface WaitingQuote {
  ref: string;
  /** Masked exactly as board 3k masks it: a first name until a quote is accepted. */
  buyer: SellerVisibleBuyer;
  expiresAt: Date | null;
}

export interface EnquiryBlocker {
  /** Board 3j's `Open` tab. */
  openEnquiries: number;
  /** Board 3k's `Awaiting`: sent, inside validity, nobody has decided. */
  awaitingQuotes: number;
  /** The one the sentence names. The earliest to expire, so it is the most urgent. */
  firstQuote: WaitingQuote | null;
}

export interface ClosureBlockers {
  subscription: SubscriptionBlocker | null;
  enquiries: EnquiryBlocker | null;
  /** Neither stands. The only value `requestClosure` acts on. */
  clear: boolean;
}

/**
 * Whether we are still charging this business.
 *
 * A paid plan that is trialing, active or past due, with no cancellation
 * scheduled. A scheduled cancellation clears the blocker even though the paid
 * period runs on: the period is already paid for, nothing further will be
 * taken, and the refund question the board worries about only arises for money
 * we have not collected yet.
 *
 * `Subscription.planId`, not `Business.planId`. The dashboard's plan badge reads
 * the business row; what is being *charged* is the subscription row, and the two
 * can disagree.
 */
async function subscriptionBlocker(
  businessId: string,
  db: Prisma.TransactionClient,
): Promise<SubscriptionBlocker | null> {
  const subscription = await db.subscription.findUnique({
    where: { businessId },
    select: {
      status: true,
      renewsAt: true,
      cancelledAt: true,
      plan: { select: { name: true, monthlyPriceAed: true } },
    },
  });
  if (!subscription) return null;
  if (subscription.plan.monthlyPriceAed <= 0) return null;
  if (subscription.cancelledAt) return null;
  if (!["trialing", "active", "past_due"].includes(subscription.status)) return null;

  return {
    planName: subscription.plan.name,
    renewsAt: subscription.renewsAt,
    pastDue: subscription.status === "past_due",
  };
}

async function enquiryBlocker(
  businessId: string,
  db: Prisma.TransactionClient,
  now: Date,
): Promise<EnquiryBlocker | null> {
  const [openEnquiries, pipeline] = await Promise.all([
    db.enquiryRecipient.count({ where: tabWhere(businessId, "open", { kind: "all" }) }),
    getPipeline({ businessId, tab: "awaiting", scope: { kind: "all" }, now }),
  ]);

  const awaitingQuotes = pipeline.counts.awaiting;
  if (openEnquiries === 0 && awaitingQuotes === 0) return null;

  const first = [...pipeline.rows].sort(
    (a, b) =>
      (a.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
      (b.expiresAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
  )[0];

  return {
    openEnquiries,
    awaitingQuotes,
    firstQuote: first ? { ref: first.ref, buyer: first.buyer, expiresAt: first.expiresAt } : null,
  };
}

/**
 * Both blockers, for a business, now.
 *
 * `db` is the transaction when `requestClosure` calls this, so the count and the
 * write see the same rows. `getPipeline` reads through the shared client rather
 * than the transaction — it has no transaction parameter, and giving it one is a
 * change to board 3k — so the quote half is re-read a moment before the write
 * rather than inside it. The window that leaves is the time between a buyer's
 * quote arriving and a request that already passed the screen, and the listing
 * is unpublished by the same request, so no new enquiry can land after it.
 */
export async function closureBlockers(
  businessId: string,
  now: Date = new Date(),
  db: Prisma.TransactionClient = prisma,
): Promise<ClosureBlockers> {
  const [subscription, enquiries] = await Promise.all([
    subscriptionBlocker(businessId, db),
    enquiryBlocker(businessId, db, now),
  ]);
  return { subscription, enquiries, clear: subscription === null && enquiries === null };
}
