import "server-only";
import { prisma } from "@/lib/db/client";
import { toCsv } from "@/lib/import/csv";
import type { Authority, Emirate } from "@/lib/db/generated/enums";
import type { StagedDisposition } from "@/lib/db/generated/client";
import { loadTradeKinds } from "@/lib/taxonomy/service";
import { tradeKindOrigin } from "@/lib/taxonomy/trade-kind";
import { EMIRATES } from "@/lib/uae";
import {
  HELD_REASONS,
  REJECTION_ACTION,
  REJECTION_GROUNDS,
  heldReasons,
  type HeldReason,
  type RejectionGround,
} from "./classify";
import {
  KEPT_BECAUSE,
  KNOWN_AUTHORITIES,
  REVERSIBLE_DAYS,
  rollbackPreview,
  type KeptBecause,
  type RollbackManifest,
  type RollbackPreview,
} from "./service";
import { coverageByEmirate } from "./sources";

/**
 * Board 12a — what the importer's screens read.
 *
 * Every figure here is recounted from the records rather than read off the
 * run's stored columns. Those were written once at staging and a worked queue
 * never moved them; a stat card is a claim about the file, and the board's
 * whole argument is that its cards are "auditable against the table beneath
 * them".
 */

export interface RunOverview {
  id: string;
  number: number;
  source: string;
  filename: string;
  status: string;
  createdAt: Date;
  uploadedBy: string | null;
  rowCount: number;
  truncatedCount: number;
  /** Bucket counts. `newListings + duplicates + rejected === rowCount`. */
  newListings: number;
  duplicates: number;
  /** Board 12b: this run's pairs by state, and its near misses under the floor. */
  pairs: { pending: number; merged: number; separated: number; discarded: number; belowFloor: number };
  rejected: number;
  /** Inside `newListings`: filed under a category, published or not. */
  categorised: number;
  queued: number;
  published: number;
  /** Open records that would publish on the next approval. */
  publishable: number;
  /** Open records that would not, and why. A record can carry more than one. */
  held: number;
  heldBecause: Record<HeldReason, number>;
  byGround: { ground: RejectionGround; count: number; action: "never_publish" | "discard" }[];
  /** Listings from this run live on the directory now. */
  live: number;
  decision: {
    reason: string;
    at: Date;
    by: string | null;
  } | null;
  reversibleUntil: Date | null;
  /** True while the window is open and the run has published. */
  reversible: boolean;
  rollback: {
    at: Date;
    by: string | null;
    reason: string;
    withdrawn: number;
    kept: number;
    keptBecause: Record<KeptBecause, number>;
  } | null;
  /** What a rollback would do now. Null unless `reversible`. */
  rollbackPreview: RollbackPreview | null;
}

