import "server-only";
import { prisma } from "@/lib/db/client";
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

/**
 * The whole taxonomy's trade kinds, keyed by id. One query, whatever is asked.
 *
 * The query half of `./trade-kind.ts`. Everything is loaded rather than the
 * chain above one id, because the chain costs a round trip per level and the
 * whole table is 440 rows of three small columns — so resolving one id and
 * resolving all of them cost the same.
 */
export async function loadTradeKinds(db: Db = prisma): Promise<Map<string, TradeKindRow>> {
  const rows = await db.category.findMany({
    select: { id: true, parentId: true, tradeKind: true },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * The kind of one category, for a caller holding an id and no taxonomy.
 *
 * A caller resolving more than one id should call `loadTradeKinds` once and
 * `resolveTradeKind` per id rather than calling this in a loop.
 */
export async function tradeKindFor(categoryId: string, db: Db = prisma): Promise<TradeKind> {
  return resolveTradeKind(await loadTradeKinds(db), categoryId);
}

/**
 * How many subcategories one write would actually move — board `4d-s`.
 *
 * The same promise `previewRename` makes about addresses, for the same reason:
 * setting a sector is the bulk action, and somebody about to change the kind of
 * thirty-eight trades in one click should be told that before rather than
 * after. Counted as *changes*, not as descendants — a subcategory that already
 * resolves to the value being set, by its own row or by an override further
 * down, is not moved by this and is not counted.
 */
export async function tradeKindImpact(
  categoryId: string,
  next: TradeKind | null,
): Promise<{ moved: number; overridden: number }> {
  const rows = await loadTradeKinds();
  const subject = rows.get(categoryId);
  if (!subject) return { moved: 0, overridden: 0 };

  const after = new Map(rows);
  after.set(categoryId, { ...subject, tradeKind: next });

  let moved = 0;
  let overridden = 0;
  for (const row of rows.values()) {
    if (resolveTradeKind(rows, row.id) !== resolveTradeKind(after, row.id)) moved += 1;
    /*
       A descendant that answers for itself, and so will not follow. Surfaced
       separately rather than folded into `moved`: "38 move, 4 keep their own
       answer" is the sentence that stops somebody assuming a sector write is
       total and then discovering four exceptions a month later.
    */
    else if (row.id !== categoryId && row.tradeKind !== null && isUnder(rows, row.id, categoryId)) {
      overridden += 1;
    }
  }
  return { moved, overridden };
}

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
 * Set, override or clear how a trade is sold — board `4d-s`, decision D5.
 *
 * `null` is a real choice and not an absence: it clears an override so the row
 * inherits again. That is why the screen offers three options and why this
 * takes `TradeKind | null` rather than an optional argument — an optional one
 * could not tell "leave it alone" from "make it inherit".
 *
 * Audited like every other taxonomy change. It decides which version of roughly
 * forty screens a seller and a buyer see, which is a larger blast radius than
 * the rename beside it.
 */
export async function setTradeKind(input: {
  actor: Actor;
  categoryId: string;
  tradeKind: TradeKind | null;
  reason: string;
}): Promise<TaxonomyResult> {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true, name: true, tradeKind: true },
  });
  if (!category) {
    return { ok: false, error: "not_found", message: "That category is not in the taxonomy." };
  }
  if (category.tradeKind === input.tradeKind) {
    return { ok: false, error: "out_of_range", message: "That is already how this trade is sold." };
  }

  await prisma.$transaction(async (tx) =>
    staffMutation(
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
    ),
  );

  return { ok: true };
}
