import "server-only";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { capFor, type PlanCaps } from "@/lib/plan/entitlements";

/**
 * What happens to a seller's catalogue when their plan drops below it.
 *
 * Board 2e puts this in one sentence, in the rail, as the last thing a seller
 * reads before deciding: *"Cancel any month and drop to Free. Your products and
 * photos stay saved — hidden, not deleted."* Criterion 20 asks that `11f`
 * honour it, and criterion 13 asks the same of the trial ending.
 *
 * It was a claim rather than a behaviour. `cancelSubscription` had been
 * returning `kept: ["listing", "products", "reviews", "badge"]` since handoff 5
 * and nothing anywhere hid a product — so a Pro seller who cancelled kept a
 * hundred and fifty live products on the Free plan, and the cap that the whole
 * ladder rests on meant nothing after the first downgrade. Both halves of the
 * sentence were wrong at once: nothing was hidden, and the cap was not real.
 *
 * ## Hiding is `draft`, and that is the point
 *
 * Every public surface on this platform already excludes a draft product —
 * the storefront's catalogue, search, the category pages, the sitemap, the
 * RFQ fan-out's product matching. So hiding is a status flip and no read path
 * has to learn a new rule, which means none of them can forget one. A
 * `hiddenByPlan` boolean on `Product` would have been a second thing every one
 * of those queries had to remember.
 *
 * What that costs is the ability to tell a product the platform hid from a
 * draft the seller wrote, which matters exactly once: on the way back up.
 * `Subscription.hiddenByPlan` is the list, so an upgrade restores the products
 * the drop hid and leaves the seller's own drafts alone.
 *
 * ## What is not touched
 *
 * Photographs. The rail's sentence names them and they are safe by a different
 * route: `Media` has no published flag, and the photo cap is enforced on
 * upload rather than on display. Hiding them would mean deleting rows or adding
 * a column that every image query would have to respect, and the honest answer
 * is that a downgrade does not currently remove a photograph from a storefront.
 * The copy on 2e says products *and* photos stay saved, which is true of both;
 * it does not promise that both are hidden, and neither does this.
 */

/** The order a cap keeps. See `hideOverPlanCap`. */
const KEEP_ORDER = { createdAt: "asc" } as const;

export interface CapOutcome {
  /** How many products this call hid. Zero on a plan that caps nothing. */
  hidden: number;
  /** How many it put back. */
  restored: number;
}

/**
 * Hide whatever the new plan does not have room for.
 *
 * The oldest products are the ones that stay. A seller who was on Free, upgraded
 * to Pro and added a hundred and forty products is dropping back to the ten they
 * had before — those ten are the catalogue their listing was built on, and
 * keeping the newest instead would hide the products that earned them their
 * reviews.
 *
 * Idempotent, and additive: a second drop appends to the list rather than
 * replacing it, so a Pro → Basic → Free walk restores correctly on the way back.
 */
export async function hideOverPlanCap(
  businessId: string,
  plan: Pick<PlanCaps, "productLimit">,
  tx: Prisma.TransactionClient = prisma,
): Promise<CapOutcome> {
  const cap = capFor(plan as PlanCaps, "products");
  if (cap === null) return { hidden: 0, restored: 0 };

  const live = await tx.product.findMany({
    where: { businessId, status: "live" },
    orderBy: KEEP_ORDER,
    select: { id: true },
  });
  if (live.length <= cap) return { hidden: 0, restored: 0 };

  const over = live.slice(cap).map((product) => product.id);
  await tx.product.updateMany({
    where: { id: { in: over } },
    data: { status: "draft" },
  });

  const subscription = await tx.subscription.findUnique({
    where: { businessId },
    select: { hiddenByPlan: true },
  });
  const already = readHidden(subscription?.hiddenByPlan);

  await tx.subscription.updateMany({
    where: { businessId },
    data: { hiddenByPlan: [...new Set([...already, ...over])] as unknown as Prisma.InputJsonValue },
  });

  return { hidden: over.length, restored: 0 };
}

/**
 * Put back what a previous drop hid, as far as the new plan allows.
 *
 * Called on the way up. A seller who cancelled and came back should find their
 * catalogue where they left it, and finding it in drafts they have to republish
 * one at a time is a promise kept in the letter and broken in the spirit.
 *
 * Restores in the order they were hidden and stops at the new cap, so an
 * upgrade from Free to Basic brings back forty of the hundred and forty rather
 * than all of them and then hiding a hundred again on the next read.
 */
export async function restoreHiddenByPlan(
  businessId: string,
  plan: Pick<PlanCaps, "productLimit">,
  tx: Prisma.TransactionClient = prisma,
): Promise<CapOutcome> {
  const subscription = await tx.subscription.findUnique({
    where: { businessId },
    select: { hiddenByPlan: true },
  });
  const hidden = readHidden(subscription?.hiddenByPlan);
  if (hidden.length === 0) return { hidden: 0, restored: 0 };

  const cap = capFor(plan as PlanCaps, "products");
  const liveNow = await tx.product.count({ where: { businessId, status: "live" } });
  const room = cap === null ? hidden.length : Math.max(0, cap - liveNow);
  if (room === 0) return { hidden: 0, restored: 0 };

  /*
     Only rows that are still drafts and still this seller's. A product the
     seller deleted, or published again themselves, is not ours to move — and
     the id list is the platform's memory of what it did, not a claim about what
     the catalogue looks like now.
  */
  const candidates = await tx.product.findMany({
    where: { id: { in: hidden.slice(0, room) }, businessId, status: "draft" },
    select: { id: true },
  });
  const ids = candidates.map((product) => product.id);

  if (ids.length > 0) {
    await tx.product.updateMany({ where: { id: { in: ids } }, data: { status: "live" } });
  }

  const left = hidden.filter((id) => !ids.includes(id));
  await tx.subscription.updateMany({
    where: { businessId },
    data: {
      hiddenByPlan:
        left.length > 0 ? (left as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });

  return { hidden: 0, restored: ids.length };
}

/** The stored list, defensively. Anything that is not a list of ids is none. */
export function readHidden(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}
