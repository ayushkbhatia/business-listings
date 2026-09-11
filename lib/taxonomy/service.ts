import "server-only";
import { prisma } from "@/lib/db/client";
import { unstable_cache } from "next/cache";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import {
  countWords,
  DEFAULT_THRESHOLDS,
  evaluatePublish,
  type PublishDecision,
  type PublishThresholds,
} from "@/lib/publish-threshold";
import { VERIFIED_TIER } from "@/lib/verification";
import type { Prisma, PrismaClient } from "@/lib/db/generated/client";
import type { TradeKind } from "@/lib/db/generated/enums";
import {
  resolveTradeKind,
  tradeKindOrigin,
  type TradeKindOrigin,
  type TradeKindRow,
} from "./trade-kind";

/** Prisma or a transaction, for callers inside a `staffMutation`. */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Board 4d — the taxonomy, and the thresholds that gate landing pages.
 *
 * `Category.publishThreshold` (60) and `Category.verifiedShareMin` (0.30) have
 * existed since handoff 0 and **no code has ever read them**. `evaluatePublish`
 * is correct and unit-tested and is wired only to `app/sitemap.ts` with the
 * hardcoded defaults. This is the screen that makes them mean something.
 *
 * That matters more than it sounds. The floor is what separates a directory
 * from a doorway-page farm — a hundred "Valves in Umm Al Quwain" pages with
 * four listings each teach Google that the site is mostly filler — and a
 * per-category number lets it be a real editorial judgement rather than one
 * constant for six very different trades.
 *
 * `taxonomy.write` is ops lead alone. Renaming a category moves every listing
 * under it and every page built from it.
 */

export interface CategoryHealth extends CategoryRules {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  code: string;
  synonyms: string[];
  /// Words in the landing page's own copy. Nought where there is none.
  introWords: number;
  /** Published listings whose primary category is this one. */
  listings: number;
  /** How many of those are tier 1 or better. */
  verified: number;
  /** Against this category's own thresholds, not the defaults. */
  decision: PublishDecision;
  /**
   * How this trade is sold, and where that answer came from — board `4d-s`.
   *
   * Resolved rather than the raw column, because the raw column is null on
   * most rows and null is not an answer, it is a pointer at the parent. The
   * origin travels with it so the screen can show SET, INHERITED and NOT SET
   * as three different things, which is the only way 440 rows can be triaged.
   */
  trade: TradeKindOrigin;
}

/**
 * Every category with the numbers its own thresholds are judged against.
 *
 * Intro words are not counted here: the copy lives with the landing page, which
 * is handoff 5. `evaluatePublish` takes the count, so passing the threshold as
 * satisfied would be a lie — instead the screen says the word count is not
 * measurable yet, the same way board 4a does for a table that does not exist.
 */
/**
 * Every category, with whether its landing page clears its own floor.
 *
 * `introWords` used to be a parameter defaulting to `MAX_SAFE_INTEGER`, which
 * made the third gate pass vacuously — there was nowhere for a category's copy
 * to live, so there was nothing to count. `Category.intro` is that place now
 * and the count comes from the row rather than from the caller.
 */
export async function categoryHealth(): Promise<CategoryHealth[]> {
  const [categories, counts, verifiedCounts] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ parentId: { sort: "asc", nulls: "first" } }, { sortOrder: "asc" }],
      select: {
        id: true,
        parentId: true,
        name: true,
        slug: true,
        code: true,
        synonyms: true,
        ...CATEGORY_RULES_SELECT,
        intro: true,
        tradeKind: true,
      },
    }),
    prisma.business.groupBy({
      by: ["primaryCategoryId"],
      where: { publishedAt: { not: null }, suspendedAt: null },
      _count: true,
    }),
    prisma.business.groupBy({
      by: ["primaryCategoryId"],
      where: {
        publishedAt: { not: null },
        suspendedAt: null,
        verificationTier: { gte: VERIFIED_TIER },
      },
      _count: true,
    }),
  ]);

  const listings = new Map(counts.map((row) => [row.primaryCategoryId, row._count]));
  const verified = new Map(verifiedCounts.map((row) => [row.primaryCategoryId, row._count]));
  // The same rows this function already loaded, keyed for the inheritance walk.
  // No second query: `tradeKind` rides along in the select above.
  const kinds = new Map(categories.map((row) => [row.id, row]));

  return categories.map((category) => {
    const total = listings.get(category.id) ?? 0;
    const verifiedTotal = verified.get(category.id) ?? 0;
    const introWords = countWords(category.intro);
    return {
      ...category,
      listings: total,
      verified: verifiedTotal,
      introWords,
      decision: evaluatePublish(
        { listings: total, verified: verifiedTotal, introWords },
        thresholdsFor(category),
      ),
      trade: tradeKindOrigin(kinds, category.id),
    };
  });
}

