import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * The categories a listing sits in. Board 2c's highest-stakes field.
 *
 * The sub-line on that screen says it plainly: *"The categories you pick decide
 * which RFQs reach you."* Category membership is the join the enquiry fan-out
 * matches on, so a seller in one category receives one category's demand. That
 * is what makes the plan ladder mean something rather than being a paywall
 * detail — Free's zero extras is a real product constraint.
 *
 * ## Two counters, two denominators
 *
 * The screen shows both and they are both right:
 *
 *   - `2 of 2 extra used on Basic` — the **extras** allowance, `categoryLimit`
 *     minus the primary.
 *   - `3 categories chosen` in the strength meter — the **total**.
 *
 * Collapsing them into one component would make one of them wrong. They are
 * computed from the same two arrays here, which is what stops them disagreeing.
 */

export interface CategoryAllowance {
  /** Including the primary. Null is unlimited. */
  total: number | null;
  /** `categoryLimit - 1`, floored at zero. Null is unlimited. */
  extras: number | null;
  extrasUsed: number;
  /** True where another extra can be added. */
  canAddMore: boolean;
  /** True on a plan whose whole allowance is the primary category. */
  extrasExhaustedByPlan: boolean;
  planName: string;
}

export function allowanceFor(
  categoryLimit: number | null,
  planName: string,
  extrasUsed: number,
): CategoryAllowance {
  if (categoryLimit === null) {
    return {
      total: null,
      extras: null,
      extrasUsed,
      canAddMore: true,
      extrasExhaustedByPlan: false,
      planName,
    };
  }
  const extras = Math.max(0, categoryLimit - 1);
  return {
    total: categoryLimit,
    extras,
    extrasUsed,
    canAddMore: extrasUsed < extras,
    /*
       Free allows one category in total, so the extras field has an allowance of
       zero. Board 2c, criterion 6: it renders present-and-empty with the upgrade
       line rather than being hidden — a seller cannot want what they cannot see,
       and this is the field the ladder is actually about.
    */
    extrasExhaustedByPlan: extras === 0,
    planName,
  };
}

export type AddCategoryResult =
  | { ok: true; unverifiedActivity: boolean }
  | { ok: false; reason: "at_cap" | "already_there" | "is_primary" | "not_found" };

/**
 * Add an extra category, up to the plan's cap.
 *
 * The cap is enforced here rather than only in the interface. Board 2c's third
 * fix is exactly this distinction: a control that would be refused on click is a
 * lie, and a cap that is real only in the API's rejection is a screen that
 * disagrees with its own product.
 */
export async function addExtraCategory(
  businessId: string,
  categoryId: string,
): Promise<AddCategoryResult> {
  const [business, category] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: {
        primaryCategoryId: true,
        licenceActivity: true,
        plan: { select: { categoryLimit: true } },
        categories: { select: { categoryId: true } },
      },
    }),
    prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true, name: true, synonyms: true, parent: { select: { name: true } } },
    }),
  ]);
  if (!business || !category) return { ok: false, reason: "not_found" };
  if (business.primaryCategoryId === categoryId) return { ok: false, reason: "is_primary" };
  if (business.categories.some((row) => row.categoryId === categoryId)) {
    return { ok: false, reason: "already_there" };
  }

  const allowance = allowanceFor(
    business.plan?.categoryLimit ?? null,
    "",
    business.categories.length,
  );
  if (!allowance.canAddMore) return { ok: false, reason: "at_cap" };

  /*
     Accepted, and flagged where the licence does not cover it.

     Criterion 8. Silently accepting would let a paint trader receive electrical
     RFQs; silently refusing would tell a legitimate seller their own licence is
     wrong on a text match against registry prose. So the chip goes on, the row
     carries a flag, and the fan-out leaves this listing out of *this* category
     until a reviewer clears it.
  */
  const covered = activityCovers(business.licenceActivity, category);

  await prisma.businessCategory.create({
    data: {
      businessId,
      categoryId,
      unverifiedActivityAt: covered ? null : new Date(),
    },
  });

  return { ok: true, unverifiedActivity: !covered };
}

export async function removeExtraCategory(
  businessId: string,
  categoryId: string,
): Promise<{ ok: true }> {
  await prisma.businessCategory.deleteMany({ where: { businessId, categoryId } });
  return { ok: true };
}

/**
 * Does the licence's stated activity cover this category?
 *
 * A word match against the category's own name, its parent's, and the synonyms
 * the taxonomy already carries for query routing — the same list that decides
 * whether a buyer's Arabic search reaches this trade, reused rather than a
 * second vocabulary to maintain.
 *
 * **An absent activity covers everything.** A listing imported from an export
 * that carried no activity column has told us nothing, and a flag raised on
 * silence would put every one of them in front of a reviewer to say so.
 */
export function activityCovers(
  activity: string | null,
  category: { name: string; synonyms?: string[]; parent?: { name: string } | null },
): boolean {
  const text = (activity ?? "").toLowerCase();
  if (!text.trim()) return true;

  const terms = [
    category.name,
    category.parent?.name ?? "",
    ...(category.synonyms ?? []),
  ]
    .flatMap((term) => term.toLowerCase().split(/[^\p{Letter}\p{Number}]+/u))
    .filter((word) => word.length >= 4);

  return terms.some((word) => text.includes(word));
}

/**
 * Categories a listing is currently kept out of the fan-out for.
 *
 * Read by board 4c's queue and by the tests that prove criterion 8. The
 * exclusion itself is in `lib/enquiry/service.ts`, where the matcher is.
 */
export async function flaggedCategories(businessId: string) {
  return prisma.businessCategory.findMany({
    where: { businessId, unverifiedActivityAt: { not: null } },
    orderBy: { unverifiedActivityAt: "asc" },
    select: {
      categoryId: true,
      unverifiedActivityAt: true,
      category: { select: { name: true } },
    },
  });
}

/** A reviewer clears the flag, and the listing rejoins that category's fan-outs. */
export async function clearActivityFlag(
  businessId: string,
  categoryId: string,
  clearedById: string,
): Promise<{ ok: true }> {
  await prisma.businessCategory.updateMany({
    where: { businessId, categoryId },
    data: { unverifiedActivityAt: null, clearedById },
  });
  return { ok: true };
}
