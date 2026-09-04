"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/session";
import { describeProblemText } from "@/lib/trade/hours-copy";
import type { RamadanHours, WeekHours } from "@/lib/trade/hours";
import { goLive } from "@/lib/onboarding/service";
import {
  addBranch,
  branchesWithHours,
  continueCheck,
  isBranchField,
  patchBranchField,
  pinBranch,
  removeBranch,
  saveBranchHours,
  setBranchRadius,
  type AddBranchResult,
  type BranchPatch,
  type PinResult,
  type RadiusResult,
  type RemoveBranchResult,
  type SaveHoursResult,
} from "@/lib/onboarding/locations";
import { parseRadius } from "@/lib/onboarding/branch-fields";
import type { BranchGap } from "@/lib/onboarding/branch-fields";

/**
 * Board 2d's mutations.
 *
 * None of them takes a `businessId` from the form. The seat carries it, so a
 * half-finished funnel cannot be pointed at somebody else's branch by editing a
 * hidden field — the same rule the rest of the funnel's actions follow, and the
 * reason every service call below passes `actor.businessId` rather than
 * anything that arrived over the wire.
 *
 * Nothing here revalidates on a keystroke. `revalidatePath` on a field save
 * would re-render the server component and replace what the seller is still
 * typing with what is on the record; the page holds its own draft and the
 * timestamp in the header is the receipt. Only the structural changes — a branch
 * added or removed — refresh, because those change what the page is made of.
 */

const GONE = { ok: false as const, field: "addressLine" as const, problem: { kind: "not_found" as const } };

/** Autosave, one field of one branch. */
export async function saveBranchField(formData: FormData): Promise<BranchPatch> {
  const actor = await getActor();
  const field = String(formData.get("field") ?? "");
  if (!actor?.businessId || !isBranchField(field)) return GONE;

  return patchBranchField(
    actor.businessId,
    String(formData.get("branchId") ?? ""),
    field,
    String(formData.get("value") ?? ""),
  );
}

/** Criterion 11: the pin's resting place. */
export async function savePin(formData: FormData): Promise<PinResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, reason: "not_found" };

  return pinBranch(
    actor.businessId,
    String(formData.get("branchId") ?? ""),
    Number(formData.get("lat")),
    Number(formData.get("lng")),
  );
}

export async function saveRadius(formData: FormData): Promise<RadiusResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, reason: "not_found" };

  return setBranchRadius(
    actor.businessId,
    String(formData.get("branchId") ?? ""),
    parseRadius(String(formData.get("km") ?? "")),
  );
}

export async function createBranch(formData: FormData): Promise<AddBranchResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, reason: "not_found" };

  const result = await addBranch(actor.businessId, {
    areaId: String(formData.get("areaId") ?? ""),
    type: String(formData.get("type") ?? ""),
  });
  if (result.ok) revalidatePath("/onboarding/locations");
  return result;
}

export async function deleteBranch(formData: FormData): Promise<RemoveBranchResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, reason: "not_found" };

  const result = await removeBranch(actor.businessId, String(formData.get("branchId") ?? ""));
  if (result.ok) revalidatePath("/onboarding/locations");
  return result;
}

/**
 * Hours, for this branch or for every branch.
 *
 * `scope=all` is the confirmed half of criterion 17. The screen asks first and
 * names how many branches already have hours; this is what it sends once the
 * seller has said yes, and a caller cannot reach every branch without sending
 * it deliberately.
 */
export async function saveHours(formData: FormData): Promise<SaveHoursResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, problem: "not_found" };

  const branchId = String(formData.get("branchId") ?? "");
  let hours: WeekHours;
  let ramadan: RamadanHours | null;
  try {
    hours = JSON.parse(String(formData.get("hours") ?? "{}")) as WeekHours;
    const raw = String(formData.get("ramadanHours") ?? "");
    ramadan = raw === "" ? null : (JSON.parse(raw) as RamadanHours);
  } catch {
    return { ok: false, problem: "not_found" };
  }

  const target =
    String(formData.get("scope") ?? "") === "all"
      ? ({ branchId: "all", from: branchId } as const)
      : ({ branchId } as const);

  const result = await saveBranchHours(
    actor.businessId,
    target,
    hours,
    ramadan,
    describeProblemText,
  );
  // The storefront renders these, so a saved week should be a saved week
  // everywhere rather than after the next deploy.
  if (result.ok) revalidatePath("/dashboard/hours");
  return result;
}

/** How many other branches would lose their hours to a copy-to-all. */
export async function countBranchesWithHours(formData: FormData): Promise<number> {
  const actor = await getActor();
  if (!actor?.businessId) return 0;
  return branchesWithHours(actor.businessId, String(formData.get("branchId") ?? ""));
}

export type ContinueResult =
  | { ok: true }
  | { ok: false; blocking: { branchId: string; gaps: BranchGap[] }[] };

/**
 * Criterion 4, and the funnel's criterion 3 in the same call.
 *
 * The check is re-read from the rows rather than trusted from the page — the
 * page's copy is as old as its last render, and a second tab may have deleted
 * the branch it is describing.
 *
 * When it passes, the listing goes live here rather than at the end of the
 * funnel. That is the funnel's own criterion 3: everything after this point,
 * the plan screen included, happens to a listing that is already on the
 * directory, so a supplier who closes the tab at the pricing table is listed,
 * findable and receiving enquiries up to the Free cap.
 */
export async function continueToPlan(): Promise<ContinueResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, blocking: [] };

  const check = await continueCheck(actor.businessId);
  if (!check.ready) return { ok: false, blocking: check.blocking };

  await goLive(actor.businessId);
  revalidatePath("/onboarding/plan");
  return { ok: true };
}
