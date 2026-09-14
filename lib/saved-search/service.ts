import "server-only";
import { prisma } from "@/lib/db/client";
import type { SavedSearchCadence } from "@/lib/db/generated/client";
import { resolveNotificationSenders } from "@/lib/notify/senders";
import { absoluteUrl } from "@/lib/site";
import { t } from "@/lib/i18n";
import { countMatches, newMatchesSince, tabOf } from "./match";

/**
 * Board 10e — saved searches and their alerts.
 *
 * Every write is scoped by the buyer in its own `where`, never by trusting an id
 * a form posted: a posted id is a value the client chose. No audit rows — a
 * buyer keeping their own view is not a staff decision.
 */

export const CADENCES: readonly SavedSearchCadence[] = ["daily", "weekly", "when_listed"];

export function asCadence(value: unknown): SavedSearchCadence | null {
  return typeof value === "string" && (CADENCES as readonly string[]).includes(value)
    ? (value as SavedSearchCadence)
    : null;
}

/** How long a cadence waits between looks. `when_listed` looks every sweep. */
const CADENCE_MS: Record<SavedSearchCadence, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  when_listed: 0,
};

/** A little under the period, so an hourly sweep that lands a minute early does not skip a day. */
const SLACK_MS = 30 * 60 * 1000;

export type SaveSearchOutcome = { ok: true; id: string; zeroResult: boolean; created: boolean };

/**
 * Keep a search.
 *
 * **Zero-result is decided here, by counting** (`B6`), not taken from the page:
 * the flag is what board 12d recruits against, and a flag a form could set is a
 * flag anybody could use to invent demand. A search with nothing behind it
 * defaults to *when listed*; anything else to weekly.
 *
 * Saving the same search twice is one row, not two. The second save refreshes
 * the name and leaves the cadence and counters alone.
 */
export async function saveSearchFor(input: {
  userId: string;
  name: string;
  query: string;
  categoryId?: string | null;
}): Promise<SaveSearchOutcome> {
  const query = input.query.replace(/^\?/, "").slice(0, 500);
  const name = input.name.trim().slice(0, 120) || t("saved.untitled");
  const category = input.categoryId
    ? await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } })
    : null;
  const categoryId = category?.id ?? null;
  const tab = tabOf(query);

  const existing = await prisma.savedSearch.findFirst({
    where: { userId: input.userId, query, categoryId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, zeroResult: true },
  });
  if (existing) {
    await prisma.savedSearch.update({ where: { id: existing.id }, data: { name } });
    return { ok: true, id: existing.id, zeroResult: existing.zeroResult, created: false };
  }

  const zeroResult = (await countMatches({ query, categoryId, tab })) === 0;
  const created = await prisma.savedSearch.create({
    data: {
      userId: input.userId,
      name,
      query,
      categoryId,
      tab,
      zeroResult,
      cadence: zeroResult ? "when_listed" : "weekly",
    },
    select: { id: true },
  });
  return { ok: true, id: created.id, zeroResult, created: true };
}

/**
 * `B7` — the buyer opened it. The new-match count starts again from now.
 *
 * Returns where to send them: the category page it was saved on, else the
 * results page, carrying the query exactly as it was.
 */
export async function openSavedSearch(userId: string, id: string, now: Date = new Date()): Promise<string | null> {
  const search = await prisma.savedSearch.findFirst({
    where: { id, userId },
    select: { id: true, query: true, category: { select: { slug: true } } },
  });
  if (!search) return null;

  await prisma.savedSearch.updateMany({
    where: { id: search.id, userId },
    data: { lastSeenAt: now, newCount: 0, alertedCount: 0 },
  });

  return savedSearchHref(search.query, search.category?.slug ?? null);
}

export function savedSearchHref(query: string, categorySlug: string | null): string {
  const base = categorySlug ? `/c/${categorySlug}` : "/search";
  return query ? `${base}?${query}` : base;
}

/** Cadence changes take effect on the next run; `newCount` is not reset by one. */
export async function setCadence(userId: string, id: string, cadence: SavedSearchCadence): Promise<boolean> {
  const { count } = await prisma.savedSearch.updateMany({ where: { id, userId }, data: { cadence } });
  return count === 1;
}

