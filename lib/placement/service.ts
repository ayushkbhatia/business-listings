import "server-only";
import type { Emirate } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { SLOT_TERM_DAYS } from "./term";
import { priceScopes, type ScopePrice } from "./demand";
import { MIN_BAND } from "./bands";
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
 *   - **One slot per subcategory and emirate.** Nobody buys a whole category,
 *     and nobody buys the country.
 *   - **Not auctioned.** An auction puts the deepest pockets at the top of
 *     every page, which is the thing a trade directory exists not to be. If a
 *     slot is taken you join a queue, in the order people joined it, and
 *     everybody in it is told the day it frees.
 *   - **Never outranks a result the buyer's own filter selected.** A buyer who
 *     asked for tier 3 gets tier 3 first, whoever is paying. Enforced in
 *     ranking, not here, but stated on the screen because a seller deciding
 *     whether to buy deserves to know what they are buying.
 *
 * The panel that says "fix the free stuff first — N products are missing
 * filterable specs" is not decoration. A sponsored slot that puts a product
 * nobody can filter to at the top of a page sells the seller nothing, and they
 * find that out a month later.
 *
 * ## The emirate is the inventory, and it arrived with the price
 *
 * Buying used to be national-only: one slot per category, everywhere, at a flat
 * AED 450. The board sells a scope — *Valves & actuators · Dubai* — and prices
 * it from what buyers do there, so the two arrived together. A category with a
 * live national slot from before this still reads and still renders; nothing
 * new is sold country-wide.
 */

/** As many scopes as the screen will offer at once. */
const MAX_SCOPES = 12;

export interface ScopeView {
  categoryId: string;
  categoryName: string;
  /** Null is a legacy country-wide slot. Nothing new is sold at that scope. */
  emirate: Emirate | null;
  /** Where this scope sits on the demand ladder, 1 to 10. */
  band: number;
  /**
   * What this scope costs to take today, a month, ex-VAT.
   *
   * A quote, from the band. It is **not** what a seller already holding the
   * slot pays — see `paidMonthlyAed`. Board flag 4 asks that a taken slot show
   * a price too, and this is the honest one to show: what it would cost you,
   * today, which is also what the waitlist is a queue for.
   */
  monthlyPriceAed: number;
  /**
   * What the holder actually pays, where this seller is the holder.
   *
   * Frozen at booking and never re-derived, so a seller who bought in band 4
   * reads band 4's price however the scope has moved since. Null when the slot
   * is not theirs — what somebody else pays is not theirs to see.
   */
  paidMonthlyAed: number | null;
  /** Null where this scope has never been measured — never a zero standing in. */
  appearances: number | null;
  clicks: number | null;
  /** The last day of the window the band was cut from. */
  measuredTo: Date | null;
  /** Where this seller ranks here organically today. Null when not ranked. */
  rank: number | null;
  rankTotal: number | null;
  /** The night that rank was taken. Null when the scope has never been ranked. */
  rankedOn: Date | null;
  /** Held by this business. */
  mine: boolean;
  /** Held by somebody else, and when it frees up. */
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
}

export interface ScopeKey {
  categoryId: string;
  emirate: Emirate | null;
}

const keyOf = (scope: ScopeKey): string => `${scope.categoryId}|${scope.emirate ?? ""}`;

/**
 * Which scopes this seller is offered.
 *
 * Their own trades, in the places those trades are actually searched — plus
 * every scope they already hold or are queued for, whatever its demand, because
 * a row a seller is in must never vanish from the screen that manages it.
 *
 * Emirates a seller has a branch in are always offered: that is where they
 * trade, and a directory that would not sell them their own city because
 * nobody has searched it yet is refusing a sale on the strength of its own cold
 * start. Everything else is offered on measured demand, busiest first, and the
 * list stops at `MAX_SCOPES` — "where do you want to be first?" is a question
 * with a handful of answers, not seventy.
 */
