import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  ENQUIRY_ATTACHMENT_BYTES,
  REQUIREMENT_MAX,
  REQUIREMENT_MIN,
  SCALE_MAX,
  type ServiceEnquiryRefusal,
} from "./service-enquiry";

/**
 * A service-enquiry refusal, in the buyer's words — board `1d-s`.
 *
 * One function for the form's own check and the server's, so the message a
 * buyer sees does not depend on which of the two caught the problem. Each says
 * what correct looks like and never whose fault it was.
 *
 * No `server-only` and no `"use client"`: the composer imports it in the
 * browser and the action imports it on the server, and a label *function* is
 * never passed between them — each side calls it where it runs.
 */
export function refusalWords(refusal: ServiceEnquiryRefusal): string {
  switch (refusal.field) {
    case "service":
      return t("storefront_services.composer.error_service");
    case "requirement":
      return refusal.reason === "too_short"
        ? t("storefront_services.composer.error_requirement_short", { min: formatCount(REQUIREMENT_MIN) })
        : t("storefront_services.composer.error_requirement_long", { max: formatCount(REQUIREMENT_MAX) });
    case "scale":
      return t("storefront_services.composer.error_scale", { max: formatCount(SCALE_MAX) });
    case "neededBy":
      return refusal.reason === "past"
        ? t("storefront_services.composer.error_date_past")
        : t("storefront_services.composer.error_date_invalid");
    case "attachment":
      return refusal.reason === "type"
        ? t("storefront_services.composer.error_file_type")
        : t("storefront_services.composer.error_file_size", {
            mb: formatCount(Math.round(ENQUIRY_ATTACHMENT_BYTES / (1024 * 1024))),
          });
    case "contact":
      return t("rfq.contact_required");
  }
}