export async function forgetSavedSearch(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.savedSearch.deleteMany({ where: { id, userId } });
  return count === 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// The sweep
// ─────────────────────────────────────────────────────────────────────────────

export interface SavedSearchSweep {
  looked: number;
  withNew: number;
  alerted: number;
}

/**
 * Look for new matches on every saved search that is due, and email the buyer
 * when there are more than the last email said.
 *
 * Due is per cadence, measured from `lastRunAt`. Bounded per run and oldest
 * first, so a backlog clears over successive runs rather than timing one out.
 *
 * **The alert email does not clear the count** (`B7`) — only opening the search
 * does. `alertedCount` is what stops a daily run that finds the same four
 * matches emailing about them four days running: an email goes out only when
 * the count has grown past what was last sent. A search that has never matched
 * stays subscribed and is never deleted — it is the demand record 12d reads.
 */
export async function sweepSavedSearches(now: Date = new Date(), limit = 200): Promise<SavedSearchSweep> {
  const due = await prisma.savedSearch.findMany({
    where: {
      OR: [
        { lastRunAt: null },
        { cadence: "when_listed" },
        { cadence: "daily", lastRunAt: { lte: new Date(now.getTime() - CADENCE_MS.daily + SLACK_MS) } },
        { cadence: "weekly", lastRunAt: { lte: new Date(now.getTime() - CADENCE_MS.weekly + SLACK_MS) } },
      ],
    },
    orderBy: [{ lastRunAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      name: true,
      query: true,
      tab: true,
      categoryId: true,
      createdAt: true,
      lastSeenAt: true,
      zeroResult: true,
      lastMatchAt: true,
      alertedCount: true,
      user: { select: { email: true, suspendedAt: true } },
    },
  });

  const email = resolveNotificationSenders().email;
  const result: SavedSearchSweep = { looked: 0, withNew: 0, alerted: 0 };

  for (const search of due) {
    const since = search.lastSeenAt ?? search.createdAt;
    const scope = {
      query: search.query,
      categoryId: search.categoryId,
      tab: search.tab === "products" ? ("products" as const) : ("businesses" as const),
    };
    const { count, newestAt } = await newMatchesSince(scope, since);
    /*
       A search saved with nothing behind it stops waiting once it matches
       anything, not only once something is new since the buyer last looked. A
       listing published before they opened the search — and before this run —
       is never "new since", and without this the search would read *nothing
       exists yet* and count as demand in the CRM for good.
    */
    const stillWaiting = search.zeroResult && search.lastMatchAt === null;
    const matchedAt = newestAt ?? (stillWaiting && (await countMatches(scope)) > 0 ? now : null);
    result.looked += 1;
    if (count > 0) result.withNew += 1;

    let alertedCount = search.alertedCount;
    if (count > search.alertedCount && email && search.user.email && !search.user.suspendedAt) {
      const sent = await email
        .send({
          channel: "email",
          to: search.user.email,
          subject: t("saved.email.subject", { count, name: search.name }),
          body: t("saved.email.body", { count, name: search.name }),
          actionLabel: t("saved.email.cta"),
          actionUrl: absoluteUrl("/account/saved"),
        })
        .catch(() => ({ delivered: false }));
      if (sent.delivered) {
        alertedCount = count;
        result.alerted += 1;
      }
    }

    await prisma.savedSearch.update({
      where: { id: search.id },
      data: {
        lastRunAt: now,
        newCount: count,
        alertedCount: Math.min(alertedCount, count),
        ...(matchedAt ? { lastMatchAt: matchedAt } : {}),
      },
    });
  }

  return result;
}

export interface SavedSearchView {
  id: string;
  name: string;
  href: string;
  cadence: SavedSearchCadence;
  zeroResult: boolean;
  /** Still nothing listed since it was saved with nothing — the *nothing exists yet* row. */
  stillEmpty: boolean;
  newCount: number;
  /** What `newCount` counts from — the last look, or when it was saved. */
  countingFrom: Date;
  createdAt: Date;
}

/** A buyer's saved searches, newest first. `take` for the inbox's three-row summary. */
export async function savedSearchesFor(userId: string, options: { take?: number } = {}): Promise<SavedSearchView[]> {
  const rows = await prisma.savedSearch.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...(options.take ? { take: options.take } : {}),
    select: {
      id: true,
      name: true,
      query: true,
      cadence: true,
      zeroResult: true,
      newCount: true,
      lastSeenAt: true,
      lastMatchAt: true,
      createdAt: true,
      category: { select: { slug: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    href: savedSearchHref(row.query, row.category?.slug ?? null),
    cadence: row.cadence,
    zeroResult: row.zeroResult,
    stillEmpty: row.zeroResult && row.lastMatchAt === null,
    newCount: row.newCount,
    countingFrom: row.lastSeenAt ?? row.createdAt,
    createdAt: row.createdAt,
  }));
}
