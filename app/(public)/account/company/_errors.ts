import { t } from "@/lib/i18n";
import type { AddressField } from "@/lib/buyer-company/address";
import type { DetailsField } from "@/lib/buyer-company/details";
import { ADDRESS_LIMITS } from "@/lib/buyer-company/address";
import { DETAILS_LIMITS } from "@/lib/buyer-company/details";
import { formatAED } from "@/lib/format";
import { LIMIT_MAX_AED } from "@/lib/buyer-company/team";

/**
 * Board `7b` — every refusal a company screen can be handed, in words.
 *
 * Not in `actions.ts`: a `"use server"` module may only export async
 * functions, and each export becomes an endpoint. The voice rule applies to all
 * of them — say what is wrong and what right looks like, never blame the
 * person.
 */

const MESSAGES: Record<string, () => string> = {
  not_member: () => t("company.error.not_member"),
  not_admin: () => t("company.error.not_admin"),
  already_member: () => t("company.error.already_member"),
  provisional: () => t("company.error.provisional"),
  already_invited: () => t("company.error.already_invited"),
  not_found: () => t("company.error.not_found"),
  too_soon: () => t("company.error.too_soon"),
  last_admin: () => t("company.error.last_admin"),
  is_approver: () => t("company.error.is_approver"),
  is_self: () => t("company.error.is_self"),
  approver_not_admin: () => t("company.error.approver_not_admin"),
  invalid_threshold: () => t("company.error.invalid_threshold"),
  threshold_too_large: () => t("company.error.threshold_too_large", { max: formatAED(LIMIT_MAX_AED) }),
  area_mismatch: () => t("company.error.area_mismatch"),
  default_needs_replacement: () => t("company.error.default_needs_replacement"),
  not_approver: () => t("company.error.not_approver"),
  approval_closed: () => t("company.error.approval_closed"),
  approval_changed: () => t("company.error.approval_changed"),
  note_required: () => t("company.error.note_required"),
  answer_required: () => t("company.error.answer_required"),
  note_too_long: () => t("company.error.note_too_long"),
  not_queried: () => t("company.error.not_queried"),
  closed: () => t("company.error.approval_closed"),
  approval_required: () => t("company.error.approval_required"),
  po_required: () => t("company.error.po_required"),
  cost_code_required: () => t("company.error.cost_code_required"),
  reference_invalid: () => t("company.error.reference_invalid"),
  personal: () => t("company.error.personal"),
  not_needed: () => t("company.error.not_needed"),
  no_approver: () => t("company.error.no_approver"),
  // The acceptance's own refusals, as the compare page words them.
  already_accepted: () => t("compare.error_already_accepted"),
  quote_expired: () => t("compare.error_expired"),
  not_open: () => t("compare.error_not_open"),
  revised: () => t("compare.error_revised"),
  supplier_closed: () => t("compare.error_supplier_closed"),
  enquiry_closed: () => t("compare.error_enquiry_closed"),
  not_yours: () => t("compare.error_not_found"),
  // Joining.
  expired: () => t("company.join.expired"),
  revoked: () => t("company.join.revoked"),
  used: () => t("company.join.used"),
  wrong_account: () => t("company.join.wrong_account"),
  other_company: () => t("company.join.other_company"),
};

export function companyError(code: string): string {
  return (MESSAGES[code] ?? (() => t("company.error.generic")))();
}

export function detailsFieldMessage(field: DetailsField, code: string): string {
  if (code === "required") return t("company.field.required");
  if (code === "too_long") {
    return t("company.field.too_long", { max: String(DETAILS_LIMITS[field as keyof typeof DETAILS_LIMITS] ?? 160) });
  }
  if (field === "trn") return t("company.details.trn_invalid");
  if (field === "accountsEmail") return t("company.field.email_invalid");
  return t("company.field.invalid");
}

export function addressFieldMessage(field: AddressField, code: string): string {
  if (code === "required") return t("company.field.required");
  if (code === "too_long") {
    return t("company.field.too_long", { max: String(ADDRESS_LIMITS[field as keyof typeof ADDRESS_LIMITS] ?? 160) });
  }
  if (code === "window_order") return t("company.address.window_order");
  if (field === "attnPhone") return t("company.address.phone_invalid");
  if (field === "accessFrom" || field === "accessUntil") return t("company.address.time_invalid");
  return t("company.field.invalid");
}

export function seatFieldMessage(field: string, code: string): string {
  if (code === "required") return field === "monthlyLimitAed" ? t("company.team.limit_required") : t("company.field.required");
  if (code === "too_large") return t("company.error.threshold_too_large", { max: formatAED(LIMIT_MAX_AED) });
  if (field === "monthlyLimitAed") return t("company.team.limit_invalid");
  return t("company.field.invalid");
}

export function inviteFieldMessage(field: string, code: string): string {
  if (field === "email" && code === "invalid") return t("company.field.email_invalid");
  if (code === "too_long") return t("company.field.too_long", { max: "120" });
  return seatFieldMessage(field, code);
}
