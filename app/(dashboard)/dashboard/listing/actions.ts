"use server";

import { revalidatePath } from "next/cache";
import {
  isModerated,
  requestModeratedChange,
  saveHours,
  saveProfile,
  withdrawChange,
  type ModeratedField,
} from "@/lib/listing/service";
import type { RamadanHours, WeekHours } from "@/lib/trade/hours";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * Listing mutations, both halves of criterion 8 in one file.
 *
 * The split lives in lib/listing/service.ts as data. Nothing here decides which
 * side a field is on; `submitModeratedChange` refuses a field that is not on
 * the moderated list rather than quietly writing it, so a form posting
 * `field=description` cannot route a description through the queue and a bug
 * cannot route a trade name around it.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveListingProfile(formData: FormData): Promise<ActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const year = String(formData.get("establishedYear") ?? "").trim();
  const languages = formData
    .getAll("language")
    .map(String)
    .map((l) => l.trim())
    .filter(Boolean);

  const result = await saveProfile(seat.actor, seat.businessId, {
    displayName: String(formData.get("displayName") ?? ""),
    description: String(formData.get("description") ?? ""),
    establishedYear: year === "" ? null : Number(year),
    teamSize: String(formData.get("teamSize") ?? "") || null,
    languages,
  });

  if (result.ok) {
    revalidatePath("/dashboard/listing");
    revalidatePath("/dashboard");
  }
  return result;
}

export async function submitModeratedChange(formData: FormData): Promise<ActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const field = String(formData.get("field") ?? "");
  // Not a general-purpose write. A field that is not one of the three has no
  // path through here, whatever the form says.
  if (!isModerated(field)) {
    return { ok: false, error: "That field is not reviewed, and publishes when you save it." };
  }

  const result = await requestModeratedChange(
    seat.actor,
    seat.businessId,
    field as ModeratedField,
    String(formData.get("value") ?? ""),
  );
  if (!result.ok) return result;

  revalidatePath("/dashboard/listing");
  return { ok: true };
}

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
