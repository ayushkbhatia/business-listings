import { SELLER_ROLES, type Role } from "@/lib/auth/roles";

/**
 * Who holds an owner seat on a listing while it is claimed, contested and
 * decided. Pure: these return the row a caller writes, inside its own
 * transaction.
 *
 * The rule (decided 1 Oct 2026, board 4c): **only an uncontested claim attaches
 * a seat when it is submitted.** A claim that opens or joins a conflict — a
 * second claim on a listing nobody owns yet, or any claim on a listing that
 * already has an owner — gets its seat only if it is awarded, and every claim
 * that loses gives back the seat it was holding, in the award's transaction.
 *
 * Before this, "Report a dispute" on a claimed listing handed the challenger
 * `seller_owner` on somebody else's business the moment they pressed submit,
 * and the loser of an award kept the seat their claim had attached.
 */

export interface SeatHolder {
  businessId: string | null;
  roles: readonly Role[];
}

/** The seat an awarded claim gets: this listing, as its owner. Every other role is kept. */
export function seatOnAward(user: SeatHolder, businessId: string): { businessId: string; roles: Role[] } {
  return {
    businessId,
    roles: user.roles.includes("seller_owner") ? [...user.roles] : [...user.roles, "seller_owner"],
  };
}

/**
 * The seat a claim that lost gives back — only the owner seat on this listing.
 *
 * Null where there is nothing to take: the person holds no seat here (the
 * usual case for the side of a conflict that never got one). Another seller
 * role on this listing keeps the seat, since that came from somewhere other
 * than the claim; a person left with no role at all is a buyer again, which is
 * what everybody who signs up starts as.
 */
export function seatOnLoss(user: SeatHolder, businessId: string): { businessId: string | null; roles: Role[] } | null {
  if (user.businessId !== businessId || !user.roles.includes("seller_owner")) return null;
  const kept = user.roles.filter((role) => role !== "seller_owner");
  const stillSeated = kept.some((role) => (SELLER_ROLES as readonly string[]).includes(role));
  return {
    businessId: stillSeated ? businessId : null,
    roles: kept.length > 0 ? kept : ["buyer"],
  };
}
