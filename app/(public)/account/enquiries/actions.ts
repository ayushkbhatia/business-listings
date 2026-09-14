"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { signInHref } from "@/lib/auth/next-path";
import { nudgeUnanswered } from "@/lib/enquiry/nudge";

/**
 * *Nudge 6 sellers* — board 10e's rail.
 *
 * Signed in only, and the buyer is in the service's own query, so a posted
 * reference that is not this buyer's is simply not found. The outcome returns
 * to the inbox in the query string: a count, never who was nudged.
 */
export async function nudgeSellersAction(formData: FormData): Promise<void> {
  const actor = await getActor();
  if (!actor) redirect(signInHref("/account/enquiries"));

  const ref = String(formData.get("ref") ?? "");
  const result = await nudgeUnanswered({ buyerId: actor.id, ref });

  revalidatePath("/account/enquiries");
  const params = new URLSearchParams(
    result.ok ? { nudged: String(result.nudged), ref } : { nudge_error: result.error, ref },
  );
  redirect(`/account/enquiries?${params}`);
}
