import { t } from "@/lib/i18n";

/**
 * Errors the compare page can be sent back with.
 *
 * Not in actions.ts: a `"use server"` module may only export async functions,
 * and everything it exports becomes a callable endpoint. A pure string mapping
 * has no business being either.
 */
export function acceptErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case "already_accepted":
      return t("compare.error_already_accepted");
    case "quote_expired":
      return t("compare.error_expired");
    case "not_found":
      return t("compare.error_not_found");
    case "not_open":
      return t("compare.error_not_open");
    case "revised":
      return t("compare.error_revised");
    case "supplier_closed":
      return t("compare.error_supplier_closed");
    case "enquiry_closed":
      return t("compare.error_enquiry_closed");
    case "not_permitted":
      return t("compare.error_not_permitted");
    default:
      return null;
  }
}
