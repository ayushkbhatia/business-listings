/**
 * Rule 1, in one file.
 *
 * "Contact details are released only on acceptance. Until a buyer accepts,
 * suppliers see the requirement and a first name. No number, no email, no
 * company name. This is the promise the whole RFQ flow rests on — one enquiry
 * must not become five cold calls. Enforce it at the query layer, not in the
 * template."
 *
 * So the decision lives here and the columns are never selected in the first
 * place. A screen cannot leak a field it was never handed, and a future screen
 * written by someone who has not read the README inherits the same guarantee.
 */

export interface MaskedBuyer {
  released: false;
  /** The one thing a seller sees before acceptance. */
  firstName: string;
}

export interface ReleasedBuyer {
  released: true;
  firstName: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  companyName: string | null;
  companyTrn: string | null;
}

export type SellerVisibleBuyer = MaskedBuyer | ReleasedBuyer;

/**
 * A first name is not contact information. It is what makes a thread read like
 * a conversation rather than a ticket, and it identifies nobody on its own.
 */
export function firstNameOf(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? "";
}

/** The Prisma select for a buyer a seller may not yet contact. */
export const MASKED_BUYER_SELECT = { fullName: true } as const;

/** The Prisma select once acceptance has released the details. */
export const RELEASED_BUYER_SELECT = {
  fullName: true,
  phone: true,
  email: true,
  buyerCompany: { select: { name: true, trn: true } },
} as const;

interface RawBuyer {
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  buyerCompany?: { name: string | null; trn: string | null } | null;
}

/**
 * Narrow a buyer row to what this business is allowed to see.
 *
 * `releasedTo` is `Enquiry.contactReleasedToBusinessId`. It is compared here
 * rather than trusted from a caller's boolean, because a boolean is the kind
 * of argument that gets passed the wrong way round exactly once.
 */
export function buyerForSeller(
  buyer: RawBuyer | null | undefined,
  releasedTo: string | null | undefined,
  businessId: string,
): SellerVisibleBuyer {
  const firstName = firstNameOf(buyer?.fullName);

  if (!releasedTo || releasedTo !== businessId) {
    return { released: false, firstName };
  }

  return {
    released: true,
    firstName,
    fullName: buyer?.fullName ?? null,
    phone: buyer?.phone ?? null,
    email: buyer?.email ?? null,
    companyName: buyer?.buyerCompany?.name ?? null,
    companyTrn: buyer?.buyerCompany?.trn ?? null,
  };
}

/** Which select to use. Kept beside the narrowing so the two cannot diverge. */
export function buyerSelectFor(releasedTo: string | null | undefined, businessId: string) {
  return !releasedTo || releasedTo !== businessId
    ? MASKED_BUYER_SELECT
    : RELEASED_BUYER_SELECT;
}
