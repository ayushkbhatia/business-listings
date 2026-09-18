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
  /**
   * Board `7b`: where the buyer's company wants the tax invoice sent, and its
   * trade licence number — both for the invoice the supplier issues, so both
   * arrive with the rest at acceptance and not before.
   */
  companyAccountsEmail: string | null;
  companyLicence: string | null;
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
  buyerCompany: { select: { name: true, trn: true, accountsEmail: true, licenceNumber: true } },
} as const;

/**
 * The enquiry's own company, for the released view — board `7b`.
 *
 * An enquiry is raised for the company its sender bought for at the time. The
 * buyer's *current* company can differ — they may have moved — and a supplier
 * invoicing an accepted quote needs the company that accepted it.
 */
export const RELEASED_COMPANY_SELECT = { name: true, trn: true, accountsEmail: true, licenceNumber: true } as const;

export interface ReleasedCompany {
  name: string | null;
  trn: string | null;
  accountsEmail?: string | null;
  licenceNumber?: string | null;
}

interface RawBuyer {
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  buyerCompany?: ReleasedCompany | null;
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
  /** The enquiry's company, where the caller read it. Wins over the buyer's current one. */
  enquiryCompany?: ReleasedCompany | null,
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
    ...releasedCompany(enquiryCompany !== undefined ? enquiryCompany : (buyer?.buyerCompany ?? null)),
  };
}

/** Which select to use. Kept beside the narrowing so the two cannot diverge. */
export function buyerSelectFor(releasedTo: string | null | undefined, businessId: string) {
  return !releasedTo || releasedTo !== businessId
    ? MASKED_BUYER_SELECT
    : RELEASED_BUYER_SELECT;
}

function releasedCompany(company: ReleasedCompany | null) {
  return {
    companyName: company?.name ?? null,
    companyTrn: company?.trn ?? null,
    companyAccountsEmail: company?.accountsEmail ?? null,
    companyLicence: company?.licenceNumber ?? null,
  };
}
