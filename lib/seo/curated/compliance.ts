import "server-only";
import { prisma } from "@/lib/db/client";
import { formatDuration } from "@/lib/format/date";
import { VERIFIED_TIER } from "@/lib/verification";
import { MAX_REPLY_MS, MIN_REVIEWS } from "./criteria";

/**
 * Board 6b §3 — the nightly job that changes nothing the reader sees.
 *
 * *"A nightly compliance job compares live data to the snapshot and writes drift
 * to an editorial queue on `6f`, with the member, the criterion, and the delta.
 * It changes nothing the reader sees."*
 *
 * That last sentence is the design, not a limitation. The obvious job — drop the
 * member who slipped, reorder the rest — keeps the data true and makes the copy
 * false: entry 03's prose reads "slower to reply than the two above", the
 * `BEST FOR:` lines were chosen so twelve recommendations do not overlap, and
 * the numerals are editorial. Automated reordering corrupts prose no automated
 * process can rewrite.
 *
 * So this job writes rows a person reads. Two things do act automatically, and
 * both are deliberate:
 *
 *   - a **lapsed licence** is suppressed in the build by `read.ts`, because that
 *     is the one failure that makes the page's claim false rather than stale;
 *   - a list **past its re-audit SLA with drift outstanding** unpublishes,
 *     because an unaudited curated list is worth less than no curated list. It
 *     does not render a stale-data warning — a page that says "some of this may
 *     be out of date" is worse than absent.
 *
 * Not audited, the same call `sweepAreaPages` and `runDunning` make: this is the
 * platform following its own published rule rather than a staff decision, and
 * `AuditEvent.actorId` is NOT NULL because the log records decisions.
 */

export interface ComplianceResult {
  checked: number;
  /** Rows written to the queue board 6f works. */
  drifted: { slug: string; businessId: string; criterion: string }[];
  /** Lists that ran past the SLA with drift outstanding and came down. */
  unpublished: { slug: string; reason: "sla_expired" }[];
  /** Lists whose build has dropped a member for a lapsed licence. */
  entriesRemoved: { slug: string; businessId: string }[];
}

export async function sweepCuratedLists(now = new Date()): Promise<ComplianceResult> {
  const lists = await prisma.curatedList.findMany({
    where: { publishedAt: { not: null } },
    select: {
      id: true,
      slug: true,
      entryRemovedAt: true,
      title: true,
      reauditDueAt: true,
      publishedAt: true,
      members: {
        orderBy: { position: "asc" },
        select: {
          businessId: true,
          position: true,
          snapResponseMs: true,
          snapReviewCount: true,
          business: {
            select: {
              displayName: true,
              verificationTier: true,
              responseTimeMedianMs: true,
              reviews: { where: { removedAt: null, heldAt: null }, select: { id: true } },
            },
          },
        },
      },
    },
  });

  const result: ComplianceResult = {
    checked: lists.length,
    drifted: [],
    unpublished: [],
    entriesRemoved: [],
  };

  for (const list of lists) {
    let openDrift = 0;
    let lapsed = false;

    for (const member of list.members) {
      const live = member.business;

      /*
         A lapse is not queued. `read.ts` has already dropped this entry from
         what the reader gets; what is recorded here is that the hero owes a
         removal date, which is the ugly signal that pushes editorial to
         re-audit rather than sit.
      */
      if (live.verificationTier < VERIFIED_TIER) {
        lapsed = true;
        result.entriesRemoved.push({ slug: list.slug, businessId: member.businessId });
        continue;
      }

      const reply = live.responseTimeMedianMs;
      if (reply !== null && reply > MAX_REPLY_MS) {
        openDrift += 1;
        if (
          await record(list.id, member.businessId, "reply", {
            snapshot: formatDuration(member.snapResponseMs),
            live: formatDuration(reply),
          })
        ) {
          result.drifted.push({ slug: list.slug, businessId: member.businessId, criterion: "reply" });
        }
      }

      const reviews = live.reviews.length;
      if (reviews < MIN_REVIEWS) {
        openDrift += 1;
        if (
          await record(list.id, member.businessId, "reviews", {
            snapshot: `${member.snapReviewCount}`,
            live: `${reviews}`,
          })
        ) {
          result.drifted.push({
            slug: list.slug,
            businessId: member.businessId,
            criterion: "reviews",
          });
        }
      }
    }

    /*
       Board 6f criterion 13 — the computed order has left the written one.

       `6b`'s prose is frozen: "slower to reply than the two above" is a
       sentence about position, and the ranking behind it recomputes nightly.
       When a supplier overtakes the one written above them the sentence becomes
       false, and the only two ways out are to rewrite it or to flag it. This
       flags it. Nothing here reorders a list or touches a word of it — a
       machine rewriting a human's editorial judgement is the failure `6b`'s
       whole snapshot model was built to avoid.

       Compared on reply time, because that is what the prose is about. Ties
       keep their audited order, so an unmeasured pair never reports a move.
    */
    const ranked = [...list.members].sort(
      (a, b) =>
        (a.business.responseTimeMedianMs ?? Number.MAX_SAFE_INTEGER) -
          (b.business.responseTimeMedianMs ?? Number.MAX_SAFE_INTEGER) || a.position - b.position,
    );
    for (const [index, member] of ranked.entries()) {
      if (index === member.position) continue;
      openDrift += 1;
      if (
        await record(list.id, member.businessId, "order", {
          snapshot: `${member.position + 1}`,
          live: `${index + 1}`,
        })
      ) {
        result.drifted.push({ slug: list.slug, businessId: member.businessId, criterion: "order" });
      }
    }

    if (lapsed && list.entryRemovedAt === null) {
      await prisma.curatedList.update({
        where: { id: list.id },
        data: { entryRemovedAt: now },
      });
    }

    /*
       The SLA, and it only bites where there is something to re-audit for.

       A list whose snapshot is old but whose members all still pass is stale in
       the calendar sense and true in every sense a reader cares about. Taking
       it down would cost the reader a good page to satisfy a date.
    */
    const overdue = list.reauditDueAt !== null && list.reauditDueAt <= now;
    if (overdue && (openDrift > 0 || lapsed)) {
      await prisma.curatedList.update({
        where: { id: list.id },
        data: { publishedAt: null },
      });
      result.unpublished.push({ slug: list.slug, reason: "sla_expired" });
    }
  }

  return result;
}

/** One open row per member per criterion. Returns whether it wrote a new one. */
async function record(
  listId: string,
  businessId: string,
  criterion: string,
  values: { snapshot: string; live: string },
): Promise<boolean> {
  const open = await prisma.curatedListDrift.findFirst({
    where: { listId, businessId, criterion, resolvedAt: null },
    select: { id: true, liveValue: true },
  });

  if (open) {
    // The row is a queue item, not a history: it says what is wrong now. Only
    // a re-audit closes it, so a figure that keeps sliding updates in place
    // rather than filing a second row about the same member.
    if (open.liveValue !== values.live) {
      await prisma.curatedListDrift.update({
        where: { id: open.id },
        data: { liveValue: values.live },
      });
    }
    return false;
  }

  await prisma.curatedListDrift.create({
    data: {
      listId,
      businessId,
      criterion,
      snapshotValue: values.snapshot,
      liveValue: values.live,
    },
  });
  return true;
}

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