/**
 * The columns that make up one category's publish rules — board 6f §5.
 *
 * Every field the rules panel edits, so a caller that reads a category for the
 * gate is told by the compiler which columns it has to select.
 */
export interface CategoryRules {
  publishThreshold: number;
  verifiedShareMin: number;
  demandPerThousand: number;
  holdShare: number;
  minIntroWords: number;
  minLiveDays: number;
  humanReviewRequired: boolean;
}

export const CATEGORY_RULES_SELECT = {
  publishThreshold: true,
  verifiedShareMin: true,
  demandPerThousand: true,
  holdShare: true,
  minIntroWords: true,
  minLiveDays: true,
  humanReviewRequired: true,
} as const;

/** A category's own floors, which is what the columns are for. */
export function thresholdsFor(category: CategoryRules): PublishThresholds {
  return {
    minListings: category.publishThreshold,
    minVerifiedShare: category.verifiedShareMin,
    // A column since board 6f, which put the word floor on the rules panel
    // beside the other five. It read the module default until then, under a
    // comment saying this board owned it.
    minIntroWords: category.minIntroWords,
    // The FAQ counts stay module-wide. Board 6a states them as one rule for the
    // whole page class rather than per trade, and only the two landing classes
    // pass an FAQ count in for them to apply to at all.
    minFaqRows: DEFAULT_THRESHOLDS.minFaqRows,
    minScopeSpecificFaqRows: DEFAULT_THRESHOLDS.minScopeSpecificFaqRows,
    demandPerThousand: category.demandPerThousand,
    holdShare: category.holdShare,
  };
}

export type TaxonomyResult =
  | { ok: true }
  | {
      ok: false;
      error: "not_found" | "out_of_range" | "slug_taken" | "would_orphan";
      message: string;
    };

export interface EditCategoryInput {
  actor: Actor;
  categoryId: string;
  name?: string;
  synonyms?: string[];
  /**
   * The landing page's own copy — board 6f.
   *
   * Here rather than on a screen of its own, because it goes through the same
   * audited path as the thresholds it is measured against. A paragraph that
   * decides whether a page publishes is a change worth a written reason.
   */
  intro?: string | null;
  reason: string;
}

/*
   The publish rules are no longer editable from here.

   `publishThreshold` and `verifiedShareMin` were fields on this input, written
   by one actor with one reason. Board 6f puts every rule that decides whether a
   page exists behind an impact preview and a second approver, and leaving a
   single-approver path to the same two columns would have made the second
   approver a formality anybody could route around — `/admin/categories` is one
   wired form away from being that route. `lib/content/publish-rule.ts` is the
   only writer now.
*/

/**
 * Edit a category.
 *
 * The slug is deliberately not editable. `docs/routes.md` says slugs are
 * immutable once published and a rename creates a 301 — for a category that is
 * every landing page under it, and the rename is a content-ops operation with
 * its own redirect handling rather than a text field on this screen.
 *
 * Synonyms carry Arabic terms. صمامات must find valve suppliers, and the array
 * is matched exactly rather than fuzzily, so an entry either is or is not in
 * the list — which is why a GIN index over the array is the right shape and why
 * this saves them trimmed and de-duplicated.
 */
