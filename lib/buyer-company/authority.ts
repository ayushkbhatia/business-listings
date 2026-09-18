/**
 * Board `7b` — who may commit the company's money, and who must be asked.
 *
 * Pure: no database, no clock, no `t()`. The service calls it under the
 * company's lock with figures it read there; the rule card, the accept screen
 * and the approval queue call it with the same figures to say what will
 * happen. One function deciding, several screens describing — which is `B3`:
 * the queue must not behave in a way the card does not describe.
 *
 * ## The model
 *
 * **The gate is on accepting a quote** (`B1`). There is no order.
 *
 * Every member has an authority:
 *
 * - an **admin** commits any amount;
 * - **procurement** commits up to a monthly limit, counted from what they have
 *   already committed this Dubai calendar month (`B5`);
 * - a **requester** commits nothing — every quote they want accepted goes for
 *   approval.
 *
 * On top of that, the company's **rule**: a threshold above which a named
 * approver must approve whoever raised it, and an optional flag sending quotes
 * from unverified suppliers to the same approver.
 *
 * **Nobody approves their own request.** The approver is never the raiser, and
 * where the named approver raised it themselves, another admin approves — or,
 * with no other admin, nobody can, and the rule card says so rather than
 * letting the named approver wave their own acceptance through.
 *
 * A quote with **no single total** — a fee per visit, per month, per hour —
 * cannot be held against a number, so it counts as over every limit (`no_total`).
 */

export const BUYER_COMPANY_ROLES = ["company_admin", "procurement", "requester"] as const;
export type BuyerCompanyRole = (typeof BUYER_COMPANY_ROLES)[number];

export function isBuyerCompanyRole(value: string): value is BuyerCompanyRole {
  return (BUYER_COMPANY_ROLES as readonly string[]).includes(value);
}

export const APPROVAL_REASONS = [
  "over_threshold",
  "over_limit",
  "no_authority",
  "unverified_supplier",
  "no_total",
] as const;
export type ApprovalReason = (typeof APPROVAL_REASONS)[number];

/** The company's rule, as the gate reads it. Money in fils, as everywhere else. */
export interface ApprovalPolicy {
  /** Above this, the named approver approves. Null: no threshold. */
  thresholdFils: bigint | null;
  /** Null reads *an admin approves*. */
  approverId: string | null;
  unverifiedNeedsApproval: boolean;
}

/** One active member, with what they have already committed this month. */
export interface Seat {
  userId: string;
  role: BuyerCompanyRole;
  /** Procurement only. */
  monthlyLimitFils: bigint | null;
  /** Committed this Dubai month: quotes they accepted, and requests they approved. */
  usedFils: bigint;
}

/** What is being asked about. */
export interface Ask {
  /** Null for a quote with no single total. */
  valueFils: bigint | null;
  /** The supplier holds a verified trade licence (tier 2). */
  supplierVerified: boolean;
}

/**
 * Who may approve.
 *
 * - `named` — the company's approver, and only them.
 * - `admin` — any admin but the raiser.
 * - `authority` — anybody but the raiser whose own authority covers the value.
 */
export type ApproverRoute =
  | { kind: "named"; approverId: string }
  | { kind: "admin" }
  | { kind: "authority" };

export type ApprovalNeed =
  | { required: false }
  | { required: true; reasons: ApprovalReason[]; route: ApproverRoute };

/** An admin's authority has no ceiling. Never compared, only tested for. */
export function isUnlimited(seat: Pick<Seat, "role">): boolean {
  return seat.role === "company_admin";
}

/**
 * What is left of a person's authority this month. Null is unlimited; zero is
 * a requester, or a limit already spent.
 */
export function remainingFils(seat: Seat): bigint | null {
  if (seat.role === "company_admin") return null;
  if (seat.role === "requester" || seat.monthlyLimitFils === null) return 0n;
  const left = seat.monthlyLimitFils - seat.usedFils;
  return left > 0n ? left : 0n;
}

