import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanBuyPlacement } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { hasEntitlement } from "@/lib/plan/entitlements";
import { t } from "@/lib/i18n";

/**
 * Sponsored placement. Board 11e.
 *
 * Three rules, and each is a decision about what this directory is:
 *
 *   - **One slot per subcategory and emirate.** Nobody buys a whole category.
 *   - **Not auctioned.** An auction puts the deepest pockets at the top of
 *     every page, which is the thing a trade directory exists not to be. If a
 *     slot is taken you join a queue, in the order people joined it.
 *   - **Never outranks a verified supplier on a filter the buyer set.** A buyer
 *     who asked for tier 3 gets tier 3 first, whoever is paying. Enforced in
 *     ranking, not here, but stated on the screen because a seller deciding
 *     whether to buy deserves to know what they are buying.
 *
 * The panel that says "fix the free stuff first — N products are missing
 * filterable specs" is not decoration. A sponsored slot that puts a product
 * nobody can filter to at the top of a page sells the seller nothing, and they
 * find that out a month later.
 */

/** What a slot costs. Flat, published, and the same for everybody. */
export const SLOT_MONTHLY_AED = 450;

export interface SlotView {
  categoryId: string;
  categoryName: string;
  emirate: string | null;
  /** Held by this business. */
  mine: boolean;
  /** Held by somebody, and when it frees up. */
  takenUntil: Date | null;
  /** This business is queued for it. */
  queued: boolean;
  /** How many are ahead of them. Only meaningful when `queued`. */
  ahead: number;
  /**
   * They queued for this, and it has since come free.
   *
   * `PlacementWaitlist.notifiedAt` had no writer and no reader for as long as
   * the model existed. `endPlacementsFor` writes it the moment a slot ends;
   * this is the half that means somebody finds out.
   */
  freed: boolean;
  monthlyPriceAed: number;
}

export async function slotsFor(
  businessId: string,
  categoryIds: readonly string[],
  now = new Date(),
): Promise<SlotView[]> {
  if (categoryIds.length === 0) return [];

  const [categories, held, queue] = await Promise.all([
    prisma.category.findMany({
      where: { id: { in: [...categoryIds] } },
      select: { id: true, name: true },
    }),
    prisma.placementSlot.findMany({
      where: {
        categoryId: { in: [...categoryIds] },
        startsOn: { lte: now },
        OR: [{ endsOn: null }, { endsOn: { gt: now } }],
      },
      select: {
        categoryId: true,
        emirate: true,
        businessId: true,
        endsOn: true,
        monthlyPriceAed: true,
      },
    }),
    prisma.placementWaitlist.findMany({
      where: { categoryId: { in: [...categoryIds] } },
      orderBy: { createdAt: "asc" },
      select: { categoryId: true, emirate: true, businessId: true, notifiedAt: true },
    }),
  ]);

  return categories.map((category) => {
    /*
       Any slot in this category, whatever emirate it is scoped to.

       This looked only at `emirate === null`. Buying is still national-only —
       the per-emirate picker is board `11e`'s own work — but *reading* had the
       same blind spot, and the two are not the same mistake. The seed carries a
       Dubai slot at AED 1,200; the seller holding it was shown the category as
       "Available, AED 450 a month" and could have bought a second, national
       slot on top of the one they already had.

       So: the screen sees what exists, and the purchase stays national until
       the picker lands.
    */
    const slot = held.find((h) => h.categoryId === category.id);
    const line = queue.filter((q) => q.categoryId === category.id);
    const position = line.findIndex((q) => q.businessId === businessId);

    return {
      categoryId: category.id,
      categoryName: category.name,
      emirate: slot?.emirate ?? null,
      mine: slot?.businessId === businessId,
      takenUntil: slot && slot.businessId !== businessId ? (slot.endsOn ?? null) : null,
      queued: position >= 0,
      ahead: position >= 0 ? position : line.length,
      // Told, and actually free. Both, because a slot can be taken again
      // between the notification and the seller opening this screen, and
      // "it is yours to take" over a slot somebody else now holds is worse
      // than never having said anything.
      freed: position >= 0 && Boolean(line[position]?.notifiedAt) && !slot,
      /*
         What this slot costs, from the row where one is sold and from the list
         price where none is. A held slot priced from the constant told the
         seller holding the seeded 1,200 slot that it cost 450.
      */
      monthlyPriceAed: slot ? Number(slot.monthlyPriceAed) : SLOT_MONTHLY_AED,
    };
  });
}

