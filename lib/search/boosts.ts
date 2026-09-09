import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import type { Emirate } from "@/lib/db/generated/client";
import { t } from "@/lib/i18n";
import { MAX_BOOST_DAYS, MAX_BOOST_POINTS } from "./ranking";

/**
 * Board `12c` — the boosts, and the budget one business may hold.
 *
 * A boost is ops moving a listing for a reason of ours. It is never labelled
 * sponsored, because nobody paid for it — a sold slot is a `PlacementSlot`, is
 * one per results page, and carries a label.
 *
 * Both the reason and the expiry are `NOT NULL` in the database. The failure
 * mode of a manual override is not that somebody abuses it; it is that somebody
 * helps a supplier out for a fortnight and the results are still bent three
 * years later, with nobody able to say why.
 *
 * ## Two kinds of target, one budget
 *
 * A boost names a listing or a category, never both. *"Thin supply — surfacing
 * the few we have"* is a statement about a category, and drawing it as four
 * identical business boosts would be four reasons where there is one.
 *
 * The cap is `MAX_BOOST_POINTS` **per business**, summing every live boost that
 * reaches it — its own, and the category boosts it falls under. Q7 on the
 * board, and the reason it is answered rather than left open: `liveBoosts` used
 * to sum without a ceiling, so five stacked maximum boosts was +125 against
 * weights that total 100. That is not a nudge, it is a replacement of the
 * ranking. Counting category boosts is what stops the cap being walked around
 * by aiming one category higher instead of one listing.
 */

export type BoostRefusal =
  | "not_found"
  | "category_not_found"
  | "no_target"
  | "two_targets"
  | "emirate_without_category"
  | "points_out_of_range"
  | "expiry_in_the_past"
  | "expiry_too_far"
  | "budget_exceeded";

export interface BudgetBreach {
  businessId: string;
  businessName: string;
  /** Points already live on this business before the new boost. */
  held: number;
  /** What the new boost would take it to. */
  wouldHold: number;
  /** The live boosts spending the budget, most expensive first. */
  spentOn: readonly { id: string; label: string; points: number }[];
}

export type BoostResult =
  | { ok: true; id: string }
  | { ok: false; error: BoostRefusal; message: string; breach?: BudgetBreach };

/**
 * One live boost, resolved to the business it reaches.
 *
 * A category boost produces one of these per member business, all sharing the
 * boost's own id — which is what lets the budget count it once against each
 * member and still name a single row on the board.
 */
export interface BoostReach {
  boostId: string;
  points: number;
  /** For the refusal message. The business name, or the category and scope. */
  label: string;
}

export interface BoostTarget {
  businessId?: string | null;
  categoryId?: string | null;
  emirate?: Emirate | null;
}

export interface BoostInput extends BoostTarget {
  actor: Actor;
  points: number;
  reason: string;
  expiresAt: Date;
}

function targetLabel(row: {
  business: { displayName: string } | null;
  category: { name: string } | null;
  emirate: Emirate | null;
}): string {
  if (row.business) return row.business.displayName;
  const name = row.category?.name ?? "";
  return row.emirate
    ? t("ranking.boost.category_scope", { category: name, emirate: t(`emirate.${row.emirate}` as never) })
    : t("ranking.boost.category_all", { category: name });
}

interface LiveBoostRow {
  id: string;
  businessId: string | null;
  categoryId: string | null;
  emirate: Emirate | null;
  points: number;
  business: { displayName: string } | null;
  category: { name: string } | null;
}

async function liveBoostRows(now: Date): Promise<LiveBoostRow[]> {
  return prisma.listingBoost.findMany({
    where: { expiresAt: { gt: now } },
    select: {
      id: true,
      businessId: true,
      categoryId: true,
      emirate: true,
      points: true,
      business: { select: { displayName: true } },
      category: { select: { name: true } },
    },
  });
}

/**
 * Which businesses each live category boost actually reaches.
 *
 * Membership is the business's own trade — its primary category or one it is
 * linked to — narrowed to an emirate where the boost names one, and an emirate
 * means a **published** branch there. An unpublished branch is not a presence a
 * buyer can find, so it is not one a boost should be paying for.
 *
 * Suspended and unpublished listings are included on purpose. The cap is a
 * statement about what a business holds, and a business that is dark today and
 * live tomorrow must not come back holding 125 points.
 */