export async function sellableScopes(businessId: string, now = new Date()): Promise<ScopeKey[]> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      primaryCategoryId: true,
      categories: { select: { categoryId: true } },
      locations: { where: { published: true }, select: { emirate: true } },
    },
  });
  if (!business) return [];

  const categoryIds = [
    ...new Set([business.primaryCategoryId, ...business.categories.map((row) => row.categoryId)]),
  ];
  if (categoryIds.length === 0) return [];

  const ownEmirates = [...new Set(business.locations.map((location) => location.emirate))];

  const [measured, held, queued] = await Promise.all([
    prisma.scopeDemandBand.findMany({
      where: { categoryId: { in: categoryIds } },
      orderBy: [{ band: "desc" }, { score: "desc" }, { id: "asc" }],
      select: { categoryId: true, emirate: true },
    }),
    prisma.placementSlot.findMany({
      where: {
        businessId,
        categoryId: { in: categoryIds },
        OR: [{ endsOn: null }, { endsOn: { gt: now } }],
      },
      select: { categoryId: true, emirate: true },
    }),
    prisma.placementWaitlist.findMany({
      where: { businessId, categoryId: { in: categoryIds } },
      select: { categoryId: true, emirate: true },
    }),
  ]);

  const scopes: ScopeKey[] = [];
  const seen = new Set<string>();
  const add = (scope: ScopeKey) => {
    const key = keyOf(scope);
    if (seen.has(key)) return;
    seen.add(key);
    scopes.push(scope);
  };

  // Theirs first, whatever the demand: a slot they hold or are queued for is
  // the row they came to this screen to manage.
  for (const scope of [...held, ...queued]) add(scope);
  for (const categoryId of categoryIds) {
    for (const emirate of ownEmirates) add({ categoryId, emirate });
  }
  for (const scope of measured) add(scope);

  return scopes.slice(0, MAX_SCOPES);
}

/**
 * Every scope this seller may buy, with its price, its demand and their own
 * position in it.
 *
 * The organic position is the most interesting number on the row: it tells a
 * seller ranked #2 that they are buying very little, and one outside the top 20
 * that they are buying a lot. It comes from the nightly rank run — the snapshot
 * that is true whether anybody browsed or not — and where a scope has never been
 * ranked the row says so rather than printing a dash that reads as "last".
 */
export async function slotsFor(
  businessId: string,
  scopes?: readonly ScopeKey[],
  now = new Date(),
): Promise<ScopeView[]> {
  const wanted = scopes ?? (await sellableScopes(businessId, now));
  if (wanted.length === 0) return [];

  const categoryIds = [...new Set(wanted.map((scope) => scope.categoryId))];

  const [categories, prices, held, queue, ranks] = await Promise.all([
    prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    }),
    priceScopes(wanted),
    /*
       Same rule the sale uses: a slot that has not ended holds the scope, start
       date or no start date. Reading only slots that have already started would
       offer a seller a scope `takeSlot` is about to refuse them.
    */
    prisma.placementSlot.findMany({
      where: {
        categoryId: { in: categoryIds },
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
      where: { categoryId: { in: categoryIds } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { categoryId: true, emirate: true, businessId: true, notifiedAt: true },
    }),
    /*
       The nightly sampled rank, which board `11e` `B3` records as missing and
       which is not: `runPositionSnapshots` has written `CategoryRankDay` per
       scope per night since the `3a`/`3l` amendment. Most recent day first, and
       the first row per scope wins.
    */
    prisma.categoryRankDay.findMany({
      where: { businessId, categoryId: { in: categoryIds } },
      orderBy: [{ day: "desc" }, { id: "desc" }],
      select: { categoryId: true, emirate: true, day: true, position: true, total: true },
    }),
  ]);

  const nameOf = new Map(categories.map((category) => [category.id, category.name]));
  const priceOf = new Map<string, ScopePrice>(prices.map((price) => [keyOf(price), price]));

  const rankOf = new Map<string, (typeof ranks)[number]>();
  for (const row of ranks) if (!rankOf.has(keyOf(row))) rankOf.set(keyOf(row), row);

  return wanted.map((scope) => {
    const key = keyOf(scope);
    const price = priceOf.get(key);
    /*
       A live slot in this exact scope, or a country-wide one over it.

       The legacy national slot covers every emirate in its category, so a
       seller cannot buy Dubai while somebody holds the country. Reading only
       the exact scope would offer them a slot that `getSponsoredBusinessId`
       would never give them.
    */
    const slot = held.find(
      (row) =>
        row.categoryId === scope.categoryId &&
        (row.emirate === scope.emirate || row.emirate === null),
    );
    const line = queue.filter(
      (row) => row.categoryId === scope.categoryId && row.emirate === scope.emirate,
    );
    const position = line.findIndex((row) => row.businessId === businessId);
    const rank = rankOf.get(key) ?? null;

    return {
      categoryId: scope.categoryId,
      categoryName: nameOf.get(scope.categoryId) ?? scope.categoryId,
      emirate: scope.emirate,
      band: price?.band ?? MIN_BAND,
      monthlyPriceAed: price?.monthlyPriceAed ?? 0,
      paidMonthlyAed:
        slot?.businessId === businessId ? Number(slot.monthlyPriceAed) : null,
      appearances: price?.appearances ?? null,
      clicks: price?.clicks ?? null,
      measuredTo: price?.measuredTo ?? null,
      rank: rank?.position ?? null,
      rankTotal: rank?.total ?? null,
      rankedOn: rank?.day ?? null,
      mine: slot?.businessId === businessId,
      takenUntil: slot && slot.businessId !== businessId ? (slot.endsOn ?? null) : null,
      queued: position >= 0,
      ahead: position >= 0 ? position : line.length,
      // Told, and actually free. Both, because a slot can be taken again
      // between the notification and the seller opening this screen, and
      // "it is yours to take" over a slot somebody else now holds is worse
      // than never having said anything.
      freed: position >= 0 && Boolean(line[position]?.notifiedAt) && !slot,
    };
  });
}

