"use server";

import { revalidatePath } from "next/cache";
import { nudge } from "@/lib/enquiry/nudge";
import { resolveBuyerId } from "./_buyer";

/**
 * The buyer's nudge, from the tracking page.
 *
 * Access is the token or the session, resolved the same way the page itself
 * resolves it — an action that trusted a business id from the form would let
 * anybody nudge on anybody's enquiry.
 */
export async function nudgeRecipient(input: {
  ref: string;
  businessId: string;
  token: string | null;
}): Promise<{ ok: boolean }> {
  const buyerId = await resolveBuyerId(input.token);
  if (!buyerId) return { ok: false };

  const result = await nudge({
    buyerId,
    ref: input.ref,
    businessId: input.businessId,
  });

  if (result.ok) revalidatePath(`/enquiry/${input.ref}`);
  return { ok: result.ok };
}
