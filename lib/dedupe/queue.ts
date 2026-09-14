import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";
import { dubaiDayStart } from "@/lib/format";
import { resolveEnquiryArea } from "@/lib/enquiry/area";
import { chooseParent, pairHint, type PairHint } from "./match";
import { listingFacts, type ListingFacts } from "./service";
import type { Band, Bands, Signal } from "./similarity";
import { readBands } from "./source";

/**
 * Board 12b — what the dedupe screen reads.
 *
 * Every figure is a count of rows: the header's pairs, the bulk button's
 * number, the manual queue's "Pair 1 of 432", the under-the-floor figure and
 * the today rail, which reads the audit log rather than a counter (B6).
 */

/** A pair still waiting, as every reader and writer agrees to define it. */
export const PENDING = { state: "pending", mergeId: null, dismissedAt: null } as const satisfies Prisma.MergeCandidateWhereInput;

export interface QueueFilter {
  runId?: string | null;
}

export interface DedupeCounts {
  bands: Bands;
  pending: number;
  certain: number;
  probable: number;
  /** Near misses under the floor in runs still open (B10). */
  belowFloor: number;
}

export async function dedupeCounts(filter: QueueFilter = {}): Promise<DedupeCounts> {
  const where = { ...PENDING, ...(filter.runId ? { sourceRunId: filter.runId } : {}) };
  const [bands, grouped, runs] = await Promise.all([
    readBands(),
    prisma.mergeCandidate.groupBy({ by: ["band"], where, _count: { _all: true } }),
    prisma.licenceImportRun.aggregate({
      where: filter.runId ? { id: filter.runId } : { status: { in: ["staged", "approved"] } },
      _sum: { belowFloorCount: true },
    }),
  ]);
  const of = (band: Band) => grouped.find((row) => row.band === band)?._count._all ?? 0;
  return {
    bands,
    pending: of("certain") + of("probable"),
    certain: of("certain"),
    probable: of("probable"),
    belowFloor: runs._sum.belowFloorCount ?? 0,
  };
}

/* ── One pair, drawn ─────────────────────────────────────────────────────── */

export interface PairSide {
  kind: "listing" | "record";
  /** Listing or staged record id. */
  id: string;
  /** `displayName` for a listing; the name on the licence for a record. */
  name: string;
  claimed: boolean;
  paying: boolean;
  planName: string | null;
  subscriptionStatus: string | null;
  reviews: number;
  rating: number | null;
  products: number;
  enquiries: number;
  licenceNumber: string | null;
  authority: string | null;
  address: string | null;
  areaId: string | null;
  emirate: string | null;
  phone: string | null;
  slug: string | null;
  runNumber: number | null;
  rowNumber: number | null;
}

export interface PairView {
  id: string;
  score: number;
  band: Band;
  signals: Signal[];
  kind: "listing" | "record";
  /** Record A: the side B1 keeps. */
  a: PairSide;
  b: PairSide;
  bothClaimed: boolean;
  hint: PairHint;
  /** Where a record's branch would go: the area the register's text resolves to. */
  resolvedAreaId: string | null;
  areaOptions: { id: string; name: string }[];
}

export interface ManualQueue {
  total: number;
  position: number;
  pair: PairView | null;
}

/**
 * The manual band, one pair at a time, in the order it is worked: strongest
 * first, then oldest, then id — a total order, so J and K always land on the
 * same neighbour.
 */
