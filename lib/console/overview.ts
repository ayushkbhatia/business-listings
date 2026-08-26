import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * Board 4a — the console in one screen.
 *
 * The README: *"every number on it is a link into the queue that fixes it, and
 * it answers one question each morning — which of the six jobs is behind"*.
 *
 * So this module computes, per job, the two numbers that answer it: how much is
 * waiting, and how much of it has been waiting too long. **Age before volume**
 * — a queue of two hundred rows all filed this morning is healthy, and a queue
 * of three where the oldest is nine days old is not. A console that sorts by
 * volume shows you the first one.
 *
 * Every count here is a real query. There is no placeholder in this file and
 * there must never be one: this is the screen whose entire job is saying what
 * is behind, and a number on it that nobody computed is worse than a blank.
 *
 * Where a job's queue has no table yet — ingestion has no licence-import run
 * until step 2, the builder has no templates until step 6 — the metric returns
 * `null` rather than zero. Zero means "nothing waiting". Null means "we cannot
 * see yet", and the screen says so in those words.
 */

/**
 * How long a row may sit before it is late, in days.
 *
 * These are ours, not the design system's — no board states them. They are set
 * against what the delay costs somebody outside the building: a buyer waiting
 * on a contested listing is the most expensive, an unanswered supplier report
 * next, a taxonomy edit least. Change them here and every screen moves.
 */
export const SLA_DAYS = {
  /** A seller's trade name is wrong on a public page while this waits. */
  moderation: 2,
  /** Two companies both think they own a listing, and buyers are enquiring. */
  claim: 3,
  /** Somebody reported a supplier. Conduct queues age badly. */
  report: 5,
  /** A seller asked for the visit that unlocks tier 3. */
  visit: 14,
  /** A payment failed. D14 is when the plan drops, so 14 is the deadline. */
  dunning: 14,
} as const;

export type JobKey = "supply" | "comparable" | "storefronts" | "accounts" | "money" | "trust";

export interface ConsoleMetric {
  key: string;
  /** i18n key for the label. */
  labelKey: string;
  /** What is waiting. `null` where the table this counts does not exist yet. */
  count: number | null;
  /**
   * True where this metric is a queue somebody works through, so its rows can
   * be late. False for a standing figure — 24 unclaimed listings is the size of
   * the directory's opportunity, not a backlog anybody is behind on, and
   * rolling it into "past their service level" would make that headline
   * meaningless.
   */
  isQueue: boolean;
  /** How many of those are past their SLA. `null` where nothing measures it. */
  late: number | null;
  /** The oldest row's age in whole days, or null where nothing is waiting. */
  oldestDays: number | null;
  /** The nav key of the screen that fixes it, so the number can become a link. */
  navKey: string;
  href: string;
}

export interface ConsoleJob {
  key: JobKey;
  labelKey: string;
  metrics: ConsoleMetric[];
}

const DAY_MS = 86_400_000;

function daysSince(date: Date | null | undefined, now: Date): number | null {
  if (!date) return null;
  return Math.floor((now.getTime() - date.getTime()) / DAY_MS);
}

