import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ProfileRefusal } from "./service-profile";

/**
 * A services-profile refusal, worded — shared by the onboarding step and the
 * dashboard listing screen, which save the same field set (`3b-s` B8).
 *
 * Its own module because `service-actions.ts` is a `"use server"` file, and a
 * server-action module may only export async functions.
 */

/** A refusal in the seller's own terms, naming the cap rather than the field. */
export function sayServiceRefusal(
  refusal: ProfileRefusal,
  counts: { headline: number; services: number; sectors: number; languages: number },
): string {
  if (refusal.field === "headline") {
    // The headline's own length. This passed the services count, so an
    // over-long one-liner was reported as however many services were listed.
    return t("profile_svc.headline_over", {
      count: formatCount(counts.headline),
      max: formatCount(refusal.max),
    });
  }
  if (refusal.field === "languages") {
    return refusal.reason === "entry_too_long"
      ? t("profile_svc.languages_too_long", { max: formatCount(refusal.max) })
      : t("profile_svc.languages_full", { max: formatCount(refusal.max) });
  }
  if (refusal.field === "qualifiedCount") {
    return refusal.reason === "exceeds_team"
      ? t("profile_svc.qualified_exceeds_team", { max: formatCount(refusal.max) })
      : t("profile_svc.qualified_range", { max: formatCount(refusal.max) });
  }
  if (refusal.field === "typicalClient") {
    return t("profile_svc.typical_client_over", { max: formatCount(refusal.max) });
  }
  if (refusal.field === "servicesOffered") {
    return t("profile_svc.services_capped", {
      count: formatCount(counts.services),
      max: formatCount(refusal.max),
      over: formatCount(Math.max(0, counts.services - refusal.max)),
    });
  }
  if (refusal.field === "sectorEngagements") {
    return t("profile_svc.engagements_range", { max: formatCount(refusal.max) });
  }
  if (refusal.reason === "entry_too_long") {
    return t("profile_svc.sectors_too_long", { max: formatCount(refusal.max) });
  }
  return t("profile_svc.sectors_capped", {
    count: formatCount(counts.sectors),
    max: formatCount(refusal.max),
    over: formatCount(Math.max(0, counts.sectors - refusal.max)),
  });
}

