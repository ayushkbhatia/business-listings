import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * The *before* board 8e's completion screen compares against.
 *
 * That screen asserts two comparisons — "up from 62%" and "14 spec filters you
 * were invisible to this morning" — and neither can be computed from the
 * present. A comparison needs a baseline, and nothing was storing one: the hub
 * read the score on every render and kept none of them.
 *
 * ## Written on the hub's first render, and never again
 *
 * `noteFirstHubView` is an insert that does nothing on conflict. Not an upsert
 * that updates: the whole value of the row is that it holds what was true
 * *before* the seller did the work, so a second hub render — after two
 * photographs have landed — must not move it. The `@id` on `businessId` is what
 * makes that a database rule rather than a convention.
 *
 * ## Every write here is best-effort
 *
 * None of these are the reason a page renders. A baseline that fails to write
 * costs one clause on one screen — §2 says drop the clause rather than guess a
 * baseline, so the absence is already a designed state. A hub that 500s because
 * a bookkeeping row would not insert is a worse outcome by a distance, so the
 * failures are logged and swallowed.
 */

export interface SetupBaselineRow {
  firstSeenAt: Date;
  baselineScore: number | null;
  baselineFacets: number | null;
  completedAt: Date | null;
  doneSeenAt: Date | null;
}

export async function readBaseline(businessId: string): Promise<SetupBaselineRow | null> {
  return prisma.setupBaseline.findUnique({
    where: { businessId },
    select: {
      firstSeenAt: true,
      baselineScore: true,
      baselineFacets: true,
      completedAt: true,
      doneSeenAt: true,
    },
  });
}

/**
 * Record where this seller started, the first time they open the hub.
 *
 * Both figures are nullable and both are captured here rather than read later,
 * because later is the point at which they are no longer true.
 */
export async function noteFirstHubView(businessId: string, score: number | null): Promise<void> {
  try {
    const existing = await prisma.setupBaseline.findUnique({
      where: { businessId },
      select: { businessId: true },
    });
    if (existing) return;

    /*
       The facet count is a second query and only worth paying for on the one
       render that stores it. Read before the insert rather than inside it: a
       failure here should still leave a row with a score baseline, because half
       a baseline is better than none and the screen drops each clause
       independently.
    */
    const baselineFacets = await specFacetCount(businessId).catch(() => null);

    await prisma.setupBaseline.create({
      data: {
        businessId,
        ...(score === null ? {} : { baselineScore: score }),
        ...(baselineFacets === null ? {} : { baselineFacets }),
      },
    });
  } catch (error) {
    /*
       Two hub renders racing is the ordinary case — a seller double-clicking,
       or a prefetch alongside a navigation — and the loser hits the primary
       key. That is the constraint doing its job, not a fault, and the row it
       lost to holds the same numbers.
    */
    console.warn("[setup] could not record the baseline", {
      businessId,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** Stamp the moment the last task closed. First one wins, like the baseline. */
export async function noteCompleted(businessId: string, now: Date = new Date()): Promise<void> {
  try {
    await prisma.setupBaseline.updateMany({
      where: { businessId, completedAt: null },
      data: { completedAt: now },
    });
  } catch (error) {
    console.warn("[setup] could not stamp completion", {
      businessId,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Mark the completion screen as seen. This is the once-only rule.
 *
 * `updateMany` with `doneSeenAt: null` in the filter rather than `update`, and
 * the count is the answer: exactly one caller can flip it, so two tabs opening
 * the screen together cannot both count as the first view. §1 says the seller
 * reaches this screen once, on the transition, and a completion screen that can
 * be revisited is a stale dashboard.
 *
 * Returns whether this call was the one that marked it.
 */
export async function markDoneSeen(businessId: string, now: Date = new Date()): Promise<boolean> {
  try {
    const { count } = await prisma.setupBaseline.updateMany({
      where: { businessId, doneSeenAt: null },
      data: { doneSeenAt: now },
    });
    return count === 1;
  } catch (error) {
    console.warn("[setup] could not mark the done screen seen", {
      businessId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

/**
 * How many distinct spec filters this catalogue can be found by.
 *
 * A buyer filtering "DN100" reaches a supplier when one of its live products
 * carries that value on a **filterable** field. So the number that matters is
 * distinct `(fieldId, value)` pairs, not products and not fields: ten products
 * all sized DN100 are one filter, and a product with four filled filterable
 * fields is four.
 *
 * Draft products are excluded. A catalogue row nobody can reach is not a filter
 * anybody can find you by, and counting it would put a number on this screen
 * that the search page contradicts.
 *
 * `specValues` is keyed by `SpecField.id` and not by `key` — every writer in the
 * product stores ids, because a key can be renamed and an id cannot. Reading by
 * key here would return zero for every supplier and look like an empty
 * catalogue rather than a bug.
 */
export async function specFacetCount(businessId: string): Promise<number> {
  const seat = await prisma.sellerTemplate.findFirst({
    where: { businessId },
    select: { platformTemplateId: true },
  });
  if (!seat?.platformTemplateId) return 0;

  const fields = await prisma.specField.findMany({
    where: { templateId: seat.platformTemplateId, isFilterable: true },
    select: { id: true },
  });
  if (fields.length === 0) return 0;

  const filterable = new Set(fields.map((field) => field.id));

  const products = await prisma.product.findMany({
    where: { businessId, status: "live" },
    select: { specValues: true },
  });

  const pairs = new Set<string>();
  for (const product of products) {
    const values = (product.specValues ?? {}) as Record<string, unknown>;
    for (const [fieldId, value] of Object.entries(values)) {
      if (!filterable.has(fieldId)) continue;
      for (const token of facetTokens(value)) pairs.add(`${fieldId} ${token}`);
    }
  }
  return pairs.size;
}

/**
 * One spec value, reduced to the filters it can be matched on. Zero, one or many.
 *
 * Many is the multi-select case, and it returns a token each: a product
 * certified to both UL and FM is findable under either, so it is two filters
 * rather than one compound one. Folding them into a single `"fm|ul"` token —
 * which this did in its first draft — would count a two-certificate product as
 * one filter and disagree with the search page that lists them separately.
 *
 * A scalar folds to a trimmed, lower-cased string, so `"DN100"` and `"dn100"`
 * are one filter rather than two; a buyer typing either reaches the same shelf,
 * and counting them apart would inflate the number this screen prints.
 *
 * Nothing at all returns nothing: a field present in the JSON with an empty
 * value is a field the seller has not answered.
 */
function facetTokens(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(facetTokens);
  if (typeof value === "boolean") return [String(value)];
  if (typeof value === "number") return Number.isFinite(value) ? [String(value)] : [];
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    return trimmed === "" ? [] : [trimmed];
  }
  return [];
}
