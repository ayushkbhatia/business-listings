import { formatCount, formatDate } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { EMIRATES } from "@/lib/uae";
import { BRIEF_ATTACHMENT_BYTES, type BriefField, type BriefRefusal } from "./service-brief";

/**
 * A brief refusal, in the buyer's words — board `1h-s`.
 *
 * The same function for the composer's own check and the server's, so the
 * sentence does not depend on which of the two caught it — `1d-s`'s
 * `refusalWords`, for the brief's fields. Each says what correct looks like.
 */
export function briefRefusalWords(refusal: BriefRefusal): string {
  switch (refusal.field) {
    case "site":
      return t("brief.refusal.site_missing");
    case "building":
      return t("brief.refusal.building_too_long", { max: formatCount(refusal.max) });
    case "description":
      return refusal.reason === "too_short"
        ? t("brief.refusal.description_too_short", { min: formatCount(refusal.min) })
        : t("brief.refusal.description_too_long", { max: formatCount(refusal.max) });
    case "engagement":
      return t("brief.refusal.engagement_missing");
    case "cadence":
      return t("brief.refusal.cadence_not_ongoing");
    case "start":
      return refusal.reason === "past"
        ? t("brief.refusal.start_past")
        : refusal.reason === "invalid"
          ? t("brief.refusal.start_invalid")
          : t("brief.refusal.start_missing");
    case "scale":
      return t("brief.refusal.scale_too_long", { max: formatCount(refusal.max) });
    case "attachments":
      return refusal.reason === "type"
        ? t("brief.refusal.attachments_type")
        : refusal.reason === "size"
          ? t("brief.refusal.attachments_size", {
              mb: formatCount(Math.round(BRIEF_ATTACHMENT_BYTES / (1024 * 1024))),
            })
          : t("brief.refusal.attachments_too_many", { max: formatCount(refusal.max ?? 0) });
    case "contact":
      return t("rfq.contact_required");
  }
}

/** Every refusal as the per-field map a form marks, first sentence per field. */
export function briefFieldErrors(refusals: readonly BriefRefusal[]): Partial<Record<BriefField, string>> {
  const out: Partial<Record<BriefField, string>> = {};
  for (const refusal of refusals) out[refusal.field] ??= briefRefusalWords(refusal);
  return out;
}

/** A brief's facts, worded once for the buyer's page and the seller's lead alike. */
export function briefFactWords(brief: {
  emirate: string | null;
  areaName: string | null;
  building: string | null;
  engagementType: string;
  cadence: string | null;
  startMode: string;
  startsOn: Date | null;
}): { site: string; engagement: string; start: string } {
  const emirate = brief.emirate ? (EMIRATES.find((e) => e.value === brief.emirate)?.label ?? brief.emirate) : "";
  const place = brief.areaName ? t("brief.site_area", { area: brief.areaName, emirate }) : emirate;
  const engagement = t(`engagement.${brief.engagementType}` as MessageKey);
  return {
    site: brief.building ? t("brief.site_building", { site: place, building: brief.building }) : place,
    engagement: brief.cadence
      ? t("brief.engagement_cadence", { engagement, cadence: t(`brief.cadence.${brief.cadence}` as MessageKey) })
      : engagement,
    start:
      brief.startMode === "from_date" && brief.startsOn
        ? formatDate(brief.startsOn)
        : t("track.brief.start_asap"),
  };
}
