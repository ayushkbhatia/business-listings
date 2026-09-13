"use server";

import { revalidatePath } from "next/cache";
import {
  saveDefaultCoverage,
  saveServiceCoverageSet,
  type ManagerWrite,
} from "@/lib/services/coverage-manager";
import { requireSellerSeat } from "../_shell";

/**
 * Board `3c-s`'s writes — two, and both stage a whole set.
 *
 * The capability check lives in the service layer (`mayEditListing`), so the
 * refusal is the same whichever screen calls it. What this file owns is which
 * pages go stale: the manager, the storefront overview that prints the union,
 * the public coverage page that prints the rows, and the service pages whose
 * own coverage panel reads the same rows.
 */

function list(formData: FormData, key: string): string[] {
  return formData.getAll(key).map(String).map((value) => value.trim()).filter(Boolean);
}

export async function saveDefault(formData: FormData): Promise<ManagerWrite> {
  const seat = await requireSellerSeat();
  const result = await saveDefaultCoverage(seat.actor, seat.businessId, {
    areaKeys: list(formData, "area"),
    modes: list(formData, "mode"),
    freeZoneIds: list(formData, "zone"),
  });
  if (result.ok) refresh(seat.businessSlug);
  return result;
}

export async function saveServiceSet(formData: FormData): Promise<ManagerWrite> {
  const seat = await requireSellerSeat();
  const result = await saveServiceCoverageSet(
    seat.actor,
    seat.businessId,
    String(formData.get("serviceId") ?? ""),
    list(formData, "area"),
  );
  if (result.ok) refresh(seat.businessSlug);
  return result;
}

function refresh(slug: string): void {
  revalidatePath("/dashboard/coverage");
  revalidatePath("/dashboard/services", "layout");
  revalidatePath(`/b/${slug}`);
  revalidatePath(`/b/${slug}/coverage`);
  revalidatePath(`/b/${slug}/s/[service]`, "page");
}
