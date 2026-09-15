import "server-only";
import type { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { auditScopeFor } from "@/lib/auth/subject";
import type { Actor } from "@/lib/auth/roles";
import { describeChange, describeEntry, parseSubject, type ChangeLine, type DescribedEntry } from "./describe";
import { AUDIT_PAGE_SIZE, decodeCursor, encodeCursor, type AuditFilter, type Cursor } from "./filter";

export { AUDIT_PAGE_SIZE, normaliseAuditFilter, type AuditFilter } from "./filter";

/**
 * Board 4i — reading the log back. Filtered, paged, and exported the same way.
 *
 * **Scope comes first and filters narrow it.** §07: an ops lead reads the whole
 * log, every other staff seat reads their own actions. `auditScopeFor` decides
 * that, and an `actor` filter from a non-ops viewer is ignored rather than
 * honoured — a moderator asking for somebody else's rows gets their own.
 *
 * **Keyset pages, not offsets.** The log only grows, and `OFFSET 40000` reads
 * forty thousand rows to throw them away. Pages walk `(created_at, id)`, which
 * `audit_event_actor_id_created_at_idx` and `audit_event_action_created_at_idx`
 * serve for the two filters people actually use. The "showing 51–100 of 1,204"
 * line is two counts, not arithmetic on a URL a person could edit.
 *
 * **The export carries the filter** (states table, "Log filtered"). It is the
 * same `where`, walked to the end in batches.
 */

function whereFor(actor: Actor, filter: AuditFilter): Prisma.AuditEventWhereInput | null {
  const scope = auditScopeFor(actor);
  if (!scope) return null;
  const where: Prisma.AuditEventWhereInput = {};
  if (scope.kind === "own") where.actorId = scope.actorId;
  else if (filter.actorId) where.actorId = filter.actorId;
  if (filter.action) where.action = filter.action;
  if (filter.subject) {
    where.subject = parseSubject(filter.subject)
      ? filter.subject
      : { startsWith: `${filter.subject}:` };
  }
  return where;
}

/** Rows strictly older than the cursor, in the log's own order. */
function olderThan(cursor: Cursor): Prisma.AuditEventWhereInput {
  return {
    OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }],
  };
}

function newerThan(cursor: Cursor): Prisma.AuditEventWhereInput {
  return {
    OR: [{ createdAt: { gt: cursor.at } }, { createdAt: cursor.at, id: { gt: cursor.id } }],
  };
}

// ── Reading ─────────────────────────────────────────────────────────────────

const ENTRY_SELECT = {
  id: true,
  action: true,
  subject: true,
  reason: true,
  before: true,
  after: true,
  blastRadius: true,
  blastUnit: true,
  createdAt: true,
  actor: { select: { id: true, fullName: true, email: true } },
} as const satisfies Prisma.AuditEventSelect;

type RawEntry = Prisma.AuditEventGetPayload<{ select: typeof ENTRY_SELECT }>;

export interface AuditEntry extends DescribedEntry {
  id: string;
  at: Date;
  actorId: string;
  actorName: string;
  action: string;
  subject: string;
  reason: string;
  blastRadius: number | null;
  blastUnit: string | null;
  before: unknown;
  after: unknown;
  /** Scalar fields that changed, for the table. The export carries both sides whole. */
  change: ChangeLine[];
}

export interface AuditPage {
  entries: AuditEntry[];
  /** Rows matching scope and filter. */
  total: number;
  /** 1-based position of the first row on this page, 0 when there are none. */
  from: number;
  older: string | null;
  newer: string | null;
  scope: "all" | "own";
}

