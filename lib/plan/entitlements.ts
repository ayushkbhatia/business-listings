/**
 * What a plan allows, in one place.
 *
 * Every cap already lives on the `Plan` row as a real column — this does not
 * restate them. It answers the two questions a screen actually asks, which the
 * columns alone do not:
 *
 *   1. Is this seller allowed to do X right now, given what they have already
 *      used this month?
 *   2. If not, which plan is the cheapest one that would let them?
 *
 * The second question is board 11a's entire job. A locked panel that says
 * "upgrade" is an advert; one that says "Basic, AED 349" is an answer.
 *
 * `null` on a cap means unlimited, matching the schema. Guard on `=== null`
 * rather than falsiness: zero is a real cap and would read as unlimited.
 */

/** The subset of a Plan row this module needs. Structural, so tests need no database. */
export interface PlanCaps {
  id: string;
  name: string;
  monthlyPriceAed: number;
  enquiriesPerMonth: number | null;
  productLimit: number | null;
  locationLimit: number | null;
  photoLimit: number | null;
  /// Megabytes of storage. Null is unlimited. Board 3i's header states it.
  storageMb: number | null;
  teamSeats: number;
  rankingMultiplier: number;
  customDomain: boolean;
  sortOrder: number;
}

/**
 * The caps a subscription was signed up on.
 *
 * `Subscription.entitlementSnapshot` has existed since handoff 3 with a doc
 * comment promising grandfathering, and all three writers stored
 * `{ planId, capturedAt }` — no cap values at all, and `planId` already on the
 * same row. Nothing read it. So "grandfathered" was written down as a fact and
 * was not one: changing a `Plan` row moved every account on it immediately.
 *
 * A snapshot now carries the numbers. `effectiveCaps` prefers it, so a seller
 * keeps what they signed up for until somebody explicitly applies a change to
 * existing accounts.
 */
export interface EntitlementSnapshot {
  planId: string;
  capturedAt: string;
  enquiriesPerMonth: number | null;
  productLimit: number | null;
  locationLimit: number | null;
  photoLimit: number | null;
  /**
   * Frozen with the rest. A seller who signed up on 10 GB keeps 10 GB.
   *
   * Optional on the type rather than required, because every snapshot written
   * before board 3i has no such key and reading one must not make a seller's
   * allowance `undefined` — `effectiveCaps` falls back to the live plan.
   */
  storageMb?: number | null;
  teamSeats: number;
  customDomain: boolean;
}

/** Everything a snapshot needs to freeze, taken from the live plan. */
export function snapshotOf(plan: PlanCaps, capturedAt: Date): EntitlementSnapshot {
  return {
    planId: plan.id,
    capturedAt: capturedAt.toISOString(),
    enquiriesPerMonth: plan.enquiriesPerMonth,
    productLimit: plan.productLimit,
    locationLimit: plan.locationLimit,
    photoLimit: plan.photoLimit,
    storageMb: plan.storageMb,
    teamSeats: plan.teamSeats,
    customDomain: plan.customDomain,
  };
}

/** A snapshot, if the stored value is one. Anything older reads as absent. */
export function readSnapshot(value: unknown): EntitlementSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EntitlementSnapshot>;
  /*
   * The old shape — `{ planId, capturedAt }` and nothing else — is not a
   * snapshot and must not be treated as one. Reading it as if it froze caps
   * would silently give every existing subscription `undefined` for every cap,
   * which `capFor` would then read as unlimited.
   */
  if (typeof candidate.planId !== "string") return null;
  if (typeof candidate.teamSeats !== "number") return null;
  return candidate as EntitlementSnapshot;
}

/**
 * What this subscription is actually entitled to.
 *
 * The snapshot wins where there is one, so an account keeps the caps it signed
 * up on. The live plan supplies the name, the price and the ranking multiplier
 * either way: those are facts about the plan today, not about what somebody
 * bought, and a grandfathered seller is still on "Pro" at Pro's price.
 */
