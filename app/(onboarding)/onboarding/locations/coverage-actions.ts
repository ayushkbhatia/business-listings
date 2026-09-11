"use server";

import { getActor } from "@/lib/auth/session";
import {
  selectAllCoverage,
  setCoverageArea,
  setDeliveryModes,
  setFreeZone,
  type CoverageWrite,
} from "@/lib/onboarding/coverage";

/**
 * Board `2d-s`'s mutations.
 *
 * None takes a `businessId` from the form. The seat carries it, so a
 * half-finished funnel cannot be pointed at somebody else's listing by editing
 * a hidden field — the same rule every other action in this funnel follows.
 *
 * Nothing revalidates. Every control here is discrete — a checkbox, a chip, a
 * zone — so the page's own state is already what the seller clicked, and a
 * `revalidatePath` on each one would re-render the server component underneath
 * somebody mid-click. The structural changes that made `2d` refresh, a branch
 * added or removed, have no equivalent here: the eight chips are the same eight
 * before and after.
 */

const GONE: CoverageWrite = { ok: false, reason: "not_found" };

/** The whole mode set, replaced. Empty is allowed and is a real state. */
export async function saveDeliveryModes(formData: FormData): Promise<CoverageWrite> {
  const actor = await getActor();
  if (!actor?.businessId) return GONE;

  const raw = String(formData.get("modes") ?? "");
  return setDeliveryModes(
    actor.businessId,
    raw === "" ? [] : raw.split(","),
  );
}

/** One chip on or off. */
export async function saveCoverageArea(formData: FormData): Promise<CoverageWrite> {
  const actor = await getActor();
  if (!actor?.businessId) return GONE;

  const areaId = String(formData.get("areaId") ?? "");
  return setCoverageArea(
    actor.businessId,
    { emirate: String(formData.get("emirate") ?? ""), areaId: areaId === "" ? null : areaId },
    String(formData.get("on") ?? "") === "1",
  );
}

/** Every chip on. No confirmation — board `2d-s` Q1. */
export async function saveAllCoverageAreas(): Promise<CoverageWrite> {
  const actor = await getActor();
  if (!actor?.businessId) return GONE;
  return selectAllCoverage(actor.businessId);
}

/** A free-zone registration, on or off. */
export async function saveFreeZone(formData: FormData): Promise<CoverageWrite> {
  const actor = await getActor();
  if (!actor?.businessId) return GONE;

  return setFreeZone(
    actor.businessId,
    String(formData.get("areaId") ?? ""),
    String(formData.get("on") ?? "") === "1",
  );
}