async function categoryReach(rows: readonly LiveBoostRow[]): Promise<Map<string, BoostReach[]>> {
  const categoryBoosts = rows.filter((row) => row.categoryId !== null);
  const byBusiness = new Map<string, BoostReach[]>();
  if (categoryBoosts.length === 0) return byBusiness;

  const categoryIds = [...new Set(categoryBoosts.map((row) => row.categoryId as string))];
  const members = await prisma.business.findMany({
    where: {
      OR: [
        { primaryCategoryId: { in: categoryIds } },
        { categories: { some: { categoryId: { in: categoryIds } } } },
      ],
    },
    select: {
      id: true,
      primaryCategoryId: true,
      categories: { select: { categoryId: true } },
      locations: { where: { published: true }, select: { emirate: true } },
    },
  });

  for (const member of members) {
    const trades = new Set([
      member.primaryCategoryId,
      ...member.categories.map((link) => link.categoryId),
    ]);
    const emirates = new Set(member.locations.map((location) => location.emirate));

    for (const boost of categoryBoosts) {
      if (!trades.has(boost.categoryId as string)) continue;
      if (boost.emirate && !emirates.has(boost.emirate)) continue;

      const reach: BoostReach = {
        boostId: boost.id,
        points: boost.points,
        label: targetLabel(boost),
      };
      const bucket = byBusiness.get(member.id);
      if (bucket) bucket.push(reach);
      else byBusiness.set(member.id, [reach]);
    }
  }

  return byBusiness;
}

/**
 * Every live boost reaching each business, business-targeted and category alike.
 *
 * The budget reads this and so does the board's stacking line. `liveBoosts`
 * below is the same thing summed, which is all the ranker needs.
 */
export async function liveBoostReach(now = new Date()): Promise<Map<string, BoostReach[]>> {
  const rows = await liveBoostRows(now);
  const byBusiness = await categoryReach(rows);

  for (const row of rows) {
    if (row.businessId === null) continue;
    const reach: BoostReach = {
      boostId: row.id,
      points: row.points,
      label: targetLabel(row),
    };
    const bucket = byBusiness.get(row.businessId);
    if (bucket) bucket.push(reach);
    else byBusiness.set(row.businessId, [reach]);
  }

  return byBusiness;
}

/** Live boost points per business, for the ranking to add on. */
export async function liveBoosts(now = new Date()): Promise<Map<string, number>> {
  const reach = await liveBoostReach(now);
  const totals = new Map<string, number>();
  for (const [businessId, entries] of reach) {
    totals.set(
      businessId,
      entries.reduce((sum, entry) => sum + entry.points, 0),
    );
  }
  return totals;
}

const BOOST_MESSAGE: Record<Exclude<BoostRefusal, "budget_exceeded">, string> = {
  not_found: "boost.not_found",
  category_not_found: "boost.category_not_found",
  no_target: "boost.no_target",
  two_targets: "boost.two_targets",
  emirate_without_category: "boost.emirate_without_category",
  points_out_of_range: "boost.points_out_of_range",
  expiry_in_the_past: "boost.expiry_in_the_past",
  expiry_too_far: "boost.expiry_too_far",
};

function refuse(error: Exclude<BoostRefusal, "budget_exceeded">, params?: Record<string, string | number>): BoostResult {
  return { ok: false, error, message: t(`ranking.${BOOST_MESSAGE[error]}` as never, params) };
}

export async function boostListing(input: BoostInput, now = new Date()): Promise<BoostResult> {
  const businessId = input.businessId?.trim() || null;
  const categoryId = input.categoryId?.trim() || null;

  if (businessId && categoryId) return refuse("two_targets");
  if (!businessId && !categoryId) return refuse("no_target");
  if (input.emirate && !categoryId) return refuse("emirate_without_category");

  if (!Number.isInteger(input.points) || input.points < 1 || input.points > MAX_BOOST_POINTS) {
    return refuse("points_out_of_range", { max: MAX_BOOST_POINTS });
  }
  if (input.expiresAt <= now) return refuse("expiry_in_the_past");
  if (input.expiresAt.getTime() - now.getTime() > MAX_BOOST_DAYS * 86_400_000) {
    return refuse("expiry_too_far", { days: MAX_BOOST_DAYS });
  }

  const target = businessId
    ? await prisma.business.findUnique({
        where: { id: businessId },
        select: { id: true, displayName: true },
      })
    : await prisma.category.findUnique({
        where: { id: categoryId as string },
        select: { id: true, name: true },
      });
  if (!target) return refuse(businessId ? "not_found" : "category_not_found");

  const breach = await budgetBreach(
    { businessId, categoryId, emirate: input.emirate ?? null },
    input.points,
    now,
  );
  if (breach) {
    return {
      ok: false,
      error: "budget_exceeded",
      message: t("ranking.boost.budget_exceeded", {
        business: breach.businessName,
        held: breach.held,
        max: MAX_BOOST_POINTS,
        spent: breach.spentOn.map((entry) => `${entry.label} +${entry.points}`).join(", "),
      }),
      breach,
    };
  }

  const subject: `${string}:${string}` = businessId
    ? `Business:${businessId}`
    : `Category:${categoryId as string}`;

  const id = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "placement.boost",
        subject,
        reason: input.reason,
        tx,
      },
      async () => {
        const row = await tx.listingBoost.create({
          data: {
            businessId,
            categoryId,
            emirate: input.emirate ?? null,
            points: input.points,
            // The same words as the audit row. A boost read from the listing
            // should not need the audit log to explain itself.
            reason: input.reason,
            expiresAt: input.expiresAt,
            createdById: input.actor.id,
          },
          select: { id: true },
        });
        return {
          result: row.id,
          before: null,
          after: {
            points: input.points,
            expiresAt: input.expiresAt.toISOString(),
            ...(categoryId ? { categoryId, emirate: input.emirate ?? null } : { businessId }),
          },
        };
      },
    ),
  );

  return { ok: true, id };
}

