/**
 * The nine roles, verbatim from handoff 0 README §5.
 *
 * A person can hold more than one — a small operations team will have somebody
 * who is both finance and ops lead — so an actor carries a list, and a check
 * passes if any held role grants the capability.
 */
export const ROLES = [
  "buyer",
  "seller_owner",
  "seller_manager",
  "seller_sales",
  "seller_finance",
  "staff_moderator",
  "staff_field",
  "staff_finance",
  "staff_ops_lead",
] as const;

export type Role = (typeof ROLES)[number];

export const SELLER_ROLES = [
  "seller_owner",
  "seller_manager",
  "seller_sales",
  "seller_finance",
] as const satisfies readonly Role[];

export const STAFF_ROLES = [
  "staff_moderator",
  "staff_field",
  "staff_finance",
  "staff_ops_lead",
] as const satisfies readonly Role[];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isStaffRole(role: Role): boolean {
  return (STAFF_ROLES as readonly Role[]).includes(role);
}

export function isSellerRole(role: Role): boolean {
  return (SELLER_ROLES as readonly Role[]).includes(role);
}

/**
 * Who is acting. Resolved server-side from the session; never taken from a
 * request body, a header or a prop.
 */
export interface Actor {
  id: string;
  roles: readonly Role[];
  /** Set for a seller role. A seller capability is scoped to their own business. */
  businessId?: string;
  /**
   * Set where a sales seat is scoped to one branch.
   *
   * Board 7d shows Fatima scoped to Al Quoz: every capability she holds is
   * further limited to that branch's enquiries and locations. Undefined means
   * unscoped, which is what an owner, a manager and most sales seats are —
   * scoping is opt-in, and absent it nothing narrows.
   */
  branchId?: string;
  /**
   * Set where the acting person belongs to a buyer company.
   *
   * The buyer-side counterpart to `businessId`, and it exists for the same
   * reason: `BuyerCompany` carries a TRN, a member list and the approval
   * threshold a procurement team sets for itself, and none of those can be
   * enforced by a check that cannot see which company is asking.
   *
   * Declared ahead of the screen that fills it — board 7b, `/account/company`.
   * That is the opposite order from `branchId`, which was read by
   * `withinScope()` for four handoffs while nothing populated it, so every
   * branch-scoped check quietly returned true. Here the badge and its writer
   * land together: `getActor` populates this from the profile row today, and it
   * is absent rather than wrong for every buyer who has no company yet.
   *
   * Unlike `businessId` it has no JWT claim, deliberately. See the note in
   * ./session.ts.
   */
  buyerCompanyId?: string;
}

export function isStaff(actor: Actor): boolean {
  return actor.roles.some(isStaffRole);
}