export async function readAuditPage(
  actor: Actor,
  filter: AuditFilter,
  page: { after?: string | null; before?: string | null; size?: number } = {},
): Promise<AuditPage | null> {
  const scope = auditScopeFor(actor);
  const where = whereFor(actor, filter);
  if (!scope || !where) return null;

  const size = Math.min(Math.max(page.size ?? AUDIT_PAGE_SIZE, 1), 200);
  const after = decodeCursor(page.after);
  const before = after ? null : decodeCursor(page.before);

  let rows: RawEntry[];
  if (before) {
    // Walking back towards the newest: read ascending from the cursor, then flip.
    rows = (
      await prisma.auditEvent.findMany({
        where: { AND: [where, newerThan(before)] },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: size + 1,
        select: ENTRY_SELECT,
      })
    ).reverse();
  } else {
    rows = await prisma.auditEvent.findMany({
      where: after ? { AND: [where, olderThan(after)] } : where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: size + 1,
      select: ENTRY_SELECT,
    });
  }

  // The extra row says whether there is more in the direction walked, and is
  // dropped from the end nearest that direction.
  const hasMore = rows.length > size;
  if (hasMore) rows = before ? rows.slice(1) : rows.slice(0, size);

  const first = rows[0];
  const last = rows[rows.length - 1];

  const [total, newerCount] = await Promise.all([
    prisma.auditEvent.count({ where }),
    first
      ? prisma.auditEvent.count({ where: { AND: [where, newerThan({ at: first.createdAt, id: first.id })] } })
      : Promise.resolve(0),
  ]);

  const entries = await describeRows(rows);

  return {
    entries,
    total,
    from: first ? newerCount + 1 : 0,
    older: last && (before ? true : hasMore) ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
    newer: first && newerCount > 0 ? encodeCursor({ at: first.createdAt, id: first.id }) : null,
    scope: scope.kind,
  };
}

/**
 * Every row matching scope and filter, oldest-last, a batch at a time.
 *
 * An async generator so the export route can stream: a year of log is not a
 * string anybody should hold in a function's memory.
 */
export async function* auditRows(
  actor: Actor,
  filter: AuditFilter,
  batch = 1000,
): AsyncGenerator<AuditEntry[]> {
  const where = whereFor(actor, filter);
  if (!where) return;
  let cursor: Cursor | null = null;
  for (;;) {
    const rows: RawEntry[] = await prisma.auditEvent.findMany({
      where: cursor ? { AND: [where, olderThan(cursor)] } : where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: batch,
      select: ENTRY_SELECT,
    });
    if (rows.length === 0) return;
    yield await describeRows(rows);
    if (rows.length < batch) return;
    const last = rows[rows.length - 1]!;
    cursor = { at: last.createdAt, id: last.id };
  }
}

