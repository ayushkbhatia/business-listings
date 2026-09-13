"use server";

import { revalidatePath } from "next/cache";
import { mayEditListing } from "@/lib/auth/guards";
import { requireSellerSeat } from "../../_shell";
import {
  isEditableField,
  patchServiceField,
  setServiceStatus,
  type ServiceWrite,
} from "@/lib/services/service";
import {
  resetServiceCoverage,
  setServiceCoverageArea,
  type ServiceCoverageWrite,
} from "@/lib/services/coverage";

/**
 * Board `3g-s`'s writes — one field at a time.
 *
 * The `2c-s` autosave contract, and the half of it that matters here is
 * "patch only the changed field": two open tabs cannot have one post its stale
 * copy of the other's work over the top.
 *
 * Nothing revalidates on a keystroke. `revalidatePath` on a field save would
 * re-render the server component and replace what the seller is still typing
 * with what is on the record; the page holds its own draft and the timestamp in
 * the header is the receipt. Publishing does revalidate, because that changes
 * what a buyer can reach.
 */

const GONE: ServiceWrite = { ok: false, reason: "not_found" };

export async function saveServiceField(formData: FormData): Promise<ServiceWrite> {
  const seat = await requireSellerSeat();
  const field = String(formData.get("field") ?? "");
  if (!isEditableField(field)) return GONE;

  return patchServiceField(
    seat.actor,
    seat.businessId,
    String(formData.get("id") ?? ""),
    field,
    String(formData.get("value") ?? ""),
  );
}

export type StatusResult = { ok: boolean };

export async function setStatus(formData: FormData): Promise<StatusResult> {
  const seat = await requireSellerSeat();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") === "live" ? "live" : "draft";

  const result = await setServiceStatus(seat.actor, seat.businessId, [id], status);
  if (result.ok) {
    revalidatePath(`/dashboard/services/${id}`);
    revalidatePath("/dashboard/services");
    revalidatePath(`/b/${seat.businessSlug}/services`);
  }
  return { ok: result.ok };
}

/* ── Board `3c-s` — this service's own coverage ──────────────────────────── */

/**
 * One chip, on or off.
 *
 * `revalidatePath` on the public service page and nowhere else, and only when
 * the write lands: coverage is the one thing on this screen a buyer reads
 * without the seller publishing anything, so a narrowed service that still
 * showed the firm's coverage to buyers would be the card lying by a cache.
 * The dashboard is not revalidated for `2c-s`'s reason — the seller is still
 * typing in the form beside this card, and re-rendering the server component
 * would replace their draft with the record.
 */
export async function saveServiceArea(formData: FormData): Promise<ServiceCoverageWrite> {
  const seat = await requireSellerSeat();
  // `listing.edit`, the capability every other coverage write on the platform
  // checks. This shipped guarding only on having a seat, so a sales or finance
  // seat could change where a service is offered — board 3c-s found it.
  if (!mayEditListing(seat.actor)) return { ok: false, reason: "forbidden" };
  const id = String(formData.get("id") ?? "");

  const result = await setServiceCoverageArea(
    seat.businessId,
    id,
    {
      emirate: String(formData.get("emirate") ?? ""),
      areaId: String(formData.get("areaId") ?? "") || null,
    },
    String(formData.get("on") ?? "") === "1",
  );
  if (result.ok) revalidateService(seat.businessSlug, id);
  return result;
}

/** Back to the business default — every own row gone. */
export async function useDefaultCoverage(formData: FormData): Promise<ServiceCoverageWrite> {
  const seat = await requireSellerSeat();
  if (!mayEditListing(seat.actor)) return { ok: false, reason: "forbidden" };
  const id = String(formData.get("id") ?? "");

  const result = await resetServiceCoverage(seat.businessId, id);
  if (result.ok) revalidateService(seat.businessSlug, id);
  return result;
}

function revalidateService(businessSlug: string, id: string): void {
  revalidatePath(`/b/${businessSlug}/services`);
  revalidatePath(`/dashboard/services/${id}`);
}
