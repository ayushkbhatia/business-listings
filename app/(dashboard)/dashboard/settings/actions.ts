"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { assertCan } from "@/lib/auth/can";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";
import { CHANNELS, ESCALATION_CHOICES, EVENTS, NUDGE_CHOICES } from "./matrix";

/**
 * Saving the alert matrix.
 *
 * Everything is re-validated here. The matrix arrives as a form, and a form is
 * a suggestion: an event or channel this product does not have would be stored
 * as JSON and read back as JSON, and then some future send would route to it.
 */
export type SaveAlertsResult = { ok: true } | { ok: false; error: string };

export async function saveAlerts(formData: FormData): Promise<SaveAlertsResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCan(seat.actor, "listing.edit");

  const routing: Record<string, string[]> = {};
  for (const event of EVENTS) {
    const on = CHANNELS.filter((channel) => formData.get(`matrix.${event}.${channel}`) === "on");
    if (on.length > 0) routing[event] = on;
  }

  const hour = (name: string, fallback: number): number => {
    const value = Number(formData.get(name));
    return Number.isInteger(value) && value >= 0 && value <= 23 ? value : fallback;
  };

  /*
   * An empty override means never, which is different from zero. Zero would
   * mean every enquiry overrides quiet hours, which is quiet hours switched
   * off by a route the UI does not offer.
   */
  const rawOverride = String(formData.get("highValueOverrideAed") ?? "").trim();
  const parsedOverride = Number(rawOverride.replace(/[,\s]/g, ""));
  const highValueOverrideAed =
    rawOverride === "" || !Number.isFinite(parsedOverride) || parsedOverride <= 0
      ? null
      : Math.round(parsedOverride);

  const escalateAfterMinutes = pick(formData.get("escalateAfterMinutes"), ESCALATION_CHOICES, 120);
  const nudgeAfterHours = pick(formData.get("nudgeAfterHours"), NUDGE_CHOICES, 24);

  await prisma.notificationPreference.upsert({
    where: { businessId: seat.businessId },
    create: {
      businessId: seat.businessId,
      routing,
      quietHoursEnabled: formData.get("quietHoursEnabled") === "on",
      quietFromHour: hour("quietFromHour", 21),
      quietToHour: hour("quietToHour", 7),
      quietOnSunday: formData.get("quietOnSunday") === "on",
      highValueOverrideAed,
      escalateAfterMinutes,
      nudgeEnabled: formData.get("nudgeEnabled") === "on",
      nudgeAfterHours,
    },
    update: {
      routing,
      quietHoursEnabled: formData.get("quietHoursEnabled") === "on",
      quietFromHour: hour("quietFromHour", 21),
      quietToHour: hour("quietToHour", 7),
      quietOnSunday: formData.get("quietOnSunday") === "on",
      highValueOverrideAed,
      escalateAfterMinutes,
      nudgeEnabled: formData.get("nudgeEnabled") === "on",
      nudgeAfterHours,
    },
  });

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

function pick<T extends number>(value: FormDataEntryValue | null, allowed: readonly T[], fallback: T): T {
  const parsed = Number(value);
  return allowed.includes(parsed as T) ? (parsed as T) : fallback;
}
