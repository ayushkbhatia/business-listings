import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * "Most sellers in your category choose Pro" — measured, or not said at all.
 *
 * Board 2e is explicit that this clause is *"legitimate only if measured"*, and
 * criterion 10 asks for it to be rendered from the real distribution and
 * suppressed entirely below a thirty-seller cohort. It also forbids the obvious
 * softening: *"Do not soften it to 'many' — remove it."* A hedge is a claim with
 * the evidence taken out, and it reads as one.
 *
 * Thirty is not a rounding of the forty this codebase uses for the enquiry-lift
 * cohort. It is board 2e's own floor, and the reason is different: the lift
 * figure is about *effect* and needs enough of both arms to be a comparison,
 * while this is about *composition* and needs enough sellers that naming the
 * majority does not identify them. In a category with eleven suppliers, "most
 * sellers in your category choose Pro" tells a seller which of their nine
 * competitors is paying.
 *
 * The other reason to suppress rather than round: at launch every cohort is
 * thin, so this clause will be absent from most pages for months. That is the
 * honest state of a cold directory, and a sentence that appears the moment
 * there is something true to say is worth more than one that was always there.
 */

/** Board 2e's floor. Below this the clause is removed, never softened. */
export const COHORT_MINIMUM = 30;

export interface PlanCohort {
  /** The plan the most sellers in this category are on. */
  planId: string;
  planName: string;
  /** How many of the cohort are on it. */
  count: number;
  /** The cohort. At or above `COHORT_MINIMUM`, or this is not returned at all. */
  total: number;
}

/**
 * The plan distribution for one category, or null.
 *
 * Null in three cases and they are all the same answer to the seller — the
 * clause does not render: the cohort is too thin, the category is not set, or
 * no plan holds a majority. That last one matters. A "most sellers" sentence
 * over a 34% plurality is not true, and the arithmetic has to be checked rather
 * than assumed from whichever bar is tallest.
 *
 * Counts claimed, published listings only. An unclaimed listing is on Free
 * because nobody has chosen anything, and counting those would report a Free
 * majority made of businesses that have never seen this page.
 */
export async function planCohortFor(
  categoryId: string | null,
  now = new Date(),
): Promise<PlanCohort | null> {
  if (!categoryId) return null;

  const rows = await prisma.business.groupBy({
    by: ["planId"],
    where: {
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: { not: null, lte: now },
    },
    _count: { _all: true },
  });

  const total = rows.reduce((sum, row) => sum + row._count._all, 0);
  if (total < COHORT_MINIMUM) return null;

  const top = rows
    .filter((row): row is typeof row & { planId: string } => row.planId !== null)
    .sort((a, b) => b._count._all - a._count._all)[0];
  if (!top) return null;

  // "Most" means more than half. Anything less is a plurality, and a plurality
  // rendered as a majority is the kind of claim this board exists to remove.
  if (top._count._all * 2 <= total) return null;

  const plan = await prisma.plan.findUnique({
    where: { id: top.planId },
    select: { name: true, withdrawnAt: true },
  });
  // A plan nobody can buy any more is not a recommendation. Board 12e keeps
  // existing subscribers on it; this page does not send anybody else there.
  if (!plan || plan.withdrawnAt) return null;

  return { planId: top.planId, planName: plan.name, count: top._count._all, total };
}