export async function runOverview(runId: string, now = new Date()): Promise<RunOverview | null> {
  const run = await prisma.licenceImportRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      number: true,
      source: true,
      filename: true,
      status: true,
      rowCount: true,
      truncatedCount: true,
      belowFloorCount: true,
      decisionReason: true,
      decidedAt: true,
      reversibleUntil: true,
      rolledBackAt: true,
      rollbackReason: true,
      rollbackManifest: true,
      createdAt: true,
      actor: { select: { fullName: true } },
      decidedBy: { select: { fullName: true } },
      rolledBackBy: { select: { fullName: true } },
    },
  });
  if (!run) return null;

  const [dispositions, grounds, open, live, pairRows] = await Promise.all([
    prisma.stagedListing.groupBy({
      by: ["disposition"],
      where: { runId },
      _count: { _all: true },
    }),
    prisma.stagedListing.groupBy({
      by: ["rejectionGround"],
      where: { runId, disposition: "rejected" },
      _count: { _all: true },
    }),
    prisma.stagedListing.findMany({
      where: { runId, disposition: { in: ["ready", "needs_category"] } },
      select: {
        disposition: true,
        categoryId: true,
        licenceAuthority: true,
        licenceNumber: true,
        licenceExpiry: true,
      },
    }),
    prisma.business.count({
      where: { licenceImportRunId: runId, publishedAt: { not: null }, mergedIntoId: null },
    }),
    prisma.mergeCandidate.groupBy({ by: ["state"], where: { sourceRunId: runId }, _count: { _all: true } }),
  ]);
  const pairOf = (state: string) => pairRows.find((row) => row.state === state)?._count._all ?? 0;
  const pairs = {
    pending: pairOf("pending"),
    merged: pairOf("merged"),
    separated: pairOf("separated"),
    discarded: pairOf("discarded"),
    belowFloor: run.belowFloorCount,
  };

  const of = (disposition: StagedDisposition) =>
    dispositions.find((row) => row.disposition === disposition)?._count._all ?? 0;

  const heldBecause = Object.fromEntries(HELD_REASONS.map((reason) => [reason, 0])) as Record<
    HeldReason,
    number
  >;
  let held = 0;
  const canMove = run.status === "staged" || run.status === "approved";
  for (const row of open) {
    const reasons = heldReasons(row, run.source, KNOWN_AUTHORITIES);
    if (reasons.length === 0) continue;
    held += 1;
    for (const reason of reasons) heldBecause[reason] += 1;
  }

  const reversible =
    run.status === "approved" &&
    run.reversibleUntil !== null &&
    run.reversibleUntil.getTime() >= now.getTime();

  const manifest = run.rollbackManifest as RollbackManifest | null;
  const keptBecause = Object.fromEntries(KEPT_BECAUSE.map((why) => [why, 0])) as Record<
    KeptBecause,
    number
  >;
  for (const item of manifest?.kept ?? []) keptBecause[item.why] += 1;

  return {
    id: run.id,
    number: run.number,
    source: run.source,
    filename: run.filename,
    status: run.status,
    createdAt: run.createdAt,
    uploadedBy: run.actor.fullName,
    rowCount: run.rowCount,
    truncatedCount: run.truncatedCount,
    newListings: of("ready") + of("needs_category") + of("published"),
    // A duplicate stays in this bucket once board 12b resolves it — merged as a
    // branch or discarded — so the three buckets still sum to the file.
    duplicates: of("duplicate") + of("merged") + of("discarded"),
    pairs,
    rejected: of("rejected"),
    categorised: of("ready") + of("published"),
    queued: of("needs_category"),
    published: of("published"),
    publishable: canMove ? open.length - held : 0,
    held: canMove ? held : 0,
    heldBecause,
    byGround: REJECTION_GROUNDS.map((ground) => ({
      ground,
      count: grounds.find((row) => row.rejectionGround === ground)?._count._all ?? 0,
      action: REJECTION_ACTION[ground],
    })),
    live,
    decision:
      run.decidedAt && run.decisionReason
        ? { reason: run.decisionReason, at: run.decidedAt, by: run.decidedBy?.fullName ?? null }
        : null,
    reversibleUntil: run.reversibleUntil,
    reversible,
    rollback:
      run.rolledBackAt && run.rollbackReason && manifest
        ? {
            at: run.rolledBackAt,
            by: run.rolledBackBy?.fullName ?? null,
            reason: run.rollbackReason,
            withdrawn: manifest.withdrawn.length,
            kept: manifest.kept.length,
            keptBecause,
          }
        : null,
    rollbackPreview: reversible ? await rollbackPreview(run.id) : null,
  };
}

/** The runs a person has to decide, oldest first — the next one is the one waiting longest. */
export async function runsAwaitingReview() {
  return prisma.licenceImportRun.findMany({
    where: { status: "staged" },
    orderBy: [{ createdAt: "asc" }, { number: "asc" }],
    select: { id: true, number: true },
  });
}

export async function recentRuns(limit = 25) {
  const runs = await prisma.licenceImportRun.findMany({
    orderBy: { number: "desc" },
    take: limit,
    select: {
      id: true,
      number: true,
      source: true,
      filename: true,
      status: true,
      rowCount: true,
      stagedCount: true,
      queuedCount: true,
      duplicateCount: true,
      rejectedCount: true,
      createdAt: true,
    },
  });
  return runs;
}

