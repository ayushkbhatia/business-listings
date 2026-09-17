import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma, PrismaClient } from "@/lib/db/generated/client";
import type { $Enums } from "@/lib/db/generated/client";
import { collapseKey } from "./collapse";
import { slaMsFor, slaStateOf } from "./sla";
import { REVIEW_DISPUTE } from "./taxonomy";
import {
  viewOf,
  type ReportDetector,
  type ReporterKind,
  type ReportEntry,
  type ReportQueueFilter,
  type ReportQueueView,
} from "./view";

/*
   Re-exported so a caller has one import for the queue, and so the pure half
   stays testable on its own.
*/
export {
  viewOf,
  type ReportDetector,
  type ReporterKind,
  type ReportEntry,
  type ReportQueueFilter,
  type ReportQueueView,
} from "./view";

/**
 * Board 4h — what the queue is, read once.
 *
 * Two tables, one job. A supplier report is filed against a business; a review
 * dispute is filed by one about a review. `lib/reviews/disputes.ts` sets out at
 * length why they are not one table, and none of it is visible from the
 * moderator's side of the desk, where both are something to decide this
 * morning. So this module joins them into one array and everything on the
 * screen is counted off it — the header, the chips, the over-SLA badge, the
 * auto-detected share and the rows.
 *
 * That is `B3` and it is board 4b's `B4` restated: *a count that came from a
 * second query is a count that can disagree with the table under it.* The
 * board's header said **14 supplier reports · 23 reviews · 9 listings** over a
 * `TYPE` column naming five other things, and three of those five had no home
 * in the header at all.
 *
 * ## Duplicates collapse (`B6`)
 *
 * Three buyers reporting one wrong telephone number is one work item and three
 * records. They collapse here, at read time, on `(business, kind, subjectField)`
 * — the oldest is the work item and carries the count, the rest travel with it
 * as `duplicateIds` so that resolving the one resolves all of them. Nothing is
 * written to collapse a group: a report that turns out to be about something
 * else needs only a different `subjectField`, not a migration.
 *
 * A report with no `subjectField` never collapses. There is nothing to group on,
 * and grouping *everything* about one business would put a stolen photograph and
 * a disconnected landline in the same row.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/* ── Reading ─────────────────────────────────────────────────────────────── */

const REPORT_SELECT = {
  id: true,
  kind: true,
  subjectField: true,
  detail: true,
  evidence: true,
  detector: true,
  reviewId: true,
  enquiryId: true,
  escalatedAt: true,
  createdAt: true,
  reporter: { select: { id: true, fullName: true } },
  assignee: { select: { id: true, fullName: true } },
  subjectBusiness: {
    select: { id: true, displayName: true, slug: true, suspendedAt: true },
  },
} satisfies Prisma.SupplierReportSelect;

function reporterKindOf(row: {
  kind: $Enums.ReportKind;
  detector: ReportDetector | null;
  reporter: { id: string } | null;
}): ReporterKind {
  if (row.detector) return "auto";
  // Our own finding about a review, logged by a moderator against the account.
  if (row.kind === "review_integrity") return "staff";
  if (!row.reporter) return "public";
  return "buyer";
}

/**
 * Every open supplier report, collapsed.
 *
 * Ordered by age at the database so the oldest of a group is the work item
 * whatever order the rows come back in.
 */
