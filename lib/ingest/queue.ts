import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { assertCan } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { Prisma } from "@/lib/db/generated/client";
import type { TradeKind } from "@/lib/db/generated/enums";
import { loadTradeKinds } from "@/lib/taxonomy/service";
import { tradeKindOrigin, type TradeKindOrigin } from "@/lib/taxonomy/trade-kind";
import { runCounts } from "./service";

/**
 * Board 12a — the categorisation queue.
 *
 * *"1,208 have a licensed activity we cannot map — they queue for manual
 * categorisation rather than landing in 'Other'."* The importer has staged
 * records `needs_category` since it was built, and nothing anywhere could give
 * one a category: the build plan's "rows staged `needs_category` are terminal".
 *
 * ## Grouped by phrase, not listed by record
 *
 * A licence activity is a registry's legal phrase, and a registry repeats its
 * phrases. The fixture's 1,400 queued records carry five. Working them one
 * record at a time is 1,400 decisions; grouped, it is five, each covering every
 * record — in every open run — that carries the phrase. A record whose phrase
 * is wrong for it is still reachable one at a time from its own page.
 *
 * ## A screen-set decision (B7)
 *
 * The category chosen here resolves `Category.tradeKind`, which decides whether
 * the business gets the goods or the services half of about forty screens. So
 * the resolved kind and where it came from travel with every decision, into
 * the result and into the audit row, and a category whose kind is only
 * inherited has to be confirmed as such before it is applied.
 *
 * ## Remembered
 *
 * B5: a mapping fix must not require the file again. A decision about a phrase
 * can be kept, and staging reads it before the keyword signals — so next
 * month's DED extract arrives with this month's decisions already applied.
 */

/** Runs whose records can still move. */
const OPEN_RUN = ["staged", "approved"] as const;

export interface QueueGroup {
  /** `activityKey`. Empty for records that carried no activity at all. */
  key: string;
  /** The phrase as a registry wrote it. */
  activity: string | null;
  records: number;
  runNumbers: number[];
  /** The three emirates most of these records are in, largest first. */
  emirates: { emirate: string; count: number }[];
  authorities: string[];
  oldestRunAt: Date;
}

export interface QueuePage {
  groups: QueueGroup[];
  /** Distinct phrases matching, across every page. */
  totalGroups: number;
  /** Records matching, across every page. */
  totalRecords: number;
  page: number;
  pageSize: number;
}

export interface QueueFilter {
  runId?: string | null;
  query?: string | null;
  page?: number;
  pageSize?: number;
}

function openRecords(filter: QueueFilter): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`s."disposition" = 'needs_category'`,
    Prisma.sql`r."status"::text IN (${Prisma.join([...OPEN_RUN])})`,
  ];
  if (filter.runId) conditions.push(Prisma.sql`s."run_id" = ${filter.runId}`);
  const query = filter.query?.trim().toLowerCase();
  // `position` rather than LIKE, so a `%` somebody types is a percent sign.
  if (query) conditions.push(Prisma.sql`position(${query} in s."activity_key") > 0`);
  return Prisma.sql`
    SELECT s."activity_key", s."activity", s."emirate",
           COALESCE(NULLIF(upper(btrim(s."licence_authority")), ''), r."source") AS authority,
           r."number", r."created_at" AS run_created_at
      FROM "staged_listing" s
      JOIN "licence_import_run" r ON r."id" = s."run_id"
     WHERE ${Prisma.join(conditions, " AND ")}`;
}

/**
 * The queue, one row per phrase, largest first.
 *
 * Largest first because the queue is worked for throughput: the phrase
 * covering 84 records clears more of the directory's waiting supply than the
 * one covering two, and the oldest-run column is there for the person who
 * needs to work it by age instead.
 */