/** The people who appear in this viewer's log, for the actor filter. */
export async function auditActors(actor: Actor): Promise<{ id: string; name: string }[]> {
  const scope = auditScopeFor(actor);
  if (!scope) return [];
  const grouped = await prisma.auditEvent.groupBy({
    by: ["actorId"],
    where: scope.kind === "own" ? { actorId: scope.actorId } : {},
    _count: { _all: true },
  });
  const users = await prisma.user.findMany({
    where: { id: { in: grouped.map((row) => row.actorId) } },
    select: { id: true, fullName: true, email: true },
    orderBy: { id: "asc" },
  });
  return users
    .map((user) => ({ id: user.id, name: user.fullName ?? user.email ?? user.id }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// ── Names ───────────────────────────────────────────────────────────────────

type Resolver = (ids: string[]) => Promise<[string, string][]>;

/**
 * A subject's own name, by type.
 *
 * Seller identity is `displayName` wherever a business is named (CLAUDE.md), and
 * a review, a report, a change request or a claim conflict is named by the
 * business it is about — "removed a review · Gulf Star Auto Spare Parts". A type
 * with no resolver keeps its reference, in mono, which is still greppable.
 */
const RESOLVERS: Record<string, Resolver> = {
  Business: async (ids) =>
    (await prisma.business.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } })).map(
      (row) => [row.id, row.displayName],
    ),
  Review: async (ids) =>
    (
      await prisma.review.findMany({
        where: { id: { in: ids } },
        select: { id: true, business: { select: { displayName: true } } },
      })
    ).map((row) => [row.id, row.business.displayName]),
  ListingChangeRequest: async (ids) =>
    (
      await prisma.listingChangeRequest.findMany({
        where: { id: { in: ids } },
        select: { id: true, business: { select: { displayName: true } } },
      })
    ).map((row) => [row.id, row.business.displayName]),
  SupplierReport: async (ids) =>
    (
      await prisma.supplierReport.findMany({
        where: { id: { in: ids } },
        select: { id: true, subjectBusiness: { select: { displayName: true } } },
      })
    ).map((row) => [row.id, row.subjectBusiness.displayName]),
  ClaimConflict: async (ids) =>
    (
      await prisma.claimConflict.findMany({
        where: { id: { in: ids } },
        select: { id: true, business: { select: { displayName: true } } },
      })
    ).map((row) => [row.id, row.business.displayName]),
  User: async (ids) =>
    (
      await prisma.user.findMany({
        where: { id: { in: ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id)) } },
        select: { id: true, fullName: true, email: true },
      })
    ).map((row) => [row.id, row.fullName ?? row.email ?? row.id]),
  StaffInvite: async (ids) =>
    (await prisma.staffInvite.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } })).map(
      (row) => [row.id, row.email],
    ),
  Category: async (ids) =>
    (await prisma.category.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((row) => [
      row.id,
      row.name,
    ]),
  Guide: async (ids) =>
    (await prisma.guide.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })).map((row) => [
      row.id,
      row.title,
    ]),
  GuideSubject: async (ids) =>
    (await prisma.guideSubject.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(
      (row) => [row.id, row.name],
    ),
  SpecTemplate: async (ids) =>
    (
      await prisma.specTemplate.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, version: true },
      })
    ).map((row) => [row.id, `${row.name} v${row.version}`]),
  ScopeSheetFamily: async (ids) =>
    (await prisma.scopeSheetFamily.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(
      (row) => [row.id, row.name],
    ),
  Plan: async (ids) =>
    (await prisma.plan.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((row) => [
      row.id,
      row.name,
    ]),
  LicenceImportRun: async (ids) =>
    (
      await prisma.licenceImportRun.findMany({ where: { id: { in: ids } }, select: { id: true, filename: true } })
    ).map((row) => [row.id, row.filename]),
  Redirect: async (ids) =>
    (await prisma.redirect.findMany({ where: { id: { in: ids } }, select: { id: true, fromPath: true } })).map(
      (row) => [row.id, row.fromPath],
    ),
};

async function describeRows(rows: RawEntry[]): Promise<AuditEntry[]> {
  const idsByType = new Map<string, Set<string>>();
  for (const row of rows) {
    const ref = parseSubject(row.subject);
    if (!ref || !RESOLVERS[ref.type]) continue;
    const set = idsByType.get(ref.type) ?? new Set<string>();
    set.add(ref.id);
    idsByType.set(ref.type, set);
  }

  const names = new Map<string, string>();
  await Promise.all(
    [...idsByType].map(async ([type, ids]) => {
      try {
        for (const [id, name] of await RESOLVERS[type]!([...ids])) names.set(`${type}:${id}`, name);
      } catch (cause) {
        // A name is a courtesy on top of the reference, never a reason the log
        // cannot be read. The reference still renders.
        console.error("[audit] could not resolve subject names", {
          type,
          cause: cause instanceof Error ? cause.name : "unknown",
        });
      }
    }),
  );

  return rows.map((row) => {
    const actorName = row.actor.fullName ?? row.actor.email ?? row.actor.id;
    const subjectName = names.get(row.subject) ?? null;
    return {
      id: row.id,
      at: row.createdAt,
      actorId: row.actor.id,
      actorName,
      action: row.action,
      subject: row.subject,
      reason: row.reason,
      blastRadius: row.blastRadius,
      blastUnit: row.blastUnit,
      before: row.before,
      after: row.after,
      change: describeChange(row.before, row.after),
      ...describeEntry({
        actorName,
        action: row.action,
        subjectName,
        blastRadius: row.blastRadius,
        blastUnit: row.blastUnit,
      }),
    };
  });
}