export async function editCategory(input: EditCategoryInput): Promise<TaxonomyResult> {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true, name: true, synonyms: true },
  });
  if (!category) {
    return { ok: false, error: "not_found", message: "That category is not in the taxonomy." };
  }

  const synonyms =
    input.synonyms === undefined
      ? undefined
      : [...new Set(input.synonyms.map((s) => s.trim()).filter(Boolean))];

  const before = { name: category.name, synonyms: category.synonyms };

  await prisma.$transaction(async (tx) => {
    await staffMutation(
      {
        actor: input.actor,
        capability: "taxonomy.write",
        subject: `Category:${category.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const after = await tx.category.update({
          where: { id: category.id },
          data: {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(synonyms !== undefined ? { synonyms } : {}),
            // An empty box means no copy, not the string "". A category with
            // an empty intro and one with none are the same page.
            ...(input.intro !== undefined ? { intro: input.intro?.trim() || null } : {}),
          },
          select: { name: true, synonyms: true },
        });
        return { result: true, before, after };
      },
    );
  });

  return { ok: true };
}

/** What a category's landing page would be blocked on, in words. */
export function describeFailure(
  decision: PublishDecision,
): { reason: string; have: number; need: number } | null {
  const first = decision.failures[0];
  if (!first) return null;
  return { reason: first.reason, have: first.have, need: first.need };
}

export { countWords };

/** Whether `id` sits anywhere below `ancestorId`. Bounded, like the resolver. */
function isUnder(rows: ReadonlyMap<string, TradeKindRow>, id: string, ancestorId: string): boolean {
  let current = rows.get(id)?.parentId ?? null;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (current === ancestorId) return true;
    current = rows.get(current)?.parentId ?? null;
  }
  return false;
}

/**
 * Set, override or clear a set of categories in one transaction — board `4d-s`.
 *
 * **B4: "Bulk set is one transaction, and a partial failure rolls back
 * entirely. Seven rows half-set is worse than none."** So every row and every
 * audit event share one transaction: if the fourth refuses, the first three
 * never happened and neither did their log entries.
 *
 * One audit row per category rather than one for the batch, because the log is
 * read per subject — "why does this subcategory render a scope list" is a
 * question about one row, and an answer that only exists as "part of a bulk of
 * seven" cannot be found from the row. The written reason is shared, which is
 * honest: it was one decision.
 *
 * Rows already holding the value are skipped rather than refused. A bulk action
 * over a mixed selection is normal — the design's own state table has "selection
 * includes both set and unset rows" — and failing the batch because one row was
 * already right would make the bulk bar unusable.
 */
export async function setTradeKindBulk(input: {
  actor: Actor;
  categoryIds: readonly string[];
  tradeKind: TradeKind | null;
  reason: string;
}): Promise<TaxonomyResult & { changed?: number }> {
  const ids = [...new Set(input.categoryIds)];
  if (ids.length === 0) {
    return { ok: false, error: "not_found", message: "Nothing was selected." };
  }

  const categories = await prisma.category.findMany({
    where: { id: { in: ids } },
    select: { id: true, tradeKind: true },
  });
  if (categories.length !== ids.length) {
    return {
      ok: false,
      error: "not_found",
      message: "One of those trades is no longer in the taxonomy. Reload and try again.",
    };
  }

  const moving = categories.filter((category) => category.tradeKind !== input.tradeKind);
  if (moving.length === 0) {
    return { ok: false, error: "out_of_range", message: "That is already how those trades are sold." };
  }

  await prisma.$transaction(async (tx) => {
    for (const category of moving) {
      await staffMutation(
        {
          actor: input.actor,
          capability: "taxonomy.write",
          subject: `Category:${category.id}`,
          reason: input.reason,
          tx,
        },
        async () => {
          await tx.category.update({
            where: { id: category.id },
            data: { tradeKind: input.tradeKind },
          });
          return {
            result: null,
            before: { tradeKind: category.tradeKind },
            after: { tradeKind: input.tradeKind },
          };
        },
      );
    }
  });

  return { ok: true, changed: moving.length };
}

/**
 * What a bulk write would move, and what it would touch — board `4d-s` B5/AC5.
 *
 * **"Changing a set subcategory's kind is a consequential write. Confirm with
 * the listing count and name what changes."** Three numbers, because they answer
 * three different questions:
 *
 *   · `rows` — how many categories the click writes to.
 *   · `alsoInheriting` — how many more follow because a sector was selected.
 *     The design's state table asks for this by name: "sector-level change:
 *     confirm with the total affected count, not just the sector name."
 *   · `listings` — how many published businesses render differently afterwards.
 *     A subcategory with 488 listings is a different act from one with 12, and
 *     the number belongs at the moment of the click.
 *
 * A selection touching no listings needs no confirmation at all, which the
 * design also asks for: "a subcategory with zero listings: set freely."
 */
export async function tradeKindBulkImpact(
  categoryIds: readonly string[],
  next: TradeKind | null,
): Promise<{ rows: number; alsoInheriting: number; listings: number }> {
  const ids = [...new Set(categoryIds)];
  if (ids.length === 0) return { rows: 0, alsoInheriting: 0, listings: 0 };

  const rows = await loadTradeKinds();
  const selected = ids.filter((id) => rows.has(id));

  const after = new Map(rows);
  for (const id of selected) {
    const row = after.get(id);
    if (row) after.set(id, { ...row, tradeKind: next });
  }

  const moved: string[] = [];
  for (const row of rows.values()) {
    if (resolveTradeKind(rows, row.id) !== resolveTradeKind(after, row.id)) moved.push(row.id);
  }
  const chosen = new Set(selected);

  /*
     Listings are counted over everything that MOVES, not over what was
     selected. Selecting one sector with no listings of its own can change what
     forty subcategories holding four thousand businesses render, and a
     confirmation quoting zero would be the most misleading number on the screen.
  */
  const counts =
    moved.length === 0
      ? []
      : await prisma.business.groupBy({
          by: ["primaryCategoryId"],
          where: {
            primaryCategoryId: { in: moved },
            publishedAt: { not: null },
            suspendedAt: null,
          },
          _count: true,
        });

  return {
    rows: selected.filter((id) => moved.includes(id)).length,
    alsoInheriting: moved.filter((id) => !chosen.has(id)).length,
    listings: counts.reduce((total, row) => total + row._count, 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Board 4d-s — the trade-kind board
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The resolved map, cached.
 *
 * B2: "Forty screens read this on nearly every request. Resolve once per
 * category at write time or cache the resolved map; do not walk the tree per
 * render." The taxonomy changes a few times a month and is read on nearly every
 * request, which is the shape `unstable_cache` exists for.
 *
 * A `Map` cannot cross the cache boundary — it serialises to `{}` — so the
 * cached value is an array of rows and the map is rebuilt on the near side.
 * Rebuilding 440 entries is microseconds; the query it replaces is a round trip.
 *
 * Invalidated by `TAXONOMY_CACHE_TAG`, from the **action** rather than from
 * here. `revalidateTag` needs a Next request context and throws "Invariant:
 * static generation store missing" without one, so calling it in the service
 * would make this function uncallable from a scheduled job, a script or a test
 * — the same constraint `lib/db/queries/home.ts` documents for the reader side.
 * The service is the domain; the action is the request boundary.
 *
 * A day is the backstop, not the mechanism: if an invalidation is ever missed,
 * the failure is a stale kind for a few hours rather than for ever.
 */
export const TAXONOMY_CACHE_TAG = "taxonomy-trade-kind";

const readTradeKindRows = async (): Promise<TradeKindRow[]> =>
  prisma.category.findMany({ select: { id: true, parentId: true, tradeKind: true } });

const cachedTradeKindRows = unstable_cache(readTradeKindRows, ["taxonomy-trade-kinds"], {
  revalidate: 86_400,
  tags: [TAXONOMY_CACHE_TAG],
});

/**
 * The whole taxonomy's trade kinds, keyed by id. **Uncached.**
 *
 * The reader, and the one every service, job and test calls. `unstable_cache`
 * needs a Next request context and throws "Invariant: incrementalCache missing"
 * without one — the constraint `lib/db/queries/home.ts` documents for its own
 * readers — so the cache cannot be the only way in. Pass a transaction client
 * where a write needs to read its own effect before committing.
 */
export async function loadTradeKinds(db: Db = prisma): Promise<Map<string, TradeKindRow>> {
  const rows = await db.category.findMany({
    select: { id: true, parentId: true, tradeKind: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * The same map, cached. Board `4d-s` B2.
 *
 * "Forty screens read this on nearly every request. Resolve once per category
 * at write time or cache the resolved map; do not walk the tree per render."
 * This is that cache. Today its live reader is the fan-out, which resolves a
 * kind for every enquiry; the rest arrive with the service-track screens.
 *
 * A `Map` cannot cross the cache boundary — it serialises to `{}` — so the
 * cached value is the row array and the map is rebuilt on the near side.
 * Rebuilding 440 entries is microseconds; the query it replaces is a round trip.
 *
 * **Read-through, and deliberately.** `unstable_cache` throws "Invariant:
 * incrementalCache missing" outside a Next request — in a scheduled job, a
 * script, or an integration test — and the correct behaviour there is to read
 * the table, not to fail. So a miss falls back to the query. The cost of the
 * fallback is one round trip, which is exactly what the cache was saving; the
 * cost of not having it would be that no caller outside a request could resolve
 * a trade kind at all.
 *
 * Invalidated from the action, by `TAXONOMY_CACHE_TAG` — `revalidateTag` needs
 * the same request context, so the service cannot do it either.
 */
export async function getTradeKinds(): Promise<Map<string, TradeKindRow>> {
  try {
    const rows = await cachedTradeKindRows();
    return new Map(rows.map((row) => [row.id, row]));
  } catch {
    return loadTradeKinds();
  }
}

/**
 * The kind of one category, for a caller holding an id and no taxonomy.
 *
 * Off the cached map unless a transaction client is passed, because the callers
 * that matter — the fan-out among them — run once per request on a path where a
 * round trip is worth avoiding. A caller resolving more than one id should load
 * the map once and `resolveTradeKind` per id rather than calling this in a loop.
 */
export async function tradeKindFor(categoryId: string, db?: Db): Promise<TradeKind> {
  const rows = db ? await loadTradeKinds(db) : await getTradeKinds();
  return resolveTradeKind(rows, categoryId);
}

/** One row of the board's table. */
export interface TradeKindBoardRow {
  id: string;
  name: string;
  /** Null on a sector, which has no parent to name. */
  sectorName: string | null;
  isSector: boolean;
  trade: TradeKindOrigin;
  /** Published, unsuspended listings filed under this category. */
  listings: number;
  /** Who set it, where somebody did. Null on an inherited or unset row. */
  setBy: string | null;
  setAt: Date | null;
}

export interface TradeKindBoard {
  rows: TradeKindBoardRow[];
  /** Rows answering for themselves. The numerator of the progress figure. */
  decided: number;
  /** Every category. The denominator. */
  total: number;
  /** Resolving through an ancestor that was set. */
  inherited: number;
  /** Reaching the root with nothing set anywhere — AC2's data defect. */
  unset: number;
}

/**
 * Everything the board renders, from one pass over one set of rows.
 *
 * **AC7: "the progress figure and the unset-first sort derive from the same
 * query — they cannot disagree."** So they are computed here together rather
 * than by the page counting one thing and the table sorting another. This
 * project has shipped a header reading `18 OF 22` over a table of 16 rows; the
 * only defence is that both numbers come from one array.
 *
 * **B6: unset first.** An unset row is not neutral — it inherits whatever the
 * sector says, and the sector is wrong about half the time, so an unset row is
 * a place a supplier may be shown the wrong screens. Sorting them to the top is
 * the screen's whole argument. Then inherited, then decided; alphabetical
 * inside each band, so the order is stable between loads.
 */
export async function loadTradeKindBoard(): Promise<TradeKindBoard> {
  const [categories, counts, authors] = await Promise.all([
    prisma.category.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        parentId: true,
        tradeKind: true,
        parent: { select: { name: true } },
      },
    }),
    prisma.business.groupBy({
      by: ["primaryCategoryId"],
      where: { publishedAt: { not: null }, suspendedAt: null },
      _count: true,
    }),
    /*
       The set-by column, read from the audit log rather than from a column on
       the category.

       There is no `tradeKindSetBy` and there should not be: the log already
       records who changed what and why, and a second copy on the row is a
       second thing to keep in step. One query for every category's latest
       taxonomy change, deduped in memory — a per-row lookup would be 440.
    */
    prisma.auditEvent.findMany({
      where: { action: "taxonomy_changed", subject: { startsWith: "Category:" } },
      orderBy: { createdAt: "desc" },
      select: {
        subject: true,
        createdAt: true,
        after: true,
        actor: { select: { fullName: true, email: true } },
      },
      take: 2_000,
    }),
  ]);

  const listings = new Map(counts.map((row) => [row.primaryCategoryId, row._count]));
  const kinds = new Map(categories.map((row) => [row.id, row]));

  /*
     Latest trade-kind change per category. The log holds renames and removals
     under the same action, so a row is only an author for this column when its
     `after` actually carries a `tradeKind` — otherwise a rename would claim
     credit for a kind somebody else set.
  */
  const lastSet = new Map<string, { name: string; at: Date }>();
  for (const event of authors) {
    const id = event.subject.slice("Category:".length);
    if (lastSet.has(id)) continue;
    const after = event.after as { tradeKind?: unknown } | null;
    if (!after || !("tradeKind" in after)) continue;
    lastSet.set(id, {
      name: event.actor.fullName ?? event.actor.email ?? "—",
      at: event.createdAt,
    });
  }

  const rows: TradeKindBoardRow[] = categories.map((category) => {
    const trade = tradeKindOrigin(kinds, category.id);
    const author = trade.from === "own" ? (lastSet.get(category.id) ?? null) : null;
    return {
      id: category.id,
      name: category.name,
      sectorName: category.parent?.name ?? null,
      isSector: category.parentId === null,
      trade,
      listings: listings.get(category.id) ?? 0,
      setBy: author?.name ?? null,
      setAt: author?.at ?? null,
    };
  });

  // Unset, then inherited, then decided. Name breaks ties so two loads agree.
  const BAND = { default: 0, inherited: 1, own: 2 } as const;
  rows.sort(
    (a, b) => BAND[a.trade.from] - BAND[b.trade.from] || a.name.localeCompare(b.name),
  );

  return {
    rows,
    decided: rows.filter((row) => row.trade.from === "own").length,
    inherited: rows.filter((row) => row.trade.from === "inherited").length,
    unset: rows.filter((row) => row.trade.from === "default").length,
    total: rows.length,
  };
}