export interface HistoryRow {
  id: string;
  number: number;
  source: string;
  status: string;
  /**
   * What the run did to the directory: listings created, or listings taken
   * back. Null for a run that has not published and never will.
   */
  net: number | null;
  createdAt: Date;
}

/**
 * The right rail's run history. `+2,104` is the listings a run created;
 * `−1,204` is the listings its rollback withdrew, read from the manifest the
 * rollback wrote rather than recomputed from listings that have since moved.
 */
export async function runHistory(limit = 6): Promise<HistoryRow[]> {
  const runs = await prisma.licenceImportRun.findMany({
    orderBy: { number: "desc" },
    take: limit,
    select: {
      id: true,
      number: true,
      source: true,
      status: true,
      rollbackManifest: true,
      createdAt: true,
      _count: { select: { rows: { where: { disposition: "published" } } } },
    },
  });

  return runs.map((run) => ({
    id: run.id,
    number: run.number,
    source: run.source,
    status: run.status,
    net:
      run.status === "rolled_back"
        ? -((run.rollbackManifest as RollbackManifest | null)?.withdrawn.length ?? 0)
        : run.status === "approved"
          ? run._count.rows
          : null,
    createdAt: run.createdAt,
  }));
}

export interface CoverageRow {
  emirate: Emirate;
  authorities: number;
  imported: Authority[];
  lastRunAt: Date | null;
  lastSource: Authority | null;
}

/** B10 — every emirate, with what has been imported from it and when. */
export async function sourceCoverage(): Promise<CoverageRow[]> {
  const runs = await prisma.licenceImportRun.findMany({
    where: { status: { in: ["staged", "approved", "rolled_back"] } },
    select: { source: true, createdAt: true },
  });
  return coverageByEmirate(
    EMIRATES.map((emirate) => emirate.value),
    runs,
  ).map((row) => ({
    emirate: row.emirate,
    authorities: row.authorities.length,
    imported: row.imported,
    lastRunAt: row.lastRunAt,
    lastSource: row.lastSource,
  }));
}

/* ── Records ─────────────────────────────────────────────────────────────── */

export const RECORD_FILTERS = [
  "all",
  "queued",
  "ready",
  "published",
  "duplicate",
  "rejected",
] as const;
export type RecordFilter = (typeof RECORD_FILTERS)[number];

const FILTER_WHERE: Record<RecordFilter, StagedDisposition[] | null> = {
  all: null,
  queued: ["needs_category"],
  ready: ["ready"],
  published: ["published"],
  // Resolved duplicates stay under the tab they arrived in.
  duplicate: ["duplicate", "merged", "discarded"],
  rejected: ["rejected"],
};

export function isRecordFilter(value: string | undefined): value is RecordFilter {
  return (RECORD_FILTERS as readonly string[]).includes(value ?? "");
}

export interface RecordRow {
  id: string;
  rowNumber: number;
  /**
   * The name the registry printed. Not `tradeName` by name, because this is a
   * record before it is a listing — there is no seller identity to be yet, and
   * `check:vocabulary` rightly refuses a `tradeName` on a rendered surface.
   */
  licenceName: string | null;
  licenceNumber: string | null;
  activity: string | null;
  emirate: string | null;
  disposition: string;
  ground: RejectionGround | null;
  held: HeldReason[];
  categoryName: string | null;
  /**
   * For a published record: whether its listing is on the directory now. A
   * rollback or a merge takes a listing down and leaves the record saying
   * `published`, which is true of the record and would read as a lie about
   * the listing without this beside it.
   */
  listingLive: boolean | null;
}

