import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import {
  countWords,
  evaluatePublish,
  type PublishDecision,
  type PublishThresholds,
} from "@/lib/publish-threshold";

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

export interface CategoryHealth {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  code: string;
  synonyms: string[];
  publishThreshold: number;
  verifiedShareMin: number;
  /** Published listings whose primary category is this one. */
  listings: number;
  /** How many of those are tier 1 or better. */
  verified: number;
  /** Against this category's own thresholds, not the defaults. */
  decision: PublishDecision;
}

/**
 * Every category with the numbers its own thresholds are judged against.
 *
 * Intro words are not counted here: the copy lives with the landing page, which
 * is handoff 5. `evaluatePublish` takes the count, so passing the threshold as
 * satisfied would be a lie — instead the screen says the word count is not
 * measurable yet, the same way board 4a does for a table that does not exist.
 */
export async function categoryHealth(introWords = Number.MAX_SAFE_INTEGER): Promise<CategoryHealth[]> {
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
        publishThreshold: true,
        verifiedShareMin: true,
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
        verificationTier: { gte: 1 },
      },
      _count: true,
    }),
  ]);

  const listings = new Map(counts.map((row) => [row.primaryCategoryId, row._count]));
  const verified = new Map(verifiedCounts.map((row) => [row.primaryCategoryId, row._count]));

  return categories.map((category) => {
    const total = listings.get(category.id) ?? 0;
    const verifiedTotal = verified.get(category.id) ?? 0;
    return {
      ...category,
      listings: total,
      verified: verifiedTotal,
      decision: evaluatePublish(
        { listings: total, verified: verifiedTotal, introWords },
        thresholdsFor(category),
      ),
    };
  });
}

/** A category's own floor, which is what the columns are for. */
export function thresholdsFor(category: {
  publishThreshold: number;
  verifiedShareMin: number;
}): PublishThresholds {
  return {
    minListings: category.publishThreshold,
    minVerifiedShare: category.verifiedShareMin,
    // Unchanged from the default: the word count is a property of the page's
    // copy, not of the category, so board 6f owns it in step 7.
    minIntroWords: 250,
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
  publishThreshold?: number;
  verifiedShareMin?: number;
  reason: string;
}

const MAX_THRESHOLD = 5_000;

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
    select: {
      id: true,
      name: true,
      synonyms: true,
      publishThreshold: true,
      verifiedShareMin: true,
    },
  });
  if (!category) {
    return { ok: false, error: "not_found", message: "That category is not in the taxonomy." };
  }

  if (input.publishThreshold !== undefined) {
    if (
      !Number.isInteger(input.publishThreshold) ||
      input.publishThreshold < 1 ||
      input.publishThreshold > MAX_THRESHOLD
    ) {
      return {
        ok: false,
        error: "out_of_range",
        message: `A listing floor is a whole number from 1 to ${MAX_THRESHOLD}.`,
      };
    }
  }

  if (input.verifiedShareMin !== undefined) {
    if (
      !Number.isFinite(input.verifiedShareMin) ||
      input.verifiedShareMin < 0 ||
      input.verifiedShareMin > 1
    ) {
      return {
        ok: false,
        error: "out_of_range",
        message: "A verified share is between 0 and 1 — 0.30 is thirty per cent.",
      };
    }
  }

  const synonyms =
    input.synonyms === undefined
      ? undefined
      : [...new Set(input.synonyms.map((s) => s.trim()).filter(Boolean))];

  const before = {
    name: category.name,
    synonyms: category.synonyms,
    publishThreshold: category.publishThreshold,
    verifiedShareMin: category.verifiedShareMin,
  };

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
            ...(input.publishThreshold !== undefined
              ? { publishThreshold: input.publishThreshold }
              : {}),
            ...(input.verifiedShareMin !== undefined
              ? { verifiedShareMin: input.verifiedShareMin }
              : {}),
          },
          select: {
            name: true,
            synonyms: true,
            publishThreshold: true,
            verifiedShareMin: true,
          },
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
