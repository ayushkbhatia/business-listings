"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/session";
import { saveServiceProfile } from "@/lib/onboarding/profile";
import { searchSectors } from "@/lib/onboarding/sector-index";
import type { SectorOption } from "@/components/domain/ServiceProfileFields";
import { t } from "@/lib/i18n";
import { formatCount } from "@/lib/format";
import type { ProfileRefusal } from "@/lib/onboarding/service-profile";

/**
 * Board `2c-s` — the services half of the profile step.
 *
 * Separate from `./actions.ts` because that file's `patchField` is per-field and
 * string-shaped, and these are arrays saved as a set. Same screen, same step,
 * two write paths — which B1 allows: the rule is one screen and one component,
 * not one function.
 */

export type SaveServiceResult = { ok: true; savedAt: string } | { ok: false; error: string };

/** A refusal in the seller's own terms, naming the cap rather than the field. */
function say(refusal: ProfileRefusal, counts: { services: number; sectors: number }): string {
  if (refusal.field === "headline") {
    return t("profile_svc.headline_over", {
      count: formatCount(counts.services),
      max: formatCount(refusal.max),
    });
  }
  if (refusal.field === "servicesOffered") {
    return t("profile_svc.services_capped", {
      count: formatCount(counts.services),
      max: formatCount(refusal.max),
      over: formatCount(Math.max(0, counts.services - refusal.max)),
    });
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

export async function saveServiceFields(formData: FormData): Promise<SaveServiceResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, error: t("dev.no_seat_title") };

  const list = (key: string): string[] =>
    String(formData.get(key) ?? "")
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);

  const servicesOffered = list("servicesOffered");
  const sectorsServed = list("sectorsServed");

  const result = await saveServiceProfile(actor.businessId, {
    headline: String(formData.get("headline") ?? ""),
    servicesOffered,
    sectorsServed,
  });

  if (!result.ok) {
    /*
       The first refusal, in the seller's terms. First rather than all of them
       because this is one inline message under one form — the service layer
       returns every refusal so a caller with room can show every one, and this
       caller has room for one.
    */
    const first = result.refusals[0]!;
    return {
      ok: false,
      error: say(first, { services: servicesOffered.length, sectors: sectorsServed.length }),
    };
  }

  revalidatePath("/onboarding/profile");
  return { ok: true, savedAt: result.savedAt.toISOString() };
}

/** The sector search, for the field's type-ahead. */
export async function findSectors(query: string): Promise<SectorOption[]> {
  const actor = await getActor();
  if (!actor?.businessId) return [];
  return searchSectors(query);
}