/** Whether this person's own authority covers the value. A null value is covered by no limit. */
export function authorityCovers(seat: Seat, valueFils: bigint | null): boolean {
  const left = remainingFils(seat);
  if (left === null) return true;
  if (valueFils === null) return false;
  return valueFils <= left;
}

/**
 * Whether accepting this quote needs somebody else's approval, why, and who
 * may give it.
 *
 * The reasons are every reason that holds, not the first — the approver reads
 * all of them, and a request over the threshold *and* from an unverified
 * supplier is two facts.
 */
export function approvalNeed(policy: ApprovalPolicy, raiser: Seat, ask: Ask): ApprovalNeed {
  const reasons: ApprovalReason[] = [];

  if (raiser.role === "requester") reasons.push("no_authority");

  if (ask.valueFils === null) {
    // An admin with no threshold to answer to commits a fee per visit as
    // readily as a fixed one; anybody with a ceiling cannot show it is under it.
    if (raiser.role !== "company_admin" || policy.thresholdFils !== null) reasons.push("no_total");
  } else {
    if (policy.thresholdFils !== null && ask.valueFils > policy.thresholdFils) reasons.push("over_threshold");
    if (raiser.role === "procurement" && !authorityCovers(raiser, ask.valueFils)) reasons.push("over_limit");
  }

  if (policy.unverifiedNeedsApproval && !ask.supplierVerified) reasons.push("unverified_supplier");

  if (reasons.length === 0) return { required: false };

  const ruleReason =
    reasons.includes("over_threshold") ||
    reasons.includes("unverified_supplier") ||
    (reasons.includes("no_total") && policy.thresholdFils !== null);

  let route: ApproverRoute;
  if (ruleReason) {
    route =
      policy.approverId && policy.approverId !== raiser.userId
        ? { kind: "named", approverId: policy.approverId }
        : { kind: "admin" };
  } else if (reasons.includes("no_total")) {
    // No threshold, but no total either: only an unlimited authority covers it.
    route = { kind: "admin" };
  } else {
    route = { kind: "authority" };
  }

  return { required: true, reasons: order(reasons), route };
}

/** The canonical order, so a stored array and a recomputed one compare equal. */
function order(reasons: ApprovalReason[]): ApprovalReason[] {
  return APPROVAL_REASONS.filter((reason) => reasons.includes(reason));
}

/**
 * Whether this person may approve this request.
 *
 * `approver` carries their own month so far: approving commits the company's
 * money on their authority, and procurement's limit counts it.
 */
export function mayApprove(
  route: ApproverRoute,
  approver: Seat,
  raiserId: string,
  valueFils: bigint | null,
): boolean {
  if (approver.userId === raiserId) return false;
  switch (route.kind) {
    case "named":
      return approver.userId === route.approverId && approver.role === "company_admin";
    case "admin":
      return approver.role === "company_admin";
    case "authority":
      return authorityCovers(approver, valueFils);
  }
}

/** Everybody on the team who may approve it. */
export function eligibleApprovers(
  route: ApproverRoute,
  seats: readonly Seat[],
  raiserId: string,
  valueFils: bigint | null,
): Seat[] {
  return seats.filter((seat) => mayApprove(route, seat, raiserId, valueFils));
}

/**
 * The gap the rule card has to name (`B3`): the named approver's own
 * acceptances over the threshold need a second admin, and there is none.
 */
export function approverHasNoCover(
  policy: Pick<ApprovalPolicy, "approverId" | "thresholdFils" | "unverifiedNeedsApproval">,
  seats: readonly Pick<Seat, "userId" | "role">[],
): boolean {
  if (!policy.approverId) return false;
  if (policy.thresholdFils === null && !policy.unverifiedNeedsApproval) return false;
  return !seats.some((seat) => seat.role === "company_admin" && seat.userId !== policy.approverId);
}

/** `25000` AED → fils. The threshold and limits are stored in whole dirhams. */
export function aedToFils(aed: number): bigint {
  return BigInt(Math.round(aed)) * 100n;
}
