"use server";

import { revalidatePath } from "next/cache";
import { t, type MessageKey } from "@/lib/i18n";
import {
  addClosure,
  clearClosure,
  confirmRamadanHours,
  copyHours,
  removeClosure,
  saveBranchWeek,
  scheduleClosure,
} from "@/lib/hours/service";
import { nextRamadan, type RamadanHours, type WeekHours } from "@/lib/trade/hours";
import { readRamadanCalendar } from "@/lib/trade/ramadan-calendar";
import { getSellerSeat } from "../_shell";

/**
 * Board 3d's writes.
 *
 * Every refusal carries the sentence that gets the seller out of it — `Alert`
 * refuses a `bad` notice without one, design-system §05.1, and it says so at
 * runtime rather than in review.
 */

export interface ActionError {
  ok: false;
  error: string;
  fix: string;
}

export type HoursResult = { ok: true; applied: number } | ActionError;

const MESSAGE: Record<string, { error: MessageKey; fix: MessageKey }> = {
  not_found: { error: "hours.not_found", fix: "hours.not_found_fix" },
  no_reason: { error: "hours.no_reason", fix: "hours.no_reason_fix" },
  backwards: { error: "hours.backwards", fix: "hours.backwards_fix" },
  half_day_needs_hours: {
    error: "hours.half_day_needs_hours",
    fix: "hours.half_day_needs_hours_fix",
  },
};

/**
 * A refusal the service named, or one it wrote out.
 *
 * `saveBranchWeek` returns `describeProblemText` for a bad shift — a sentence
 * already, and the same one the editor shows while the seller is typing, which
 * is the whole reason that function is shared. Anything else is a key.
 */
function refuse(code: string): ActionError {
  const known = MESSAGE[code];
  return known
    ? { ok: false, error: t(known.error), fix: t(known.fix) }
    : { ok: false, error: code, fix: t("hours.problem.bad_time", { value: "08:00" }) };
}

function noSeat(): ActionError {
  return { ok: false, error: t("dev.no_seat_title"), fix: t("dev.no_seat_body") };
}

function parseWeek(raw: FormDataEntryValue | null): WeekHours | null {
  try {
    return JSON.parse(String(raw ?? "{}")) as WeekHours;
  } catch {
    return null;
  }
}

export async function saveWeek(formData: FormData): Promise<HoursResult> {
  const seat = await getSellerSeat();
  if (!seat) return noSeat();

  const hours = parseWeek(formData.get("hours"));
  if (!hours) return refuse("not_found");

  const rawRamadan = String(formData.get("ramadanHours") ?? "");
  let ramadan: RamadanHours | null = null;
  if (rawRamadan !== "") {
    try {
      ramadan = JSON.parse(rawRamadan) as RamadanHours;
    } catch {
      return refuse("not_found");
    }
  }

  const result = await saveBranchWeek(seat.actor, seat.businessId, {
    locationId: String(formData.get("locationId") ?? ""),
    hours,
    ramadanHours: ramadan,
  });
  if (!result.ok) return refuse(result.error);

  revalidatePath("/dashboard/hours");
  // Board 1f prints these, and board 3a's card reads the confirmation.
  revalidatePath("/dashboard");
  return result;
}

export async function copyToBranches(formData: FormData): Promise<HoursResult> {
  const seat = await getSellerSeat();
  if (!seat) return noSeat();

  const result = await copyHours(seat.actor, seat.businessId, {
    fromLocationId: String(formData.get("fromLocationId") ?? ""),
    toLocationIds: String(formData.get("toLocationIds") ?? "").split(",").filter(Boolean),
  });
  if (!result.ok) return refuse(result.error);

  revalidatePath("/dashboard/hours");
  return result;
}

export async function confirmRamadan(formData: FormData): Promise<HoursResult> {
  const seat = await getSellerSeat();
  if (!seat) return noSeat();

  /*
     The year comes from the platform's calendar, never from the form.

     It is the platform that decides which Ramadan the seller is confirming
     hours for, and a year posted by a browser is a year a browser could be
     wrong about — which would clear board 3a's card for a window nobody has
     looked at.
  */
  const window = nextRamadan(new Date(), await readRamadanCalendar());
  if (!window) return refuse("not_found");

  const result = await confirmRamadanHours(seat.actor, seat.businessId, {
    locationId: String(formData.get("locationId") ?? ""),
    year: window.year,
  });
  if (!result.ok) return refuse(result.error);

  revalidatePath("/dashboard/hours");
  revalidatePath("/dashboard");
  return result;
}

export type ClosureActionResult = { ok: true } | ActionError;

function asDate(raw: FormDataEntryValue | null): Date | null {
  const value = String(raw ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  // A bare date, held as the UTC midnight the DATE column stores — see
  // `dateKey` in lib/trade/closures.ts for why this must not go through a
  // local-time constructor.
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function addDate(formData: FormData): Promise<ClosureActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return noSeat();

  const startsOn = asDate(formData.get("startsOn"));
  const endsOn = asDate(formData.get("endsOn")) ?? startsOn;
  if (!startsOn || !endsOn) return refuse("backwards");

  const openFrom = String(formData.get("openFrom") ?? "").trim() || null;
  const openUntil = String(formData.get("openUntil") ?? "").trim() || null;

  const result = await addClosure(seat.actor, seat.businessId, {
    locationId: String(formData.get("locationId") ?? ""),
    startsOn,
    endsOn,
    reason: String(formData.get("reason") ?? ""),
    openFrom,
    openUntil,
  });
  if (!result.ok) return refuse(result.error);

  revalidatePath("/dashboard/hours");
  return { ok: true };
}

export async function dropDate(formData: FormData): Promise<ClosureActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return noSeat();
  const result = await removeClosure(seat.actor, seat.businessId, String(formData.get("id") ?? ""));
  if (!result.ok) return refuse(result.error);
  revalidatePath("/dashboard/hours");
  return { ok: true };
}

export async function saveClosure(formData: FormData): Promise<ClosureActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return noSeat();

  const from = asDate(formData.get("from"));
  const until = asDate(formData.get("until"));
  if (!from || !until) return refuse("backwards");

  const result = await scheduleClosure(seat.actor, seat.businessId, {
    locationId: String(formData.get("locationId") ?? ""),
    from,
    until,
    reason: String(formData.get("reason") ?? ""),
  });
  if (!result.ok) return refuse(result.error);

  revalidatePath("/dashboard/hours");
  revalidatePath("/dashboard/locations");
  return { ok: true };
}

export async function endClosure(formData: FormData): Promise<ClosureActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return noSeat();
  const result = await clearClosure(
    seat.actor,
    seat.businessId,
    String(formData.get("locationId") ?? ""),
  );
  if (!result.ok) return refuse(result.error);
  revalidatePath("/dashboard/hours");
  revalidatePath("/dashboard/locations");
  return { ok: true };
}