export async function runRecords(
  runId: string,
  filter: RecordFilter,
  page: number,
  pageSize = 50,
): Promise<{ rows: RecordRow[]; total: number; counts: Record<RecordFilter, number> }> {
  const run = await prisma.licenceImportRun.findUnique({
    where: { id: runId },
    select: { source: true, status: true },
  });
  if (!run) return { rows: [], total: 0, counts: Object.fromEntries(RECORD_FILTERS.map((f) => [f, 0])) as Record<RecordFilter, number> };

  const disposition = FILTER_WHERE[filter];
  const where = { runId, ...(disposition ? { disposition: { in: disposition } } : {}) };

  const [rows, grouped] = await Promise.all([
    prisma.stagedListing.findMany({
      where,
      orderBy: { rowNumber: "asc" },
      skip: (Math.max(page, 1) - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        rowNumber: true,
        tradeName: true,
        licenceNumber: true,
        licenceAuthority: true,
        licenceExpiry: true,
        activity: true,
        emirate: true,
        disposition: true,
        rejectionGround: true,
        categoryId: true,
        category: { select: { name: true } },
        business: { select: { publishedAt: true } },
      },
    }),
    prisma.stagedListing.groupBy({ by: ["disposition"], where: { runId }, _count: { _all: true } }),
  ]);

  const count = (value: StagedDisposition) =>
    grouped.find((row) => row.disposition === value)?._count._all ?? 0;
  const counts = Object.fromEntries(
    RECORD_FILTERS.map((key) => [
      key,
      key === "all"
        ? grouped.reduce((sum, row) => sum + row._count._all, 0)
        : FILTER_WHERE[key]!.reduce((sum, value) => sum + count(value), 0),
    ]),
  ) as Record<RecordFilter, number>;

  const open = run.status === "staged" || run.status === "approved";

  return {
    rows: rows.map((row) => ({
      id: row.id,
      rowNumber: row.rowNumber,
      licenceName: row.tradeName,
      licenceNumber: row.licenceNumber,
      activity: row.activity,
      emirate: row.emirate,
      disposition: row.disposition,
      ground: row.rejectionGround,
      held:
        open && (row.disposition === "ready" || row.disposition === "needs_category")
          ? heldReasons(row, run.source, KNOWN_AUTHORITIES)
          : [],
      categoryName: row.category?.name ?? null,
      listingLive: row.business ? row.business.publishedAt !== null : null,
    })),
    total: counts[filter],
    counts,
  };
}

/** The registry's columns, in the order a person reads a licence. */
const RAW_ORDER = [
  "trade name",
  "tradename",
  "company name",
  "name",
  "licence no",
  "license no",
  "licence number",
  "license number",
  "authority",
  "issuing authority",
  "expiry date",
  "expiry",
  "emirate",
  "area",
  "activity",
  "activities",
  "phone",
];

/**
 * A raw row's columns in the file's own order.
 *
 * JSONB keeps every value and not the order, so the order is the run's stored
 * header row. A run staged before that column existed has none, and falls back
 * to reading order: the licence's own fields first, then the rest by name.
 * Nothing is dropped or renamed either way — B5 is that the row is verbatim.
 */
export function orderRaw(raw: Record<string, string>, headers: readonly string[]): [string, string][] {
  const entries = Object.entries(raw);
  const rank = (header: string) => {
    const stored = headers.indexOf(header);
    if (stored !== -1) return stored;
    const known = RAW_ORDER.indexOf(header.trim().toLowerCase());
    return headers.length + (known === -1 ? RAW_ORDER.length : known);
  };
  return entries.sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
}