export type PlacementResult =
  | { ok: true; queued: boolean; monthlyPriceAed?: number }
  | { ok: false; error: string };

/**
 * The advisory-lock key for one scope.
 *
 * Postgres's advisory locks take a bigint, so the scope is hashed to one with
 * `hashtext`. Two scopes colliding costs a serialised booking and never a wrong
 * one — the check inside the lock is still what decides.
 */
const scopeLock = (categoryId: string, emirate: Emirate | null): string =>
  `placement:${categoryId}:${emirate ?? "all"}`;

/**
 * Take a slot, or join the queue for it.
 *
 * One call, because from the seller's side it is one intention. Which of the
 * two happens depends on whether somebody already holds it, and the result says
 * which so the screen can tell them.
 *
 * ## The lock, and the race it closes
 *
 * `B9`: *one slot per subcategory and emirate, enforced at booking.* This was a
 * read followed by a write with nothing between them, and the comment above it
 * claimed a partial unique index was the real enforcement — the index it named
 * is on `placement_waitlist`, not on `placement_slot`, which the standing audit
 * caught. Two sellers pressing the button in the same second would both have
 * seen the scope free and both have bought it, and `getSponsoredBusinessId`
 * carries a comment about what it does on the day that has happened.
 *
 * So the check and the write are one transaction behind an advisory lock on the
 * scope. A second booking for the same scope waits for the first to commit and
 * then finds the slot taken, which is the answer it should have had. Sellers
 * buying different scopes never wait for each other.
 */
