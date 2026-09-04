"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/session";
import { removeShortlist, toggleShortlist } from "@/lib/shortlist/service";

/**
 * The two writers behind the save control.
 *
 * Thin, like every action in `app/`: resolve who is asking, hand it to the
 * service, revalidate. Every rule about what a shortlist is — signed in only,
 * which press saves and which removes, what a racing double tap settles on —
 * lives in `lib/shortlist/service.ts`, where it is tested without a request.
 */

export type ShortlistActionResult =
  | { ok: true; saved: boolean }
  | { ok: false; error: "signed_out" | "not_found" };

/**
 * Revalidate the supplier's whole storefront, not the one page.
 *
 * The save control sits on the overview, the catalogue and every product page,
 * and the seller's own count moves with it. `"layout"` covers the subtree in
 * one call; `"page"` would leave the same button showing the old state on the
 * three tabs the buyer did not press it on.
 */
function revalidateSupplier(slug: string): void {
  revalidatePath(`/b/${slug}`, "layout");
  revalidatePath("/account/saved/shortlist");
}

/**
 * One press on the save control. `next` is the state the button is moving to.
 *
 * The direction travels from the client because the button already holds it —
 * it has moved its own label optimistically before this is called. A server
 * that inferred the direction instead would flip twice on a double tap and
 * leave the buyer with nothing saved. See lib/shortlist/service.ts.
 */
export async function toggleShortlistAction(
  businessId: string,
  next: boolean,
): Promise<ShortlistActionResult> {
  const actor = await getActor();
  const result = await toggleShortlist(actor, businessId, next);

  if (!result.ok) return { ok: false, error: result.error };

  revalidateSupplier(result.slug);
  return { ok: true, saved: result.saved };
}

/**
 * Remove one supplier from the saved-suppliers page.
 *
 * A real form action, so the page works without JavaScript — the sibling at
 * `/account/saved` removes a saved search the same way. It deletes rather than
 * toggles: a resubmitted form must not put back what the buyer just removed.
 */
export async function removeFromShortlist(formData: FormData): Promise<void> {
  const actor = await getActor();
  const result = await removeShortlist(actor, String(formData.get("businessId") ?? ""));

  if (!result.ok) return;
  if (result.slug) revalidateSupplier(result.slug);
  else revalidatePath("/account/saved/shortlist");
}
