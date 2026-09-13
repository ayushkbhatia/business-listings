"use server";

import { revalidatePath } from "next/cache";
import { saveHours, withdrawChange } from "@/lib/listing/service";
import { saveListing } from "@/lib/listing/save";
import { pick, setCover, unpick } from "@/lib/listing/photos";
import type { RamadanHours, WeekHours } from "@/lib/trade/hours";
import { t } from "@/lib/i18n";
import { searchSectors } from "@/lib/onboarding/sector-index";
import type { SectorOption } from "@/components/domain/ServiceProfileFields";
import { getSellerSeat } from "../_shell";

/**
 * Board 3b criterion 3 — **one action, not two.**
 *
 * The screen this replaces posted twice: `saveListingProfile` for the fields a
 * seller owns and `submitModeratedChange` for one that waits, with the seller
 * left to work out which button they needed. There is now one `Save changes`,
 * and the split it applies still lives in `MODERATED` in lib/listing/service.ts
 * — nothing here decides which side a field is on.
 *
 * What this file adds is the *reporting*: the result names the live half and
 * the held half separately, so the screen can mark a held chip where it is
 * edited instead of putting a count in the header and a paragraph in the rail.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface SaveSummary {
  ok: true;
  /** Field keys that are live now. */
  live: string[];
  /** Category ids queued, so the form can mark those chips in place. */
  held: string[];
  /** Asks that were refused, already worded for the seller. */
  refused: string[];
}

export type SaveActionResult = SaveSummary | { ok: false; error: string };

/**
 * Everything on the form, in one post.
 *
 * The form sends every field on every save and `saveListing` writes only what
 * moved — the alternative is a revision row reading "Description" every time
 * somebody corrects their opening year.
 */
export async function saveListingProfile(formData: FormData): Promise<SaveActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const year = String(formData.get("establishedYear") ?? "").trim();
  const languages = formData
    .getAll("language")
    .map(String)
    .map((value) => value.trim())
    .filter(Boolean);

  const qualifiedRaw = String(formData.get("qualifiedCount") ?? "").trim();

  const result = await saveListing(seat.actor, seat.businessId, {
    description: String(formData.get("description") ?? ""),
    /*
       Only when the form drew the field. A services listing's form has no
       payment-terms input, and reading the absence as an empty string would
       clear a value the seller set before they changed kind — the `2b-s` B5
       rule that switching kind converts and deletes nothing.
    */
    ...(formData.has("paymentTerms")
      ? { paymentTerms: String(formData.get("paymentTerms") ?? "") }
      : {}),
    establishedYear: year === "" ? null : Number(year),
    teamSize: String(formData.get("teamSize") ?? "") || null,
    languages,
    primaryCategoryId: String(formData.get("primaryCategoryId") ?? "") || undefined,
    addCategoryIds: formData.getAll("addCategory").map(String).filter(Boolean),
    removeCategoryIds: formData.getAll("removeCategory").map(String).filter(Boolean),
    /*
       Board `3b-s` — the services field set, posted only when the screen drew
       it. The same input shape onboarding's `saveServiceFields` builds, because
       the two screens save one field set (B8).
    */
    ...(formData.get("servicesSent") === "1"
      ? {
          services: {
            headline: String(formData.get("headline") ?? ""),
            sectorsServed: formData.getAll("sector").map(String),
            ...engagementsFrom(formData.get("sectorEngagements")),
            qualifiedCount: qualifiedRaw === "" ? null : Number(qualifiedRaw),
            typicalClient: String(formData.get("typicalClient") ?? ""),
          },
        }
      : {}),
  });

  if (!result.ok) return result;

  revalidatePath("/dashboard/listing");
  revalidatePath("/dashboard");
  /*
     The storefront too. `3b-s` B3: the description is published verbatim on
     the overview, and a save that left the cached page showing the old text
     would be a seller told their words are live when they are not.
  */
  revalidatePath(`/b/${seat.businessSlug}`, "layout");
  return {
    ok: true,
    live: result.live,
    held: result.held.map((row) => row.value),
    refused: result.refused.map((row) => row.error),
  };
}

/**
 * Declared engagement counts, posted as one JSON object keyed by sector — the
 * same encoding onboarding posts. Anything that does not parse leaves the
 * stored counts alone rather than clearing every one.
 */
function engagementsFrom(raw: FormDataEntryValue | null): {
  sectorEngagements?: Record<string, number | null>;
} {
  if (typeof raw !== "string" || raw === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return {
      sectorEngagements: Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, typeof value === "number" ? value : null]),
      ),
    };
  } catch {
    return {};
  }
}

/** The sector type-ahead — the same index onboarding searches. */
export async function findListingSectors(query: string): Promise<SectorOption[]> {
  const seat = await getSellerSeat();
  if (!seat) return [];
  return searchSectors(query);
}

/* ── Photographs: references into 3i, never uploads ──────────────────────── */

export async function unpickPhoto(formData: FormData): Promise<ActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  const result = await unpick(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  if (result.ok) refreshPhotoSurfaces(seat.businessId);
  return result;
}

export async function pickPhoto(formData: FormData): Promise<ActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  const result = await pick(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  if (result.ok) refreshPhotoSurfaces(seat.businessId);
  return result;
}

export async function makeCover(formData: FormData): Promise<ActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  const result = await setCover(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  if (result.ok) refreshPhotoSurfaces(seat.businessId);
  return result;
}

/**
 * Three surfaces read these files, so three get revalidated.
 *
 * The media library lists them, this editor picks them and the public
 * storefront renders them. A pick that refreshed only the screen the seller was
 * looking at would leave the library showing a file as unplaced after they had
 * just placed it.
 */
function refreshPhotoSurfaces(businessId: string): void {
  revalidatePath("/dashboard/listing");
  revalidatePath("/dashboard/media");
  revalidatePath(`/b/${businessId}`);
}

/*
   `submitModeratedChange` is gone.

   It was the second button — a seller picked a category, then pressed a
   different control to ask for it. `saveListing` now queues held fields inside
   the same save, which is criterion 3, and a separate entry point would be a
   second way in with none of the reporting the screen needs.

   `withdrawModeratedChange` stays: taking back an ask is a real act with no
   counterpart in the save, and it is the only route out of a held state that
   does not need a moderator.
*/

export async function withdrawModeratedChange(formData: FormData): Promise<ActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await withdrawChange(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  if (result.ok) revalidatePath("/dashboard/listing");
  return result;
}

export type HoursActionResult = { ok: true; applied: number } | { ok: false; error: string };

export async function saveBranchHours(formData: FormData): Promise<HoursActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  let hours: WeekHours;
  let ramadan: RamadanHours | null;
  try {
    hours = JSON.parse(String(formData.get("hours") ?? "{}")) as WeekHours;
    const raw = String(formData.get("ramadanHours") ?? "");
    ramadan = raw === "" ? null : (JSON.parse(raw) as RamadanHours);
  } catch {
    return { ok: false, error: t("hours.no_branches") };
  }

  const result = await saveHours(seat.actor, seat.businessId, {
    locationId: String(formData.get("locationId") ?? ""),
    hours,
    ramadanHours: ramadan,
  });

  if (result.ok) {
    revalidatePath("/dashboard/hours");
    revalidatePath("/dashboard/locations");
  }
  return result;
}
