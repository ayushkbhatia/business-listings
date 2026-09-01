import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board 12g — homepage curation.
 *
 * `Category.showOnHome` decides which trades the directory home leads with, and
 * `getHomeCategories` has read it since handoff 1. This is the screen that sets
 * it.
 *
 * The rule worth having: a trade on the home page whose own landing page does
 * not publish is a link to a thin page from the most-linked page on the site.
 * That is refused, and the refusal names the reason — which is the page matrix
 * from step 7a, doing a second job.
 */

export type HomeRefusal = "not_found" | "not_publishable" | "not_a_sector";

export type HomeResult =
  | { ok: true; shown: number }
  | { ok: false; error: HomeRefusal; message: string };

const MESSAGE: Record<HomeRefusal, string> = {
  not_found: "That trade is not here.",
  not_publishable:
    "Its own landing page does not publish yet, so the home page would link to a thin one. Write its intro or wait for the listings.",
  not_a_sector: "Only a top-level trade goes on the home page.",
};

export interface HomeRow {
  id: string;
  name: string;
  slug: string;
  showOnHome: boolean;
  listings: number;
  /** From the same three gates the page matrix uses. */
  publishable: boolean;
}

/**
 * What the home page's "Popular:" chips are currently showing, and what came
 * close.
 *
 * Board 1a puts five search terms under the hero and they are read from
 * `search_query_log` — the top five of the last thirty days that returned
 * something. Nobody chooses them, which is the point: they are what buyers
 * actually typed. But "nobody chooses them" and "nobody can see them" are
 * different things, and until this the only way to know what the most-linked
 * page on the site was recommending was to load it.
 *
 * Read-only, deliberately. A staff pick would make the row a marketing slot and
 * the whole argument for it is that it is not one. What this screen is for is
 * noticing — a term climbing that leads somewhere thin, or a term the directory
 * cannot answer at all, which is the recruitment signal the gap report reads.
 *
 * The zero-result rows are included and marked. They are the ones the home page
 * refuses, and seeing them beside the ones it shows is the whole diagnosis: a
 * term with three hundred searches and no results is a trade to go and sign.
 */
export interface PopularQueryRow {
  query: string;
  searches: number;
  /** False when every search for this term came back empty. */
  answered: boolean;
  /** In the five the home page is rendering right now. */
  onHome: boolean;
}

const POPULAR_WINDOW_DAYS = 30;
const POPULAR_SHOWN = 5;

export async function popularQueryReport(take = 12): Promise<PopularQueryRow[]> {
  const since = new Date(Date.now() - POPULAR_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const grouped = await prisma.searchQueryLog.groupBy({
    by: ["normalised"],
    where: { createdAt: { gte: since } },
    _count: { normalised: true },
    _max: { resultCount: true },
    orderBy: { _count: { normalised: "desc" } },
    take,
  });
  if (grouped.length === 0) return [];

  const spellings = await prisma.searchQueryLog.findMany({
    where: { normalised: { in: grouped.map((row) => row.normalised) } },
    distinct: ["normalised"],
    orderBy: { createdAt: "desc" },
    select: { normalised: true, query: true },
  });
  const bySpelling = new Map(spellings.map((row) => [row.normalised, row.query]));

  /*
     `onHome` is computed the same way the page computes it rather than by
     taking the first five of this list — the page filters to answered terms
     first and then takes five, so a list that marked the top five outright
     would disagree with the page the moment an unanswerable term ranked.
  */
  const shown = new Set(
    grouped
      .filter((row) => (row._max.resultCount ?? 0) > 0)
      .slice(0, POPULAR_SHOWN)
      .map((row) => row.normalised),
  );

  return grouped.map((row) => ({
    query: bySpelling.get(row.normalised) ?? row.normalised,
    searches: row._count.normalised,
    answered: (row._max.resultCount ?? 0) > 0,
    onHome: shown.has(row.normalised),
  }));
}

export async function homeCandidates(): Promise<HomeRow[]> {
  const { pageMatrix } = await import("./matrix");
  const [matrix, categories] = await Promise.all([
    pageMatrix(),
    prisma.category.findMany({
      where: { parentId: null },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true, slug: true, showOnHome: true },
    }),
  ]);

  return categories.map((category) => {
    const row = matrix.rows.find((candidate) => candidate.id === category.id);
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      showOnHome: category.showOnHome,
      listings: row?.listings ?? 0,
      publishable: row?.publishable ?? false,
    };
  });
}

export async function setOnHome(
  actor: Actor,
  categoryId: string,
  showOnHome: boolean,
  reason: string,
): Promise<HomeResult> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, parentId: true, showOnHome: true },
  });
  if (!category) return { ok: false, error: "not_found", message: MESSAGE.not_found };
  if (category.parentId !== null) {
    return { ok: false, error: "not_a_sector", message: MESSAGE.not_a_sector };
  }

  if (showOnHome) {
    const candidates = await homeCandidates();
    const row = candidates.find((candidate) => candidate.id === categoryId);
    // Only on the way in. Taking a trade off the home page is always allowed,
    // including one that stopped publishing.
    if (!row?.publishable) {
      return { ok: false, error: "not_publishable", message: MESSAGE.not_publishable };
    }
  }

  const shown = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        subject: `Category:${category.id}`,
        reason,
        tx,
      },
      async () => {
        await tx.category.update({ where: { id: category.id }, data: { showOnHome } });
        const count = await tx.category.count({ where: { showOnHome: true, parentId: null } });
        return {
          result: count,
          before: { showOnHome: category.showOnHome },
          after: { showOnHome, onHome: count },
        };
      },
    ),
  );

  return { ok: true, shown };
}
