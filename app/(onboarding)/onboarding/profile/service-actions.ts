"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/session";
import { mayEditListing } from "@/lib/auth/guards";
import { saveServiceProfile } from "@/lib/onboarding/profile";
import { searchSectors } from "@/lib/onboarding/sector-index";
import type { SectorOption } from "@/components/domain/ServiceProfileFields";
import { t } from "@/lib/i18n";
import { sayServiceRefusal } from "@/lib/onboarding/service-profile-words";

/**
 * Board `2c-s` — the services half of the profile step.
 *
 * Separate from `./actions.ts` because that file's `patchField` is per-field and
 * string-shaped, and these are arrays saved as a set. Same screen, same step,
 * two write paths — which B1 allows: the rule is one screen and one component,
 * not one function.
 */

export type SaveServiceResult = { ok: true; savedAt: string } | { ok: false; error: string };

export async function saveServiceFields(formData: FormData): Promise<SaveServiceResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, error: t("dev.no_seat_title") };
  // `listing.edit`, as every other write to the public profile checks. This
  // guarded only on having a seat.
  if (!mayEditListing(actor)) return { ok: false, error: t("profile_step.extras_error.forbidden") };

  const list = (key: string): string[] =>
    String(formData.get(key) ?? "")
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean);

  const servicesOffered = list("servicesOffered");
  const sectorsServed = list("sectorsServed");

  const headline = String(formData.get("headline") ?? "");
  const languages = formData.getAll("language").map(String);
  const qualifiedRaw = String(formData.get("qualifiedCount") ?? "").trim();

  const result = await saveServiceProfile(actor.businessId, {
    headline,
    servicesOffered,
    sectorsServed,
    ...engagementsFrom(formData.get("sectorEngagements")),
    // Only when the form says it sent them — an older client that never did
    // must not be read as *no languages*.
    ...(formData.get("languagesSent") === "1" ? { languages } : {}),
    ...(formData.has("qualifiedCount")
      ? { qualifiedCount: qualifiedRaw === "" ? null : Number(qualifiedRaw) }
      : {}),
    ...(formData.has("typicalClient")
      ? { typicalClient: String(formData.get("typicalClient") ?? "") }
      : {}),
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
      error: sayServiceRefusal(first, {
        headline: headline.trim().length,
        services: servicesOffered.length,
        sectors: sectorsServed.length,
        languages: languages.length,
      }),
    };
  }

  revalidatePath("/onboarding/profile");
  return { ok: true, savedAt: result.savedAt.toISOString() };
}

/**
 * Board `1d-s` B8 — the declared counts, posted as one JSON object keyed by the
 * sector's matching form. Absent means an older form that never sent them, and
 * the stored counts are left alone; anything that does not parse is treated the
 * same way rather than as *clear every count*.
 */
function engagementsFrom(raw: FormDataEntryValue | null): {
  sectorEngagements?: Record<string, number | null>;
} {
  if (typeof raw !== "string" || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number | null> = {};
    for (const [key, value] of Object.entries(parsed)) {
      out[key] = typeof value === "number" ? value : null;
    }
    return { sectorEngagements: out };
  } catch {
    return {};
  }
}

/** The sector search, for the field's type-ahead. */
export async function findSectors(query: string): Promise<SectorOption[]> {
  const actor = await getActor();
  if (!actor?.businessId) return [];
  return searchSectors(query);
}
