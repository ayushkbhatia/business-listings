/**
 * The eight roles. Handoff 0 README §5 named nine; board 4i retired one.
 *
 * A person can hold more than one — a buyer who also sits on a supplier's team,
 * an ops lead who also buys — so an actor carries a list, and a check passes if
 * any held role grants the capability. What a person may not hold is more than
 * one *staff* role: board 4i's separation of duties says the person who can
 * credit an account must not also decide whether its listing is real, and
 * `lib/staff/service.ts` grants staff roles one at a time for that reason.
 */
export const ROLES = [
  "buyer",
  "seller_owner",
  "seller_manager",
  "seller_sales",
  "seller_finance",
  "staff_moderator",
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

/**
 * The staff roles, in the order board 4i's matrix draws its columns: the widest
 * grant first, the narrowest last.
 */
export const STAFF_ROLES = [
  "staff_ops_lead",
  "staff_moderator",
  "staff_finance",
] as const satisfies readonly Role[];

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRoleName(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/**
 * Staff roles that no longer exist, as history rather than as `Role`s.
 *
 * Deliberately a plain string and not a member of `ROLES`: board 4i `B1` is
 * that retired means removed, and a value `isRole()` still accepted would be a
 * value a claim, a seed or a form could still grant. This list exists so the
 * roster can say "1 retired" from a record rather than from a constant typed
 * into a header, and so the matrix can say where the holders went.
 */
export const RETIRED_STAFF_ROLES = [
  {
    name: "staff_field",
    retiredOn: "2026-09-05",
    /** Where its holders were moved, before the value was removed. Board 4i Q1. */
    holdersMovedTo: "staff_moderator",
    migration: "20261022091000_retire_field_verifier_4i",
  },
] as const satisfies readonly {
  name: string;
  retiredOn: string;
  holdersMovedTo: StaffRole;
  migration: string;
}[];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/** Whether two role lists grant the same thing. Order and repeats do not count. */
export function sameRoles(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((role) => right.has(role));
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
   * Declared ahead of the screen that fills it — board 7b, `/account/company`,
   * which since shipped: the column is now the mirror of an active
   * `buyer_company_member` row.
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
  /**
   * Set for a provisional identity: a buyer who sent an enquiry without an
   * account, known by the claim token their tracking link carries.
   *
   * It holds no role — `createProvisionalIdentity` gives it none until the
   * mobile is verified — and `can()` answers it from `CapabilitySpec.provisional`
   * instead, so what it may do is written on the matrix rather than decided by
   * whoever meets one. `getActor` never sets it: signing in is what claims the
   * identity. `actorFor` in ./actor.ts does, reading the record.
   */
  provisional?: true;
}

export function isStaff(actor: Actor): boolean {
  return actor.roles.some(isStaffRole);
}