async function openReportEntries(now: Date, db: Db): Promise<ReportEntry[]> {
  const rows = await db.supplierReport.findMany({
    where: { outcome: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: REPORT_SELECT,
  });

  /*
     Every prior on every field this queue holds, in one grouped read.

     Per row it would be one query each, which on a queue of two hundred is two
     hundred round trips for a number that appears under a claim in grey. Null
     `subjectField` rows have no priors to count and are not in the group by.
  */
  const fields = [
    ...new Set(rows.flatMap((row) => (row.subjectField ? [row.subjectField] : []))),
  ];
  const priorRows =
    fields.length === 0
      ? []
      : await db.supplierReport.groupBy({
          by: ["subjectBusinessId", "subjectField"],
          where: {
            subjectBusinessId: { in: [...new Set(rows.map((row) => row.subjectBusiness.id))] },
            subjectField: { in: fields },
          },
          _count: { _all: true },
        });
  const priors = new Map(
    priorRows.map((row) => [`${row.subjectBusinessId}|${row.subjectField}`, row._count._all]),
  );

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    /*
       One rule, in `./collapse.ts`, shared with the resolve and the detail
       screen. A row that does not collapse gets a bucket of its own, keyed on
       its id so it cannot share one with another row that also stands alone.
    */
    const key = collapseKey(row.subjectBusiness.id, row) ?? `single|${row.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return [...groups.values()].map((group) => {
    const head = group[0]!;
    const waitingMs = Math.max(0, now.getTime() - head.createdAt.getTime());
    const slaMs = slaMsFor(head.kind);
    return {
      ref: `report:${head.id}`,
      id: head.id,
      type: head.kind,
      businessId: head.subjectBusiness.id,
      businessName: head.subjectBusiness.displayName,
      businessSlug: head.subjectBusiness.slug,
      businessSuspended: head.subjectBusiness.suspendedAt !== null,
      claim: head.detail,
      /*
         The measurement belongs to the work item, not to whichever record
         happened to be filed first.

         Three buyers report a telephone number and the nightly sweep then
         measures it: the sweep's row joins their group, and the group's oldest
         record — a person's — carries no measurement. Reading the head's
         evidence alone would hide `Same number on 3 listings` behind the
         complaint that prompted it.
      */
      evidence: group.find((row) => row.evidence)?.evidence ?? null,
      /*
         The detector is the head's, and deliberately not the group's. A report
         a person filed first is one a person found, whatever the platform
         measured afterwards — and the board's *auto-detected* share is a claim
         about who noticed.
      */
      detector: head.detector,
      reporter: { kind: reporterKindOf(head), name: head.reporter?.fullName ?? null },
      reports: group.length,
      duplicateIds: group.slice(1).map((row) => row.id),
      priorsOnField: head.subjectField
        ? (priors.get(`${head.subjectBusiness.id}|${head.subjectField}`) ?? group.length)
        : 0,
      filedAt: head.createdAt,
      waitingMs,
      slaMs,
      sla: slaStateOf(waitingMs, slaMs),
      assignee: head.assignee ? { id: head.assignee.id, name: head.assignee.fullName } : null,
      escalatedAt: head.escalatedAt,
      reviewId: head.reviewId,
      href: `/admin/reports/${head.id}`,
    } satisfies ReportEntry;
  });
}

/** Every open review dispute, as the same row shape. */
async function openDisputeEntries(now: Date, db: Db): Promise<ReportEntry[]> {
  const rows = await db.reviewDispute.findMany({
    where: { resolvedAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      reviewId: true,
      ground: true,
      detail: true,
      createdAt: true,
      business: { select: { id: true, displayName: true, slug: true, suspendedAt: true } },
      assignee: { select: { id: true, fullName: true } },
      review: { select: { overall: true } },
    },
  });

  const slaMs = slaMsFor(REVIEW_DISPUTE);
  return rows.map((row) => {
    const waitingMs = Math.max(0, now.getTime() - row.createdAt.getTime());
    return {
      ref: `dispute:${row.id}`,
      id: row.id,
      type: REVIEW_DISPUTE,
      businessId: row.business.id,
      businessName: row.business.displayName,
      businessSlug: row.business.slug,
      businessSuspended: row.business.suspendedAt !== null,
      claim: row.detail,
      /*
         The ground and the rating, which is what the row is about. Resolved to
         words in `board.ts`: this module hands the screen data, never strings
         it has translated on the way past.
      */
      evidence: null,
      detector: null,
      reporter: { kind: "seller" as const, name: row.business.displayName },
      reports: 1,
      duplicateIds: [],
      priorsOnField: 0,
      filedAt: row.createdAt,
      waitingMs,
      slaMs,
      sla: slaStateOf(waitingMs, slaMs),
      assignee: row.assignee ? { id: row.assignee.id, name: row.assignee.fullName } : null,
      escalatedAt: null,
      reviewId: row.reviewId,
      href: `/admin/reports/disputes/${row.id}`,
    } satisfies ReportEntry;
  });
}

export async function loadReportQueue(
  filter: ReportQueueFilter = {},
  now = new Date(),
  db: Db = prisma,
): Promise<ReportQueueView> {
  const [reports, disputes] = await Promise.all([
    openReportEntries(now, db),
    openDisputeEntries(now, db),
  ]);
  return viewOf([...reports, ...disputes], filter);
}

/**
 * What the console's trust job reports, from the same numbers this board shows.
 *
 * `lib/console/overview.ts` counted `supplier_report` alone against one service
 * level for every kind — so it could say four were waiting while the board said
 * six, and could call a fraud report healthy at three days. It reads this now,
 * which is the rule `SLA_MS` states for board 4b: the overview and the queue
 * cannot disagree about what late means.
 */
export async function reportQueueHealth(
  now = new Date(),
  db: Db = prisma,
): Promise<{ open: number; late: number; oldestAt: Date | null }> {
  const view = await loadReportQueue({}, now, db);
  return {
    open: view.total,
    late: view.overSla,
    oldestAt: view.all.length > 0 ? view.all.reduce((oldest, entry) => (entry.filedAt < oldest ? entry.filedAt : oldest), view.all[0]!.filedAt) : null,
  };
}