export async function recordDetail(id: string) {
  const record = await prisma.stagedListing.findUnique({
    where: { id },
    select: {
      id: true,
      rowNumber: true,
      raw: true,
      tradeName: true,
      licenceNumber: true,
      licenceAuthority: true,
      licenceExpiry: true,
      emirate: true,
      areaName: true,
      activity: true,
      activityKey: true,
      phone: true,
      disposition: true,
      rejectionGround: true,
      categoryId: true,
      categorySource: true,
      categorisedAt: true,
      duplicateOfRow: true,
      createdAt: true,
      category: { select: { id: true, name: true } },
      categorisedBy: { select: { fullName: true } },
      business: { select: { displayName: true, slug: true, publishedAt: true } },
      duplicateOf: { select: { displayName: true, slug: true, claimStatus: true, publishedAt: true } },
      run: { select: { id: true, number: true, source: true, status: true, headers: true } },
      // Board 12b: where the record's dedupe pair stands. The newest, because a
      // reversed or withdrawn pair can be followed by another.
      pairs: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { state: true, score: true, withdrawnReason: true, ownerConfirmation: true },
      },
    },
  });
  if (!record) return null;

  /*
     JSONB keeps every value and not the column order, so the raw row is
     re-ordered for reading: the licence's own fields first, in the order a
     licence is read, then whatever else the registry sent, alphabetically.
     Nothing is dropped or renamed — B5 is that the row is kept verbatim.
  */
  const raw = orderRaw((record.raw ?? {}) as Record<string, string>, record.run.headers);

  const [kinds, mapping, duplicateRow] = await Promise.all([
    record.categoryId ? loadTradeKinds() : Promise.resolve(null),
    record.activityKey
      ? prisma.licenceActivityMapping.findUnique({
          where: { activityKey: record.activityKey },
          select: { category: { select: { name: true } }, updatedAt: true },
        })
      : Promise.resolve(null),
    record.duplicateOfRow !== null
      ? prisma.stagedListing.findUnique({
          where: { runId_rowNumber: { runId: record.run.id, rowNumber: record.duplicateOfRow } },
          select: { id: true, tradeName: true },
        })
      : Promise.resolve(null),
  ]);

  const origin = kinds && record.categoryId ? tradeKindOrigin(kinds, record.categoryId) : null;
  const ancestor =
    origin?.from === "inherited"
      ? await prisma.category.findUnique({ where: { id: origin.ancestorId }, select: { name: true } })
      : null;

  const open =
    (record.run.status === "staged" || record.run.status === "approved") &&
    (record.disposition === "ready" || record.disposition === "needs_category");

  const { tradeName: licenceName, pairs, ...rest } = record;
  return {
    ...rest,
    pair: pairs[0] ?? null,
    licenceName,
    raw,
    open,
    held: open ? heldReasons(record, record.run.source, KNOWN_AUTHORITIES) : [],
    tradeKind: origin ? { kind: origin.kind, from: origin.from, inheritedFrom: ancestor?.name ?? null } : null,
    mapping: mapping ? { categoryName: mapping.category.name, updatedAt: mapping.updatedAt } : null,
    duplicateRow,
  };
}

/* ── Export ──────────────────────────────────────────────────────────────── */

/**
 * Criterion 3: rejection reasons "export with the raw row".
 *
 * One line per rejected record: its row number, the ground as a code and as
 * the sentence the screen uses, the action the ground carries, and then every
 * column the registry sent, verbatim, under the registry's own headers.
 */
export async function rejectsCsv(
  runId: string,
  labels: { ground: (ground: RejectionGround) => string; action: (action: "never_publish" | "discard") => string; headers: readonly [string, string, string, string] },
): Promise<{ filename: string; body: string } | null> {
  const run = await prisma.licenceImportRun.findUnique({
    where: { id: runId },
    select: { number: true, source: true, headers: true },
  });
  if (!run) return null;

  const rows = await prisma.stagedListing.findMany({
    where: { runId, disposition: "rejected" },
    orderBy: { rowNumber: "asc" },
    select: { rowNumber: true, rejectionGround: true, raw: true },
  });

  // The file's own column order, and any column a row carries that the header
  // row somehow did not, after it.
  const headers: string[] = [...run.headers];
  for (const row of rows) {
    for (const [header] of orderRaw((row.raw ?? {}) as Record<string, string>, run.headers)) {
      if (!headers.includes(header)) headers.push(header);
    }
  }

  const body = toCsv([
    [...labels.headers, ...headers],
    ...rows.map((row) => {
      const raw = (row.raw ?? {}) as Record<string, string>;
      const ground = row.rejectionGround!;
      return [
        String(row.rowNumber),
        ground,
        labels.ground(ground),
        labels.action(REJECTION_ACTION[ground]),
        ...headers.map((header) => raw[header] ?? ""),
      ];
    }),
  ]);

  return {
    filename: `run-${run.number}-${run.source.toLowerCase()}-rejects.csv`,
    body,
  };
}

export { REVERSIBLE_DAYS };
