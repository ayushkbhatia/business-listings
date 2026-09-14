"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { signInHref } from "@/lib/auth/next-path";
import { asCadence, forgetSavedSearch, openSavedSearch, setCadence } from "@/lib/saved-search/service";

/**
 * Board 10e — the three things a buyer does to a saved search.
 *
 * Every one is scoped to the signed-in buyer inside the service's `where`, not
 * by trusting the id in the form: a posted id is a value the client chose.
 */

async function buyerOr(next: string): Promise<string> {
  const actor = await getActor();
  if (!actor) redirect(signInHref(next));
  return actor.id;
}

/** Remove one saved search. */
export async function forgetSearch(formData: FormData): Promise<void> {
  const userId = await buyerOr("/account/saved");
  const removed = await forgetSavedSearch(userId, String(formData.get("id") ?? ""));
  revalidatePath("/account/saved");
  revalidatePath("/account/enquiries");
  // Its own URL, so a banner from an earlier cadence change does not survive the removal.
  redirect(removed ? "/account/saved?removed=1" : "/account/saved");
}

/**
 * Open it. A POST, not a link: opening clears the new-match count (`B7`), and a
 * GET that changes state is one a link prefetch would press on hover.
 */
export async function openSearch(formData: FormData): Promise<void> {
  const userId = await buyerOr("/account/saved");
  const href = await openSavedSearch(userId, String(formData.get("id") ?? ""));
  revalidatePath("/account/saved");
  revalidatePath("/account/enquiries");
  redirect(href ?? "/account/saved");
}

/** Change how often it alerts. Takes effect on the next run; the count is not reset. */
export async function changeCadence(formData: FormData): Promise<void> {
  const userId = await buyerOr("/account/saved");
  const cadence = asCadence(formData.get("cadence"));
  const id = String(formData.get("id") ?? "");
  const changed = cadence ? await setCadence(userId, id, cadence) : false;
  revalidatePath("/account/saved");
  revalidatePath("/account/enquiries");
  redirect(`/account/saved?${new URLSearchParams(changed ? { changed: id } : { error: "cadence" })}#${id}`);
}