export type PlacementResult = { ok: true; queued: boolean } | { ok: false; error: string };

/**
 * Take a slot, or join the queue for it.
 *
 * One call, because from the seller's side it is one intention. Which of the
 * two happens depends on whether somebody already holds it, and the result says
 * which so the screen can tell them.
 */
export async function takeSlot(
  actor: Actor,
  businessId: string,
  categoryId: string,
  now = new Date(),
): Promise<PlacementResult> {
  assertCanBuyPlacement(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: t("promote.refuse.not_yours") };
  }

  /*
     The plan gate, which this route did not have.

     `placement.purchase` says the seat may buy for its own business. It says
     nothing about whether the business's plan includes the thing being bought,
     and nothing here asked. So a Free-plan owner could take a slot —
     `sponsoredEligible` is seeded false for Free, has an editor at
     /admin/plans, renders as a row on the plan comparison grid, is promised in
     onboarding copy, and was read by nothing on the one route that sells it.
     `tests/integration/commercials.test.ts:566` already asserts in its own name
     that "sponsoredEligible gates the placement screen".

     Through `effectiveFor` rather than off `business.plan`, so a seller who
     bought eligibility and was later moved off it by a plan edit keeps what
     they paid for — the same grandfathering every other entitlement gets.
  */
  const plan = await effectiveFor(businessId);
  if (!plan) return { ok: false, error: t("promote.refuse.no_plan") };
  if (!hasEntitlement(plan, "sponsoredEligible")) {
    return { ok: false, error: t("promote.refuse.plan", { plan: plan.name }) };
  }

  /*
     Anybody's live slot in this category, in any emirate.

     Not `emirate: null`. A business already holding an emirate-scoped slot here
     would otherwise pass this check and buy the national one on top, ending up
     paying twice to sit in one place — which the seeded Dubai slot made a live
     case rather than a hypothetical.
  */
  const existing = await prisma.placementSlot.findFirst({
    where: {
      categoryId,
      startsOn: { lte: now },
      OR: [{ endsOn: null }, { endsOn: { gt: now } }],
    },
    select: { businessId: true },
  });

  if (existing) {
    if (existing.businessId === businessId) {
      return { ok: false, error: t("promote.refuse.already_yours") };
    }
    /*
     * Not an auction. A queue, in the order people joined it.
     *
     * Find-then-create rather than upsert: Prisma's composite-unique `where`
     * cannot express a null emirate, because Postgres treats two NULLs as
     * distinct and the constraint does not apply to the national slot at all.
     * The partial unique index in the migration is what actually enforces it,
     * so a race here loses to the database rather than to nothing.
     */
    const already = await prisma.placementWaitlist.findFirst({
      where: { businessId, categoryId, emirate: null },
      select: { id: true },
    });
    if (!already) {
      await prisma.placementWaitlist.create({ data: { businessId, categoryId } });
    }
    return { ok: true, queued: true };
  }

  /*
     Off the queue, because they are no longer waiting for it.

     Deleted rather than left with `notifiedAt` set: a row in a queue for a slot
     you already hold is a row that would put you second in line for your own
     placement the next time it frees.
  */
  await prisma.placementWaitlist.deleteMany({ where: { businessId, categoryId } });

  await prisma.placementSlot.create({
    data: {
      businessId,
      categoryId,
      monthlyPriceAed: SLOT_MONTHLY_AED,
      startsOn: now,
      endsOn: new Date(now.getTime() + 30 * 86_400_000),
    },
  });

  return { ok: true, queued: false };
}

export async function leaveQueue(
  actor: Actor,
  businessId: string,
  categoryId: string,
): Promise<PlacementResult> {
  assertCanBuyPlacement(actor);
  await prisma.placementWaitlist.deleteMany({
    where: { businessId: actor.businessId ?? businessId, categoryId, emirate: null },
  });
  return { ok: true, queued: false };
}