export async function manualQueue(filter: QueueFilter & { position?: number }): Promise<ManualQueue> {
  const where = {
    ...PENDING,
    band: "probable" as const,
    ...(filter.runId ? { sourceRunId: filter.runId } : {}),
  };
  const total = await prisma.mergeCandidate.count({ where });
  if (total === 0) return { total: 0, position: 0, pair: null };

  const position = Math.min(Math.max(filter.position ?? 1, 1), total);
  const [row] = await prisma.mergeCandidate.findMany({
    where,
    orderBy: [{ score: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    skip: position - 1,
    take: 1,
    select: { id: true },
  });
  return { total, position, pair: row ? await pairView(row.id) : null };
}

export async function pairView(candidateId: string): Promise<PairView | null> {
  const pair = await prisma.mergeCandidate.findUnique({
    where: { id: candidateId },
    select: {
      id: true,
      keepId: true,
      absorbId: true,
      score: true,
      band: true,
      signals: true,
      stagedListing: {
        select: {
          id: true,
          rowNumber: true,
          tradeName: true,
          licenceNumber: true,
          licenceAuthority: true,
          emirate: true,
          areaName: true,
          phone: true,
          run: { select: { number: true, source: true } },
        },
      },
    },
  });
  if (!pair) return null;

  const ids = [pair.keepId, ...(pair.absorbId ? [pair.absorbId] : [])];
  const [facts, places] = await Promise.all([
    listingFacts(prisma, ids),
    prisma.location.findMany({
      where: { businessId: { in: ids } },
      // A live location before a held one: a branch waiting on its owner is not
      // the address a listing is known by.
      orderBy: [{ published: "desc" }, { createdAt: "asc" }, { id: "asc" }],
      select: { businessId: true, addressLine: true, phone: true, areaId: true, emirate: true, area: { select: { name: true } } },
    }),
  ]);

  const listingSide = (f: ListingFacts): PairSide => {
    const first = places.find((place) => place.businessId === f.id);
    return {
      kind: "listing",
      id: f.id,
      name: f.displayName,
      claimed: f.claimed,
      paying: f.paying,
      planName: f.planName,
      subscriptionStatus: f.subscriptionStatus,
      reviews: f.reviews,
      rating: f.rating,
      products: f.products,
      enquiries: f.enquiries,
      licenceNumber: f.licenceNumber,
      authority: f.licenceAuthority,
      address: first ? [first.area.name, first.addressLine].filter(Boolean).join(", ") : null,
      areaId: first?.areaId ?? null,
      emirate: first?.emirate ?? null,
      phone: first?.phone ?? null,
      slug: f.slug,
      runNumber: null,
      rowNumber: null,
    };
  };

  const keep = facts.get(pair.keepId)!;
  let a = listingSide(keep);
  let b: PairSide;
  let bothClaimed = false;
  let resolvedAreaId: string | null = null;
  let areaOptions: { id: string; name: string }[] = [];

  if (pair.stagedListing) {
    const record = pair.stagedListing;
    const areas = await prisma.area.findMany({
      where: record.emirate ? { emirate: record.emirate as never } : {},
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true, emirate: true },
    });
    resolvedAreaId = resolveEnquiryArea(record.areaName, record.emirate, areas);
    areaOptions = areas.map((area) => ({ id: area.id, name: area.name }));
    b = {
      kind: "record",
      id: record.id,
      name: record.tradeName ?? "",
      claimed: false,
      paying: false,
      planName: null,
      subscriptionStatus: null,
      reviews: 0,
      rating: null,
      products: 0,
      enquiries: 0,
      licenceNumber: record.licenceNumber,
      authority: record.licenceAuthority ?? record.run.source,
      address: record.areaName,
      areaId: resolvedAreaId,
      emirate: record.emirate,
      phone: record.phone,
      slug: null,
      runNumber: record.run.number,
      rowNumber: record.rowNumber,
    };
  } else {
    const absorb = facts.get(pair.absorbId!)!;
    const choice = chooseParent(keep, absorb);
    bothClaimed = choice.kind === "both_claimed";
    // Record A is always the side that survives, whichever way the scan
    // stored the pair (B1).
    const [left, right] = choice.kind === "parent" && choice.parentId === absorb.id ? [absorb, keep] : [keep, absorb];
    a = listingSide(left);
    b = listingSide(right);
  }

  return {
    id: pair.id,
    score: pair.score,
    band: pair.band,
    signals: Array.isArray(pair.signals) ? (pair.signals as unknown as Signal[]) : [],
    kind: pair.stagedListing ? "record" : "listing",
    a,
    b,
    bothClaimed,
    hint: pairHint({ licenceNumber: a.licenceNumber ?? "" }, { licenceNumber: b.licenceNumber ?? "" }),
    resolvedAreaId,
    areaOptions,
  };
}

/* ── The today rail — B6 ─────────────────────────────────────────────────── */

export interface TodayTally {
  reviewed: number;
  merged: number;
  separated: number;
  discarded: number;
  bulkBatches: number;
  bulkPairs: number;
}

const DUBAI_OFFSET_MS = 4 * 3_600_000;

/**
 * What this person decided today, Dubai time, read from the audit log.
 *
 * `dubaiDayStart` is the UTC midnight that names today's Dubai date — the value
 * a `date` column stores — so the instant today began in Dubai is four hours
 * before it.
 */
export async function todayTally(actorId: string, now = new Date()): Promise<TodayTally> {
  const since = new Date(dubaiDayStart(now).getTime() - DUBAI_OFFSET_MS);
  const events = await prisma.auditEvent.findMany({
    where: {
      actorId,
      createdAt: { gte: since },
      action: { in: ["pair_merged", "pair_separated", "pair_discarded", "pairs_bulk_merged"] },
    },
    select: { action: true, after: true },
  });
  const count = (action: string) => events.filter((event) => event.action === action).length;
  const bulk = events.filter((event) => event.action === "pairs_bulk_merged");
  const merged = count("pair_merged");
  const separated = count("pair_separated");
  const discarded = count("pair_discarded");
  return {
    reviewed: merged + separated + discarded,
    merged,
    separated,
    discarded,
    bulkBatches: bulk.length,
    bulkPairs: bulk.reduce((sum, event) => sum + Number((event.after as { merged?: number } | null)?.merged ?? 0), 0),
  };
}

/* ── Decisions that can still be put back ────────────────────────────────── */

export interface ReversibleRow {
  kind: "pair" | "batch" | "merge";
  id: string;
  outcome: "merged" | "separated" | "discarded" | "bulk";
  /** The listing the decision was about, or the batch's size. */
  parentName: string | null;
  otherName: string | null;
  pairs: number;
  reason: string;
  by: string | null;
  decidedAt: Date;
  reversibleUntil: Date;
  ownerConfirmation: string | null;
}

export async function reversibleDecisions(now = new Date(), limit = 50): Promise<ReversibleRow[]> {
  const [pairs, batches, merges] = await Promise.all([
    prisma.mergeCandidate.findMany({
      where: {
        state: { in: ["merged", "separated", "discarded"] },
        batchId: null,
        reversibleUntil: { gte: now },
      },
      orderBy: [{ resolvedAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        state: true,
        resolutionReason: true,
        resolvedAt: true,
        reversibleUntil: true,
        ownerConfirmation: true,
        keep: { select: { displayName: true } },
        absorb: { select: { displayName: true } },
        stagedListing: { select: { tradeName: true } },
        resolvedBy: { select: { fullName: true } },
      },
    }),
    prisma.mergeBatch.findMany({
      where: { reversedAt: null, reversibleUntil: { gte: now } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        reason: true,
        createdAt: true,
        reversibleUntil: true,
        pairCount: true,
        actor: { select: { fullName: true } },
      },
    }),
    // Merges made before pairs carried their own state, or from outside the
    // queue. Still thirty days, still reversible from here.
    prisma.businessMerge.findMany({
      where: { reversedAt: null, reversibleUntil: { gte: now }, batchId: null, candidates: { none: {} } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        reason: true,
        createdAt: true,
        reversibleUntil: true,
        keep: { select: { displayName: true } },
        absorb: { select: { displayName: true } },
        actor: { select: { fullName: true } },
      },
    }),
  ]);

  const rows: ReversibleRow[] = [
    ...pairs.map((pair) => ({
      kind: "pair" as const,
      id: pair.id,
      outcome: pair.state as "merged" | "separated" | "discarded",
      parentName: pair.keep.displayName,
      otherName: pair.absorb?.displayName ?? pair.stagedListing?.tradeName ?? null,
      pairs: 1,
      reason: pair.resolutionReason ?? "",
      by: pair.resolvedBy?.fullName ?? null,
      decidedAt: pair.resolvedAt!,
      reversibleUntil: pair.reversibleUntil!,
      ownerConfirmation: pair.ownerConfirmation,
    })),
    ...batches.map((batch) => ({
      kind: "batch" as const,
      id: batch.id,
      outcome: "bulk" as const,
      parentName: null,
      otherName: null,
      pairs: batch.pairCount,
      reason: batch.reason,
      by: batch.actor.fullName,
      decidedAt: batch.createdAt,
      reversibleUntil: batch.reversibleUntil,
      ownerConfirmation: null,
    })),
    ...merges.map((merge) => ({
      kind: "merge" as const,
      id: merge.id,
      outcome: "merged" as const,
      parentName: merge.keep.displayName,
      otherName: merge.absorb.displayName,
      pairs: 1,
      reason: merge.reason,
      by: merge.actor.fullName,
      decidedAt: merge.createdAt,
      reversibleUntil: merge.reversibleUntil,
      ownerConfirmation: null,
    })),
  ];

  return rows
    .sort((x, y) => y.decidedAt.getTime() - x.decidedAt.getTime() || (x.id < y.id ? 1 : -1))
    .slice(0, limit);
}

/* ── The owner's side — Q2 ───────────────────────────────────────────────── */

export interface OwnerBranch {
  locationId: string;
  areaName: string;
  addressLine: string;
  licenceNumber: string | null;
  published: boolean;
  /** `awaiting`: not live until confirmed. `informed`: live, rejectable. */
  confirmation: "awaiting" | "informed";
  addedAt: Date;
  reversibleUntil: Date | null;
  source: string | null;
}

/**
 * Branches our team added to this listing that the owner has not answered for.
 * Read by the seller's locations page.
 */
export async function ownerBranches(businessId: string, now = new Date()): Promise<OwnerBranch[]> {
  const rows = await prisma.location.findMany({
    where: {
      businessId,
      addedByCandidate: {
        state: "merged",
        OR: [
          { ownerConfirmation: "awaiting" },
          // A live branch stops being rejectable when the decision's window closes.
          { ownerConfirmation: "informed", reversibleUntil: { gte: now } },
        ],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      addressLine: true,
      licenceNumber: true,
      published: true,
      area: { select: { name: true } },
      addedByCandidate: {
        select: {
          ownerConfirmation: true,
          resolvedAt: true,
          reversibleUntil: true,
          sourceRun: { select: { source: true } },
        },
      },
    },
  });
  return rows.map((row) => ({
    locationId: row.id,
    areaName: row.area.name,
    addressLine: row.addressLine,
    licenceNumber: row.licenceNumber,
    published: row.published,
    confirmation: row.addedByCandidate!.ownerConfirmation as "awaiting" | "informed",
    addedAt: row.addedByCandidate!.resolvedAt ?? now,
    reversibleUntil: row.addedByCandidate!.reversibleUntil,
    source: row.addedByCandidate!.sourceRun?.source ?? null,
  }));
}
