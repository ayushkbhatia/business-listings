import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * The read side of board 6b's compliance model — the queues board 6f renders.
 *
 * A file of its own, and not tidiness. `compliance.ts` holds the nightly sweep,
 * which unpublishes lists and is deliberately unaudited: it is the platform
 * following its own published rule, there is no actor to attribute it to, and
 * `AuditEvent.actorId` is NOT NULL because the log records decisions. The
 * moment the admin console imported anything from that file,
 * `check:audit-coverage` correctly refused it — a module reachable from the
 * console that mutates without an audit row is exactly what that scan exists to
 * catch, and the right answer is for the console to import the reads rather
 * than for the sweep to grow a synthetic actor.
 */

/** The open queue, for board 6f. Oldest first — that is the order to work it. */
export async function driftQueue(): Promise<
  {
    listSlug: string;
    listTitle: string;
    displayName: string;
    criterion: string;
    snapshotValue: string;
    liveValue: string;
    detectedAt: Date;
  }[]
> {
  const rows = await prisma.curatedListDrift.findMany({
    where: { resolvedAt: null },
    orderBy: { detectedAt: "asc" },
    select: {
      criterion: true,
      snapshotValue: true,
      liveValue: true,
      detectedAt: true,
      list: { select: { slug: true, title: true } },
      business: { select: { displayName: true } },
    },
  });

  return rows.map((row) => ({
    listSlug: row.list.slug,
    listTitle: row.list.title,
    displayName: row.business.displayName,
    criterion: row.criterion,
    snapshotValue: row.snapshotValue,
    liveValue: row.liveValue,
    detectedAt: row.detectedAt,
  }));
}

/**
 * Lists a person owes a re-audit — board 6f's third queue.
 *
 * Two populations, and they are the same job. A published list past its SLA
 * whose members all still pass is stale in the calendar sense and true in every
 * sense a reader cares about, so the sweep leaves it up; it still needs somebody
 * to look. A list the sweep has already taken down needs somebody rather more.
 * A queue that showed only one of the two would either hide the pages that are
 * dark or hide the ones about to be.
 */
export async function reauditQueue(now = new Date()): Promise<
  {
    slug: string;
    title: string;
    dueAt: Date;
    /** Down already, or still up and overdue. */
    state: "unpublished" | "overdue";
    openDrift: number;
    entryRemovedAt: Date | null;
  }[]
> {
  const lists = await prisma.curatedList.findMany({
    where: { reauditDueAt: { not: null, lte: now } },
    orderBy: { reauditDueAt: "asc" },
    select: {
      id: true,
      slug: true,
      title: true,
      reauditDueAt: true,
      publishedAt: true,
      entryRemovedAt: true,
      _count: { select: { drift: { where: { resolvedAt: null } } } },
    },
  });

  return lists.map((list) => ({
    slug: list.slug,
    title: list.title,
    dueAt: list.reauditDueAt as Date,
    state: list.publishedAt === null ? ("unpublished" as const) : ("overdue" as const),
    openDrift: list._count.drift,
    entryRemovedAt: list.entryRemovedAt,
  }));
}

/**
 * Every curated list with its audit state — the working list board 6f links to.
 *
 * Read-only. The editor itself is out of scope for 6f, which scopes the tab and
 * not the screen behind it; what this owes the queues is somewhere a row can
 * open that shows the list, when it was audited, when it is next due and what
 * is outstanding against it.
 */
export async function curatedListIndex(now = new Date()): Promise<
  {
    id: string;
    slug: string;
    title: string;
    categoryName: string;
    members: number;
    published: boolean;
    auditedAt: Date | null;
    dueAt: Date | null;
    overdue: boolean;
    openDrift: number;
    entryRemovedAt: Date | null;
  }[]
> {
  const lists = await prisma.curatedList.findMany({
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { title: "asc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      publishedAt: true,
      auditedAt: true,
      reauditDueAt: true,
      entryRemovedAt: true,
      category: { select: { name: true } },
      _count: { select: { members: true, drift: { where: { resolvedAt: null } } } },
    },
  });

  return lists.map((list) => ({
    id: list.id,
    slug: list.slug,
    title: list.title,
    categoryName: list.category.name,
    members: list._count.members,
    published: list.publishedAt !== null,
    auditedAt: list.auditedAt,
    dueAt: list.reauditDueAt,
    overdue: list.reauditDueAt !== null && list.reauditDueAt <= now,
    openDrift: list._count.drift,
    entryRemovedAt: list.entryRemovedAt,
  }));
}
