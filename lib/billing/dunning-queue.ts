import "server-only";
import { prisma } from "@/lib/db/client";
import { paymentProvider } from "./provider";
import { daysPastDue, nextAction, type DunningAction, type DunningStage } from "./dunning";

/**
 * The failed-payments queue, read.
 *
 * The screen shows what the sequence will do next rather than only where each
 * account is, because "emailed" answers a question nobody asked — the question
 * is what happens tomorrow, and to whom.
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
  lastAttemptFailed: string | null;
}

export interface DunningQueue {
  rows: DunningRow[];
  /** False when no gateway is configured, so the screen can say so. */
  gatewayLive: boolean;
}

export async function dunningQueue(now = new Date()): Promise<DunningQueue> {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      OR: [{ status: "past_due" }, { dunningStage: { not: "none" } }],
    },
    orderBy: [{ pastDueSince: "asc" }],
    select: {
      id: true,
      businessId: true,
      planId: true,
      dunningStage: true,
      pastDueSince: true,
      business: { select: { displayName: true, slug: true } },
      plan: { select: { name: true } },
      attempts: {
        orderBy: { attemptedAt: "desc" },
        select: { succeeded: true, providerMessage: true },
      },
    },
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
      };
    }),
  };
}
