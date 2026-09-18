import { normaliseTRN } from "@/lib/format/trn";

/**
 * Board `7b` — the four company details, read from a form.
 *
 * Pure, and strict where the downstream use is strict. The TRN goes on the tax
 * invoice the accepted supplier issues, so it is fifteen digits or it is
 * refused — spaces and dashes are forgiven, a fourteenth digit is not.
 * Nothing checks it against the FTA register, because nothing can (`B7`); the
 * form says so rather than printing `Matched`.
 */

export const DETAILS_LIMITS = {
  name: 160,
  licenceNumber: 40,
  accountsEmail: 254,
} as const;

export interface CompanyDetails {
  name: string;
  trn: string | null;
  licenceNumber: string | null;
  accountsEmail: string | null;
}

export type DetailsField = keyof CompanyDetails;
export type DetailsError = "required" | "too_long" | "invalid";

export type DetailsRead =
  | { ok: true; value: CompanyDetails }
  | { ok: false; errors: Partial<Record<DetailsField, DetailsError>> };

/** The shape an email must at least have. Deliverability is the carrier's to decide. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailShaped(value: string): boolean {
  return EMAIL.test(value);
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function readDetails(raw: Partial<Record<DetailsField, string>>): DetailsRead {
  const errors: Partial<Record<DetailsField, DetailsError>> = {};

  const name = (raw.name ?? "").replace(/\s+/g, " ").trim();
  if (!name) errors.name = "required";
  else if (name.length > DETAILS_LIMITS.name) errors.name = "too_long";

  const trnText = (raw.trn ?? "").trim();
  const trn = trnText ? normaliseTRN(trnText) : null;
  if (trnText && !trn) errors.trn = "invalid";

  // Licence numbers are written in capitals on every UAE licence; a lower-case
  // `ded-772104` is the same number and should not be a second one.
  const licenceNumber = (raw.licenceNumber ?? "").replace(/\s+/g, " ").trim().toUpperCase() || null;
  if (licenceNumber && licenceNumber.length > DETAILS_LIMITS.licenceNumber) errors.licenceNumber = "too_long";

  const emailText = normaliseEmail(raw.accountsEmail ?? "");
  const accountsEmail = emailText || null;
  if (accountsEmail && accountsEmail.length > DETAILS_LIMITS.accountsEmail) errors.accountsEmail = "too_long";
  else if (accountsEmail && !isEmailShaped(accountsEmail)) errors.accountsEmail = "invalid";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, trn, licenceNumber, accountsEmail } };
}

/** Which of the four changed. The history row records these and nothing else. */
export function changedDetails(before: CompanyDetails, after: CompanyDetails): DetailsField[] {
  return (Object.keys(after) as DetailsField[]).filter((field) => before[field] !== after[field]);
}
