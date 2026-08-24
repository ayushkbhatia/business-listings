import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanBuyPlacement } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";

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
      select: { categoryId: true, emirate: true, businessId: true, endsOn: true },
    }),
    prisma.placementWaitlist.findMany({
      where: { categoryId: { in: [...categoryIds] } },
      orderBy: { createdAt: "asc" },
      select: { categoryId: true, emirate: true, businessId: true },
    }),
  ]);

  return categories.map((category) => {
    // Emirate-less for now: a slot is bought per category nationally until the
    // per-emirate picker exists, and the model already carries the column.
    const slot = held.find((h) => h.categoryId === category.id && h.emirate === null);
    const line = queue.filter((q) => q.categoryId === category.id && q.emirate === null);
    const position = line.findIndex((q) => q.businessId === businessId);

    return {
      categoryId: category.id,
      categoryName: category.name,
      emirate: null,
      mine: slot?.businessId === businessId,
      takenUntil: slot && slot.businessId !== businessId ? (slot.endsOn ?? null) : null,
      queued: position >= 0,
      ahead: position >= 0 ? position : line.length,
      monthlyPriceAed: SLOT_MONTHLY_AED,
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
    return { ok: false, error: "You can only buy placement for your own business." };
  }

  const existing = await prisma.placementSlot.findFirst({
    where: {
      categoryId,
      emirate: null,
      startsOn: { lte: now },
      OR: [{ endsOn: null }, { endsOn: { gt: now } }],
    },
    select: { businessId: true },
  });

  if (existing) {
    if (existing.businessId === businessId) {
      return { ok: false, error: "You already hold that slot." };
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