export function effectiveCaps(plan: PlanCaps, snapshot: unknown): PlanCaps {
  const frozen = readSnapshot(snapshot);
  if (!frozen || frozen.planId !== plan.id) return plan;

  return {
    ...plan,
    enquiriesPerMonth: frozen.enquiriesPerMonth,
    productLimit: frozen.productLimit,
    locationLimit: frozen.locationLimit,
    photoLimit: frozen.photoLimit,
    // A pre-3i snapshot has no storage key at all. Falling back to the live
    // plan is the honest reading: nothing was frozen, so nothing is owed.
    storageMb: frozen.storageMb === undefined ? plan.storageMb : frozen.storageMb,
    teamSeats: frozen.teamSeats,
    customDomain: frozen.customDomain,
  };
}

/** The capped resources. Named because a screen asks about one of them by name. */
export const METERED = ["enquiries", "products", "locations", "photos", "seats", "storage"] as const;
export type Metered = (typeof METERED)[number];

const CAP_OF: Record<Metered, (p: PlanCaps) => number | null> = {
  enquiries: (p) => p.enquiriesPerMonth,
  products: (p) => p.productLimit,
  locations: (p) => p.locationLimit,
  photos: (p) => p.photoLimit,
  seats: (p) => p.teamSeats,
  // Megabytes, not a count. `allowance` is unit-agnostic — it compares a used
  // figure to a cap — so storage rides the same path as the other five and the
  // "visible before it bites" rule is one implementation, not six.
  storage: (p) => p.storageMb,
};

/** The plan's cap for one resource. `null` is unlimited. */
export function capFor(plan: PlanCaps, what: Metered): number | null {
  return CAP_OF[what](plan);
}

export interface Allowance {
  /** How many more may be added. `null` when the plan does not cap this. */
  remaining: number | null;
  /** True when the plan caps this and the seller has reached it. */
  atCap: boolean;
  cap: number | null;
  used: number;
}

/**
 * What is left. `used` above the cap returns zero remaining rather than a
 * negative — a plan downgrade can legitimately leave a seller over their cap,
 * and "you have -12 products left" is not a sentence.
 */
export function allowance(plan: PlanCaps, what: Metered, used: number): Allowance {
  const cap = capFor(plan, what);
  if (cap === null) return { remaining: null, atCap: false, cap: null, used };
  return { remaining: Math.max(0, cap - used), atCap: used >= cap, cap, used };
}

/**
 * The cheapest plan that raises this cap above what the seller is using.
 *
 * Returns null when they are already on the best plan for it, which is the
 * signal to render a limit as a plain fact rather than as an upsell. Never
 * suggests a plan that would not actually help: a plan whose cap is the same
 * or lower is not an upgrade for this resource, whatever it costs.
 */
export function cheapestPlanUnlocking(
  plans: readonly PlanCaps[],
  what: Metered,
  used: number,
  currentPlanId: string,
): PlanCaps | null {
  const current = plans.find((p) => p.id === currentPlanId);
  const currentCap = current ? capFor(current, what) : 0;
  if (currentCap === null) return null;

  const better = plans
    .filter((p) => p.id !== currentPlanId)
    .filter((p) => p.monthlyPriceAed > (current?.monthlyPriceAed ?? 0))
    .filter((p) => {
      const cap = capFor(p, what);
      return cap === null || (cap > currentCap && cap > used);
    })
    .sort((a, b) => a.monthlyPriceAed - b.monthlyPriceAed);

  return better[0] ?? null;
}

/**
 * The cheapest plan carrying a boolean feature the seller does not have.
 * Same contract as above: null means nothing to sell.
 */
export function cheapestPlanWith(
  plans: readonly PlanCaps[],
  // One feature left since site visits were withdrawn. Kept as a union rather
  // than inlined, because the next boolean entitlement wants this shape back.
  feature: "customDomain",
  currentPlanId: string,
): PlanCaps | null {
  const current = plans.find((p) => p.id === currentPlanId);
  if (current?.[feature]) return null;

  return (
    plans
      .filter((p) => p[feature])
      .filter((p) => p.monthlyPriceAed > (current?.monthlyPriceAed ?? 0))
      .sort((a, b) => a.monthlyPriceAed - b.monthlyPriceAed)[0] ?? null
  );
}

/** First day of the month a date falls in, in UTC. The cap is calendar-monthly. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