export async function categorisationQueue(filter: QueueFilter = {}): Promise<QueuePage> {
  const pageSize = Math.min(Math.max(filter.pageSize ?? 50, 1), 200);
  const page = Math.max(filter.page ?? 1, 1);
  const base = openRecords(filter);

  const [totals, rows] = await Promise.all([
    prisma.$queryRaw<{ groups: bigint; records: bigint }[]>`
      SELECT COUNT(DISTINCT q."activity_key") AS groups, COUNT(*) AS records
        FROM (${base}) q`,
    prisma.$queryRaw<
      {
        key: string;
        activity: string | null;
        records: bigint;
        run_numbers: number[];
        oldest: Date;
      }[]
    >`
      SELECT q."activity_key" AS key,
             -- The wording most of these records carry. They differ only in case
             -- and spacing, and the commonest is the one a registry meant.
             mode() WITHIN GROUP (ORDER BY q."activity") AS activity,
             COUNT(*) AS records,
             ARRAY_AGG(DISTINCT q."number" ORDER BY q."number") AS run_numbers,
             MIN(q.run_created_at) AS oldest
        FROM (${base}) q
       GROUP BY q."activity_key"
       ORDER BY COUNT(*) DESC, q."activity_key" ASC
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
  ]);

  const keys = rows.map((row) => row.key);
  const spread =
    keys.length === 0
      ? []
      : await prisma.$queryRaw<{ key: string; emirate: string | null; authority: string; records: bigint }[]>`
          SELECT q."activity_key" AS key, q."emirate", q.authority, COUNT(*) AS records
            FROM (${base}) q
           WHERE q."activity_key" IN (${Prisma.join(keys)})
           GROUP BY 1, 2, 3`;

  const groups = rows.map((row) => {
    const mine = spread.filter((item) => item.key === row.key);
    const byEmirate = new Map<string, number>();
    const byAuthority = new Map<string, number>();
    for (const item of mine) {
      if (item.emirate) byEmirate.set(item.emirate, (byEmirate.get(item.emirate) ?? 0) + Number(item.records));
      byAuthority.set(item.authority, (byAuthority.get(item.authority) ?? 0) + Number(item.records));
    }
    return {
      key: row.key,
      activity: row.activity,
      records: Number(row.records),
      runNumbers: row.run_numbers,
      emirates: [...byEmirate.entries()]
        .map(([emirate, count]) => ({ emirate, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3),
      authorities: [...byAuthority.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([code]) => code)
        .slice(0, 3),
      oldestRunAt: row.oldest,
    };
  });

  return {
    groups,
    totalGroups: Number(totals[0]?.groups ?? 0),
    totalRecords: Number(totals[0]?.records ?? 0),
    page,
    pageSize,
  };
}

/** Records waiting on a category, for a tab badge. One count, no grouping. */
export async function queuedRecordCount(): Promise<number> {
  return prisma.stagedListing.count({
    where: { disposition: "needs_category", run: { status: { in: [...OPEN_RUN] } } },
  });
}

export interface CategoryOption {
  id: string;
  name: string;
  /** Null on a sector. */
  sectorName: string | null;
  kind: TradeKind;
  from: TradeKindOrigin["from"];
  /** The ancestor an inherited kind came from. */
  inheritedFrom: string | null;
}

/**
 * Every category a record can be filed under, with its resolved trade kind.
 *
 * The whole taxonomy, sectors included: the keyword signals file into the six
 * original sectors and every seeded listing sits on one, so refusing a sector
 * here would refuse the categories the importer itself uses.
 */
export async function categoryOptions(): Promise<CategoryOption[]> {
  const [categories, kinds] = await Promise.all([
    prisma.category.findMany({
      select: { id: true, name: true, parentId: true, sortOrder: true },
    }),
    loadTradeKinds(),
  ]);
  const byId = new Map(categories.map((category) => [category.id, category]));

  const sectorOf = (id: string) => {
    let current = byId.get(id);
    for (let depth = 0; depth < 8 && current?.parentId; depth += 1) {
      current = byId.get(current.parentId);
    }
    return current ?? null;
  };

  const sortKey = (id: string, parentId: string | null, name: string) => {
    const sector = sectorOf(id);
    return [sector?.sortOrder ?? 0, sector?.name ?? "", parentId === null ? 0 : 1, name] as const;
  };
  const compare = (a: readonly (string | number)[], b: readonly (string | number)[]) => {
    for (let i = 0; i < a.length; i += 1) {
      if (a[i]! < b[i]!) return -1;
      if (a[i]! > b[i]!) return 1;
    }
    return 0;
  };

  // Sector order, then the sector itself, then its subcategories by name — the
  // order the taxonomy screen reads in, so a person finds a trade where they
  // last saw it.
  return [...categories]
    .sort((a, b) => compare(sortKey(a.id, a.parentId, a.name), sortKey(b.id, b.parentId, b.name)))
    .map((category) => {
      const origin = tradeKindOrigin(kinds, category.id);
      return {
        id: category.id,
        name: category.name,
        sectorName: category.parentId === null ? null : (sectorOf(category.id)?.name ?? null),
        kind: origin.kind,
        from: origin.from,
        inheritedFrom: origin.from === "inherited" ? (byId.get(origin.ancestorId)?.name ?? null) : null,
      };
    });
}

/* ── Categorising ────────────────────────────────────────────────────────── */

/** A single decision may cover this many phrases, or this many records. */
export const MAX_PHRASES = 100;
export const MAX_RECORDS = 500;

export type CategoriseTarget =
  | { kind: "activities"; keys: string[]; runId?: string | null }
  | { kind: "records"; ids: string[] };

export interface CategoriseInput {
  actor: Actor;
  categoryId: string;
  reason: string;
  target: CategoriseTarget;
  /**
   * Keep the decision for future imports, and apply it now to every open record
   * carrying the same phrase — a remembered decision that did not also clear
   * the queue it was made in would leave two answers to one question.
   */
  remember: boolean;
  /**
   * The person has seen that this category's trade kind is inherited rather
   * than set on the category itself. Required when it is (B7).
   */
  confirmInherited: boolean;
}

export type CategoriseResult =
  | {
      ok: true;
      records: number;
      runs: number;
      remembered: number;
      categoryName: string;
      kind: TradeKind;
      from: TradeKindOrigin["from"];
    }
  | {
      ok: false;
      error:
        | "category_not_found"
        | "trade_kind_unset"
        | "trade_kind_unconfirmed"
        | "nothing_to_categorise"
        | "too_many";
      message: string;
    };

/**
 * File records under a category.
 *
 * One audit row per run the decision touches, each with the same written
 * reason, so a run's own history answers "who categorised these, and as what
 * kind of trade" without a search across every other run. A remembered phrase
 * writes its own row as well: it is a decision about files that have not
 * arrived yet, and the log has to hold it apart from the records it cleared
 * today.
 */
export async function categoriseRecords(
  input: CategoriseInput,
  now = new Date(),
): Promise<CategoriseResult> {
  assertCan(input.actor, "queue.decide");
  const { target } = input;
  if (
    (target.kind === "activities" && target.keys.length > MAX_PHRASES) ||
    (target.kind === "records" && target.ids.length > MAX_RECORDS)
  ) {
    return {
      ok: false,
      error: "too_many",
      message: `One decision covers up to ${MAX_PHRASES} phrases or ${MAX_RECORDS} records. Select fewer and apply it again.`,
    };
  }

  const [category, kinds] = await Promise.all([
    prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true, name: true },
    }),
    loadTradeKinds(),
  ]);
  if (!category) {
    return { ok: false, error: "category_not_found", message: "That category is not in the taxonomy." };
  }

  const origin = tradeKindOrigin(kinds, category.id);
  /*
     A kind that reached the root of the tree without finding a value is board
     4d-s's "data defect, not a valid state". Filing records under it would be
     the coin flip B7 is written to prevent, made silently and in bulk.
  */
  if (origin.from === "default") {
    return {
      ok: false,
      error: "trade_kind_unset",
      message: `Nothing above ${category.name} says whether its trade is sold as goods or services. Set the sector's trade kind in the taxonomy first.`,
    };
  }
  if (origin.from === "inherited" && !input.confirmInherited) {
    const ancestor = await prisma.category.findUnique({
      where: { id: origin.ancestorId },
      select: { name: true },
    });
    return {
      ok: false,
      error: "trade_kind_unconfirmed",
      message: `${category.name} has no trade kind of its own and inherits ${origin.kind} from ${ancestor?.name ?? "its sector"}. Confirm that is right for these businesses.`,
    };
  }

  const openRun = { status: { in: [...OPEN_RUN] } };

  // The phrases this decision is about, and whether it reaches past one run.
  let keys: string[] = [];
  let direct: { id: string }[] = [];
  if (target.kind === "records") {
    direct = await prisma.stagedListing.findMany({
      where: { id: { in: target.ids }, disposition: { in: ["ready", "needs_category"] }, run: openRun },
      select: { id: true },
    });
    if (input.remember) {
      keys = (
        await prisma.stagedListing.findMany({
          where: { id: { in: direct.map((row) => row.id) } },
          select: { activityKey: true },
          distinct: ["activityKey"],
        })
      )
        .map((row) => row.activityKey)
        .filter(Boolean);
    }
  } else {
    keys = [...new Set(target.keys)];
  }

  const byPhrase =
    keys.length === 0
      ? []
      : await prisma.stagedListing.findMany({
          where: {
            activityKey: { in: keys },
            disposition: "needs_category",
            run: openRun,
            ...(target.kind === "activities" && target.runId && !input.remember
              ? { runId: target.runId }
              : {}),
          },
          select: { id: true },
        });

  const ids = [...new Set([...direct, ...byPhrase].map((row) => row.id))];
  const rows = await prisma.stagedListing.findMany({
    where: { id: { in: ids } },
    select: { id: true, runId: true, activityKey: true, activity: true, disposition: true },
  });

  if (rows.length === 0) {
    return {
      ok: false,
      error: "nothing_to_categorise",
      message: "Nothing selected is waiting on a category any more. Somebody may have categorised it already.",
    };
  }

  const byRun = new Map<string, typeof rows>();
  for (const row of rows) byRun.set(row.runId, [...(byRun.get(row.runId) ?? []), row]);

  /*
     One phrase per key, worded the way most of its records word it — the
     remembered row is what the queue shows next month, and "general  trading"
     from the one record typed with two spaces is not how anybody wrote it.
  */
  const rememberable = input.remember
    ? keys
        .filter(Boolean)
        .map((key) => {
          const wordings = new Map<string, number>();
          for (const row of rows) {
            if (row.activityKey !== key || !row.activity) continue;
            wordings.set(row.activity, (wordings.get(row.activity) ?? 0) + 1);
          }
          const activity = [...wordings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
          return activity ? { activityKey: key, activity } : null;
        })
        .filter((row): row is { activityKey: string; activity: string } => row !== null)
    : [];

  const after = {
    categoryId: category.id,
    categoryName: category.name,
    tradeKind: origin.kind,
    tradeKindFrom: origin.from,
  };

  const moved = await prisma.$transaction(
    async (tx) => {
      let count = 0;

      for (const [runId, runRows] of byRun) {
        count += await staffMutation(
          {
            actor: input.actor,
            capability: "queue.decide",
            subject: `LicenceImportRun:${runId}`,
            reason: input.reason,
            tx,
          },
          async () => {
            const { count: updated } = await tx.stagedListing.updateMany({
              // Re-checked in the write: a record another person published or
              // re-filed a moment ago is not this decision's to move.
              where: {
                id: { in: runRows.map((row) => row.id) },
                disposition: { in: ["ready", "needs_category"] },
              },
              data: {
                categoryId: category.id,
                categorySource: "staff",
                categorisedById: input.actor.id,
                categorisedAt: now,
                disposition: "ready",
              },
            });

            const counts = await runCounts(tx, runId);
            await tx.licenceImportRun.update({ where: { id: runId }, data: counts });

            return {
              result: updated,
              before: {
                queued: runRows.filter((row) => row.disposition === "needs_category").length,
                activities: [...new Set(runRows.map((row) => row.activity ?? ""))].slice(0, 20),
              },
              after: { ...after, records: updated },
              // B4: this run's records filed by the decision, counted by the
              // updateMany that filed them — not the selection it was given.
              blastRadius: { count: updated, unit: "records" },
            };
          },
        );
      }

      for (const row of rememberable) {
        await staffMutation(
          {
            actor: input.actor,
            capability: "queue.decide",
            subject: `LicenceActivity:${row.activityKey}`,
            reason: input.reason,
            tx,
          },
          async () => {
            const existing = await tx.licenceActivityMapping.findUnique({
              where: { activityKey: row.activityKey },
              select: { categoryId: true },
            });
            await tx.licenceActivityMapping.upsert({
              where: { activityKey: row.activityKey },
              create: {
                activityKey: row.activityKey,
                activity: row.activity,
                categoryId: category.id,
                actorId: input.actor.id,
                reason: input.reason.trim(),
              },
              update: {
                categoryId: category.id,
                actorId: input.actor.id,
                reason: input.reason.trim(),
              },
            });
            return {
              result: null,
              before: { categoryId: existing?.categoryId ?? null },
              after: { ...after, remembered: true },
            };
          },
        );
      }

      return count;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  return {
    ok: true,
    records: moved,
    runs: byRun.size,
    remembered: rememberable.length,
    categoryName: category.name,
    kind: origin.kind,
    from: origin.from,
  };
}

/* ── Remembered decisions ────────────────────────────────────────────────── */

export async function activityMappings(limit = 50) {
  const [rows, total] = await Promise.all([
    prisma.licenceActivityMapping.findMany({
      // Ends on the id: two decisions saved in one transaction share a timestamp.
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        activity: true,
        reason: true,
        updatedAt: true,
        category: { select: { name: true } },
        actor: { select: { fullName: true } },
      },
    }),
    prisma.licenceActivityMapping.count(),
  ]);
  return { rows, total };
}

export type ForgetResult = { ok: true } | { ok: false; error: "not_found"; message: string };

/**
 * Stop applying a remembered decision to future imports.
 *
 * Records it already filed keep their category — they were categorised by a
 * person, and un-filing them would put a decision back in the queue that
 * nobody has said was wrong for those records. Only the next file changes.
 */
export async function forgetActivityMapping(input: {
  actor: Actor;
  mappingId: string;
  reason: string;
}): Promise<ForgetResult> {
  const mapping = await prisma.licenceActivityMapping.findUnique({
    where: { id: input.mappingId },
    select: { id: true, activityKey: true, categoryId: true },
  });
  if (!mapping) {
    return { ok: false, error: "not_found", message: "That decision is no longer remembered." };
  }

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "queue.decide",
        subject: `LicenceActivity:${mapping.activityKey}`,
        reason: input.reason,
        tx,
      },
      async () => {
        await tx.licenceActivityMapping.delete({ where: { id: mapping.id } });
        return {
          result: null,
          before: { categoryId: mapping.categoryId, remembered: true },
          after: { remembered: false },
        };
      },
    ),
  );

  return { ok: true };
}
