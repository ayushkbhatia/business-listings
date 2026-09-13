"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/session";
import {
  addExtraCategory,
  removeExtraCategory,
  type AddCategoryResult,
  type RemoveCategoryResult,
} from "@/lib/onboarding/categories";
import { mayEditListing } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { patchProfileField, type PatchField, type PatchResult } from "@/lib/onboarding/profile";
import { t } from "@/lib/i18n";

/**
 * Board 2c's mutations. Every one of them scoped to the actor's own business.
 *
 * None takes a `businessId` from the form. The seat carries it, so a half-filled
 * profile cannot be pointed at somebody else's listing by editing a hidden
 * field — the same rule the rest of the funnel's actions follow.
 */

const PATCHABLE: readonly PatchField[] = [
  "displayName",
  "description",
  "establishedYear",
  "teamSize",
];

export type SaveFieldResult = PatchResult | { ok: false; field: PatchField; problem: never };

/**
 * Autosave, one field at a time.
 *
 * The board asks for a patch of the changed field only. Posting the whole form
 * on every idle is what turns two open tabs into one of them quietly writing its
 * ten-minute-old copy of the description over the other's work.
 */
export async function saveProfileField(formData: FormData): Promise<PatchResult> {
  const actor = await getActor();
  const field = String(formData.get("field") ?? "") as PatchField;

  if (!actor?.businessId || !PATCHABLE.includes(field)) {
    return {
      ok: false,
      field: PATCHABLE.includes(field) ? field : "displayName",
      problem: { kind: "too_short" },
    };
  }

  const result = await patchProfileField(
    actor.businessId,
    field,
    String(formData.get("value") ?? ""),
  );

  /*
     Revalidated only on a save that landed. A rejected value has changed
     nothing, and re-rendering the server component would replace what the
     seller is still typing with what is on the record.
  */
  if (result.ok) revalidatePath("/onboarding/profile");
  return result;
}

/**
 * Who may change the category set — and it is not "whoever holds a seat".
 *
 * These two guarded on `actor?.businessId` alone, which every seat has: a sales
 * or finance seat could add and drop the trades the listing is filed under, and
 * `removeCategory` then returned `{ ok: true }` whether a row went or not, so
 * nothing anywhere said no. Its dashboard sibling `removeCoverage` has called
 * `assertCanEditListing` since board 3c.
 *
 * The check sits here rather than in `lib/onboarding/categories.ts` because
 * that module is `businessId`-scoped throughout and takes no `Actor` anywhere —
 * threading one through for this would rewrite its whole surface. Every other
 * mutation in this funnel guards at the action for the same reason.
 *
 * `mayEditListing` rather than `assertCanEditListing`: these are autosave
 * actions whose callers read a result object, and an exception across that
 * boundary is a 500 where a refusal is the honest answer.
 */
function mayEdit(actor: Actor | null): actor is Actor & { businessId: string } {
  return Boolean(actor?.businessId) && mayEditListing(actor as Actor);
}

export async function addCategory(formData: FormData): Promise<AddCategoryResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, reason: "not_found" };
  if (!mayEdit(actor)) return { ok: false, reason: "forbidden" };

  const result = await addExtraCategory(
    actor.businessId,
    String(formData.get("categoryId") ?? ""),
  );
  if (result.ok) revalidatePath("/onboarding/profile");
  return result;
}

export async function removeCategory(formData: FormData): Promise<RemoveCategoryResult> {
  const actor = await getActor();
  if (!mayEdit(actor)) return { ok: false, reason: "forbidden" };

  const result = await removeExtraCategory(
    actor.businessId,
    String(formData.get("categoryId") ?? ""),
  );
  // Only when a row actually went. Re-rendering on a no-op would replace the
  // screen for a click that changed nothing.
  if (result.removed) revalidatePath("/onboarding/profile");
  return result;
}

export type ContinueResult = { ok: true } | { ok: false; error: string };

/**
 * The one button, and the only three fields it checks.
 *
 * Board 2c: display name, primary category and description are the minimum for
 * a publishable listing. Logo, cover, established and team size are the meter's
 * levers and reachable forever from the dashboard — they do not gate this, and a
 * button that refused on them would be asking for work the page itself calls
 * optional.
 */
export async function continueToLocations(): Promise<ContinueResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, error: t("dev.no_seat_title") };

  const { prisma } = await import("@/lib/db/client");
  const business = await prisma.business.findUnique({
    where: { id: actor.businessId },
    select: { displayName: true, description: true, primaryCategoryId: true },
  });

  const ready =
    Boolean(business?.displayName.trim()) &&
    Boolean(business?.description?.trim()) &&
    Boolean(business?.primaryCategoryId);

  return ready ? { ok: true } : { ok: false, error: t("profile_step.error.required") };
}
