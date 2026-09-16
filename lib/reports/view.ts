import type { $Enums } from "@/lib/db/generated/client";
import { REPORT_TYPES, type ReportType } from "./taxonomy";
import type { SlaState } from "./sla";

/**
 * Board 4h — a queue row and what a filter leaves of it, with no database in
 * sight.
 *
 * Split from `./queue.ts` for the reason `lib/console/overview.ts` gives for
 * the same split: the reads are `server-only` and `server-only` is not
 * importable from a test environment, so the rules that decide what the screen
 * shows would be the one part of this board with no unit test. The order, the
 * counts and the three filters are all here, and `queue.ts` re-exports them so
 * a caller still has one import.
 */

export type ReportDetector = $Enums.ReportDetector;

/** Who filed it, as far as the screen is concerned. */
export type ReporterKind = "auto" | "public" | "buyer" | "seller" | "staff";

export interface ReportEntry {
  /** `report:cl123` or `dispute:cl123` — unique across the queue. */
  ref: string;
  id: string;
  type: ReportType;
  businessId: string;
  businessName: string;
  businessSlug: string;
  businessSuspended: boolean;
  /** What was reported, in one line. The claim, never the measurement. */
  claim: string | null;
  /** What the platform already knows, in one line. Mono, under the claim. */
  evidence: string | null;
  detector: ReportDetector | null;
  reporter: { kind: ReporterKind; name: string | null };
  /** How many records this row stands for. 1 is itself alone. */
  reports: number;
  /** The other records in the group, oldest first. Empty unless `reports > 1`. */
  duplicateIds: string[];
  /**
   * How many times this business has been reported on this field, ever.
   *
   * The three-strikes figure the data model names, and the fallback evidence
   * line for a row whose producer had no measurement to write: *third report of
   * this field* is a measurement. Counts resolved reports too — a listing
   * corrected twice and reported a third time is the case this is for.
   */
  priorsOnField: number;
  filedAt: Date;
  waitingMs: number;
  slaMs: number;
  sla: SlaState;
  assignee: { id: string; name: string | null } | null;
  escalatedAt: Date | null;
  /** The review this row is about, where it is about one. */
  reviewId: string | null;
  href: string;
}

export interface ReportQueueView {
  /** Every work item, before the filters. The header counts this. */
  all: ReportEntry[];
  /** What the filters left, in the order the board shows: late first, then oldest. */
  rows: ReportEntry[];
  /** Per type, counted off `all` so a chip and the header cannot disagree. */
  counts: Record<ReportType, number>;
  total: number;
  overSla: number;
  /** Work items a detector filed. The board's *61% of these*. */
  autoDetected: number;
  /** Underlying records, which is larger than `total` wherever a group collapsed. */
  records: number;
}

export interface ReportQueueFilter {
  type?: ReportType | null;
  assigneeId?: string | null;
  /** Escalated and still open. The ops lead's own list. */
  escalated?: boolean;
}

/**
 * The order the board shows, and it survives every filter.
 *
 * Late first, then oldest — board 4b's `B9`, and the same reason: a queue
 * sorted by volume shows you the wrong one. Ties break on the ref so two rows
 * filed in the same millisecond do not swap places between renders.
 */
function queueOrder(a: ReportEntry, b: ReportEntry): number {
  const lateness = Number(b.sla === "late") - Number(a.sla === "late");
  if (lateness !== 0) return lateness;
  const age = a.filedAt.getTime() - b.filedAt.getTime();
  if (age !== 0) return age;
  return a.ref.localeCompare(b.ref);
}

export function viewOf(all: ReportEntry[], filter: ReportQueueFilter): ReportQueueView {
  const counts = Object.fromEntries(REPORT_TYPES.map((type) => [type, 0])) as Record<ReportType, number>;
  for (const entry of all) counts[entry.type] += 1;

  const rows = all
    .filter((entry) => (filter.type ? entry.type === filter.type : true))
    .filter((entry) => (filter.assigneeId ? entry.assignee?.id === filter.assigneeId : true))
    .filter((entry) => (filter.escalated ? entry.escalatedAt !== null : true))
    .sort(queueOrder);

  return {
    all: [...all].sort(queueOrder),
    rows,
    counts,
    total: all.length,
    overSla: all.filter((entry) => entry.sla === "late").length,
    autoDetected: all.filter((entry) => entry.detector !== null).length,
    records: all.reduce((sum, entry) => sum + entry.reports, 0),
  };
}