/**
 * The business a proposed boost would push past the cap, if any.
 *
 * For a listing boost that is one business. For a category boost it is every
 * member, and the one reported is the one with the least headroom — naming the
 * tightest is what tells an ops lead how much they could add instead, and a
 * message that listed forty businesses would be read by nobody.
 */
export async function budgetBreach(
  target: BoostTarget,
  points: number,
  now = new Date(),
): Promise<BudgetBreach | null> {
  const reach = await liveBoostReach(now);

  const affected: string[] = [];
  if (target.businessId) {
    affected.push(target.businessId);
  } else if (target.categoryId) {
    const members = await prisma.business.findMany({
      where: {
        AND: [
          {
            OR: [
              { primaryCategoryId: target.categoryId },
              { categories: { some: { categoryId: target.categoryId } } },
            ],
          },
          target.emirate
            ? { locations: { some: { published: true, emirate: target.emirate } } }
            : {},
        ],
      },
      select: { id: true },
    });
    affected.push(...members.map((member) => member.id));
  }

  let worst: BudgetBreach | null = null;
  for (const businessId of affected) {
    const entries = reach.get(businessId) ?? [];
    const held = entries.reduce((sum, entry) => sum + entry.points, 0);
    const wouldHold = held + points;
    if (wouldHold <= MAX_BOOST_POINTS) continue;
    if (worst && held <= worst.held) continue;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { displayName: true },
    });
    worst = {
      businessId,
      businessName: business?.displayName ?? businessId,
      held,
      wouldHold,
      spentOn: [...entries]
        .sort((a, b) => b.points - a.points)
        .map((entry) => ({ id: entry.boostId, label: entry.label, points: entry.points })),
    };
  }

  return worst;
}

export interface BoostView {
  id: string;
  /** The business or the category and scope, already localised. */
  target: string;
  /** Null on a category boost — it has no single storefront to link to. */
  businessId: string | null;
  categoryId: string | null;
  points: number;
  reason: string;
  author: string;
  createdAt: Date;
  expiresAt: Date;
  expired: boolean;
  /**
   * How the board says the cap is being spent.
   *
   * On a business boost, the points that business holds in total and the other
   * boosts making up the difference — *18 of 25, stacks with Chiller AMC*. On a
   * category boost, what it costs every member. Null where nothing stacks and
   * the row would be stating the obvious.
   */
  stacking: { held: number; max: number; with: readonly string[] } | null;
  /** Category boosts only: what this spends of every member's budget. */
  spendsPerMember: number | null;
}

/** Boosts, live ones first. Expired ones stay visible — they explain history. */
export async function boostList(now = new Date()): Promise<BoostView[]> {
  const [rows, reach] = await Promise.all([
    prisma.listingBoost.findMany({
      orderBy: [{ expiresAt: "desc" }],
      take: 200,
      select: {
        id: true,
        businessId: true,
        categoryId: true,
        emirate: true,
        points: true,
        reason: true,
        createdAt: true,
        expiresAt: true,
        business: { select: { displayName: true } },
        category: { select: { name: true } },
        createdBy: { select: { fullName: true, email: true } },
      },
    }),
    liveBoostReach(now),
  ]);

  return rows.map((row) => {
    const expired = row.expiresAt <= now;
    const entries = row.businessId ? (reach.get(row.businessId) ?? []) : [];
    const held = entries.reduce((sum, entry) => sum + entry.points, 0);
    const others = entries.filter((entry) => entry.boostId !== row.id).map((entry) => entry.label);

    return {
      id: row.id,
      target: targetLabel(row),
      businessId: row.businessId,
      categoryId: row.categoryId,
      points: row.points,
      reason: row.reason,
      author: row.createdBy.fullName ?? row.createdBy.email ?? "",
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      expired,
      stacking:
        !expired && row.businessId && others.length > 0
          ? { held, max: MAX_BOOST_POINTS, with: others }
          : null,
      spendsPerMember: row.categoryId && !expired ? row.points : null,
    };
  });
}