export async function takeSlot(
  actor: Actor,
  businessId: string,
  categoryId: string,
  emirate: Emirate | null,
  now = new Date(),
): Promise<PlacementResult> {
  assertCanBuyPlacement(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: t("promote.refuse.not_yours") };
  }
  /*
     Nothing new is sold country-wide.

     The column stays nullable because slots bought before the emirate existed
     still run, and `slotsFor` still renders them. What is refused is *creating*
     another one: a national slot silently covers seven scopes, which is not a
     thing this screen sells or prices.
  */
  if (emirate === null) return { ok: false, error: t("promote.refuse.needs_emirate") };

  /*
     The plan gate, which this route did not have.

     `placement.purchase` says the seat may buy for its own business. It says
     nothing about whether the business's plan includes the thing being bought,
     and nothing here asked. So a Free-plan owner could take a slot —
     `sponsoredEligible` is seeded false for Free, has an editor at
     /admin/plans, renders as a row on the plan comparison grid and is promised
     in onboarding copy, and was read by nothing on the one route that sells it.

     Through `effectiveFor` rather than off `business.plan`, so a seller who
     bought eligibility and was later moved off it by a plan edit keeps what
     they paid for — the same grandfathering every other entitlement gets.
  */
  const plan = await effectiveFor(businessId);
  if (!plan) return { ok: false, error: t("promote.refuse.no_plan") };
  if (!hasEntitlement(plan, "sponsoredEligible")) {
    return { ok: false, error: t("promote.refuse.plan", { plan: plan.name }) };
  }

  const [price] = await priceScopes([{ categoryId, emirate }]);
  if (!price) return { ok: false, error: t("promote.refuse.no_scope") };

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scopeLock(categoryId, emirate)}))`;

    /*
       Anybody's slot over this scope that has not ended — the emirate itself,
       or a legacy country-wide one covering it.

       **No `startsOn <= now`, and the race test is why.** Two sellers pressing
       the button in the same second each carry their own clock, and the first
       one's slot starts a few microseconds after the second one's `now` — so a
       start-date condition made the freshly-committed slot invisible to the
       transaction waiting behind the lock, and the lock held while the check it
       protects answered wrongly. A slot that has not ended holds the scope
       whether it started a moment ago or starts tomorrow.
    */
    const existing = await tx.placementSlot.findFirst({
      where: {
        categoryId,
        OR: [{ emirate }, { emirate: null }],
        AND: [{ OR: [{ endsOn: null }, { endsOn: { gt: now } }] }],
      },
      orderBy: [{ startsOn: "asc" }, { id: "asc" }],
      select: { businessId: true },
    });

    if (existing) {
      if (existing.businessId === businessId) {
        return { ok: false as const, error: t("promote.refuse.already_yours") };
      }
      /*
       * Not an auction. A queue, in the order people joined it — and everybody
       * in it is told when the slot frees, first to answer takes it. Ratified
       * 17 Sep against holding it for whoever is first in line: a slot held for
       * somebody who has lost interest is a slot nobody has and nobody is
       * paying for.
       */
      const already = await tx.placementWaitlist.findFirst({
        where: { businessId, categoryId, emirate },
        select: { id: true },
      });
      if (!already) {
        await tx.placementWaitlist.create({ data: { businessId, categoryId, emirate } });
      }
      return { ok: true as const, queued: true };
    }

    /*
       Off the queue, because they are no longer waiting for it.

       Deleted rather than left with `notifiedAt` set: a row in a queue for a
       slot you already hold is a row that would put you second in line for your
       own placement the next time it frees.
    */
    await tx.placementWaitlist.deleteMany({ where: { businessId, categoryId, emirate } });

    await tx.placementSlot.create({
      data: {
        businessId,
        categoryId,
        emirate,
        /*
           Both stored, both frozen. The band is the decision — *this scope was
           in band 4 the day it was sold* — and the price is what that band cost
           then. Bands move on the first of each month; an invoice line that
           re-derived either would restate a charge already sent.
        */
        band: price.band,
        monthlyPriceAed: price.monthlyPriceAed,
        startsOn: now,
        /*
           The constant, not the same arithmetic written again. The first
           renewal after this moves `endsOn` to the subscription's own date,
           per D2.
        */
        endsOn: new Date(now.getTime() + SLOT_TERM_DAYS * 86_400_000),
      },
    });

    return { ok: true as const, queued: false, monthlyPriceAed: price.monthlyPriceAed };
  });
}

export async function leaveQueue(
  actor: Actor,
  businessId: string,
  categoryId: string,
  emirate: Emirate | null,
): Promise<PlacementResult> {
  assertCanBuyPlacement(actor);
  await prisma.placementWaitlist.deleteMany({
    where: { businessId: actor.businessId ?? businessId, categoryId, emirate },
  });
  return { ok: true, queued: false };
}