function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export async function consoleOverview(now = new Date()): Promise<ConsoleJob[]> {
  const [
    queuePending,
    queueLate,
    queueOldest,
    claimsOpen,
    claimsLate,
    claimsOldest,
    thinCategories,
    productsWithoutSpecs,
    zeroResults,
    freeAtCap,
    unclaimedListings,
    stagedRecords,
    reportsOpen,
    reportsLate,
    reportsOldest,
    visitsOpen,
    visitsLate,
    pastDue,
    unpaidInvoices,
    expiringLicences,
  ] = await Promise.all([
    prisma.listingChangeRequest.count({ where: { status: "pending" } }),
    prisma.listingChangeRequest.count({
      where: { status: "pending", createdAt: { lt: cutoff(now, SLA_DAYS.moderation) } },
    }),
    prisma.listingChangeRequest.findFirst({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),

    prisma.claimSubmission.count({ where: { decidedAt: null } }),
    prisma.claimSubmission.count({
      where: { decidedAt: null, createdAt: { lt: cutoff(now, SLA_DAYS.claim) } },
    }),
    prisma.claimSubmission.findFirst({
      where: { decidedAt: null },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),

    // A category whose published subcategory pages would fall below the floor.
    // The threshold columns exist and nothing has ever read them; step 1 wires
    // the taxonomy screen to the same numbers.
    prisma.category.count({ where: { parentId: { not: null } } }),
    prisma.product.count({ where: { status: "live", specValues: { equals: {} } } }),
    prisma.zeroResultQuery.count(),

    prisma.business.count({ where: { planId: "free", claimStatus: "claimed" } }),
    prisma.business.count({ where: { claimStatus: "unclaimed" } }),

    // Staged and waiting for somebody to approve the run. Real now: step 2
    // built the table that board 4a used to say was not measurable yet.
    prisma.stagedListing.count({
      where: { disposition: { in: ["ready", "needs_category"] }, run: { status: "staged" } },
    }),

    prisma.supplierReport.count({ where: { outcome: null } }),
    prisma.supplierReport.count({
      where: { outcome: null, createdAt: { lt: cutoff(now, SLA_DAYS.report) } },
    }),
    prisma.supplierReport.findFirst({
      where: { outcome: null },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),

    prisma.siteVisitRequest.count({ where: { completedAt: null, cancelledAt: null } }),
    prisma.siteVisitRequest.count({
      where: {
        completedAt: null,
        cancelledAt: null,
        createdAt: { lt: cutoff(now, SLA_DAYS.visit) },
      },
    }),

    prisma.subscription.count({ where: { status: "past_due" } }),
    prisma.invoice.count({ where: { status: "issued", paidAt: null } }),

    // Tier 3 and 4 rest on a licence. One that expires drops the tier, and the
    // seller finds out from the badge rather than from us unless somebody looks.
    prisma.business.count({
      where: {
        verificationTier: { gte: 3 },
        licenceExpiry: { lt: new Date(now.getTime() + 30 * DAY_MS) },
      },
    }),
  ]);

  const metric = (
    key: string,
    labelKey: string,
    navKey: string,
    href: string,
    count: number | null,
    late: number | null = null,
    oldest: Date | null = null,
  ): ConsoleMetric => ({
    key,
    labelKey,
    count,
    isQueue: late !== null,
    late: count === null ? null : late,
    oldestDays: daysSince(oldest, now),
    navKey,
    href,
  });

  return [
    {
      key: "supply",
      labelKey: "console.job.supply",
      metrics: [
        metric("queue", "console.metric.queue", "queue", "/admin/queue", queuePending, queueLate, queueOldest?.createdAt ?? null),
        metric("claims", "console.metric.claims", "queue", "/admin/queue", claimsOpen, claimsLate, claimsOldest?.createdAt ?? null),
        metric("staged", "console.metric.staged", "ingest", "/admin/ingest", stagedRecords),
        metric("unclaimed", "console.metric.unclaimed", "crm", "/admin/crm", unclaimedListings),
      ],
    },
    {
      key: "comparable",
      labelKey: "console.job.comparable",
      metrics: [
        metric("subcategories", "console.metric.subcategories", "categories", "/admin/categories", thinCategories),
        metric("no_specs", "console.metric.no_specs", "spec-library", "/admin/spec-library", productsWithoutSpecs),
        metric("zero_results", "console.metric.zero_results", "search", "/admin/search", zeroResults),
      ],
    },
    {
      key: "storefronts",
      labelKey: "console.job.storefronts",
      metrics: [
        metric("templates", "console.metric.templates", "storefront-templates", "/admin/storefront-templates", null),
      ],
    },
    {
      key: "accounts",
      labelKey: "console.job.accounts",
      metrics: [
        metric("free_accounts", "console.metric.free_accounts", "businesses", "/admin/businesses", freeAtCap),
        metric("call_list", "console.metric.call_list", "crm", "/admin/crm", null),
      ],
    },
    {
      key: "money",
      labelKey: "console.job.money",
      metrics: [
        /*
         * No lateness here, deliberately. The D14 deadline is real but
         * `Subscription` records no date it went past due — the dunning stage
         * arrives in step 5. Counting every past-due row as late would be a
         * number nobody computed, on the screen that exists to be trusted.
         */
        metric("past_due", "console.metric.past_due", "dunning", "/admin/dunning", pastDue),
        metric("unpaid", "console.metric.unpaid", "invoices", "/admin/invoices", unpaidInvoices),
      ],
    },
    {
      key: "trust",
      labelKey: "console.job.trust",
      metrics: [
        metric("reports", "console.metric.reports", "reports", "/admin/reports", reportsOpen, reportsLate, reportsOldest?.createdAt ?? null),
        metric("visits", "console.metric.visits", "visits", "/admin/visits", visitsOpen, visitsLate),
        metric("expiring", "console.metric.expiring", "businesses", "/admin/businesses", expiringLicences),
      ],
    },
  ];
}
