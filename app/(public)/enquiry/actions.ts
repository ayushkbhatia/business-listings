"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { acceptQuote } from "@/lib/enquiry/service";
import { signInHref } from "@/lib/auth/next-path";
import { resolveBuyerId } from "./_buyer";

/**
 * Accepting a quote.
 *
 * The terminal state of the product. Everything it does is in
 * lib/enquiry/service.ts — this resolves who is asking and where they land.
 *
 * Two screens post here, the comparison (`1n`) and the negotiation thread
 * (`10h`), and board `10h` `B6` is why it is one action: accepting from the
 * thread does exactly what accepting from the comparison does. The only
 * difference is where a refusal is read — back on the screen it was pressed on.
 */

/** `thread:<slug>` names the thread the accept came from. Anything else is the comparison. */
function returnPath(enquiryId: string, from: FormDataEntryValue | null): string {
  const base = `/enquiry/${encodeURIComponent(enquiryId)}`;
  if (typeof from === "string") {
    const match = /^thread:([a-z0-9-]{1,120})$/.exec(from);
    if (match) return `${base}/thread/${match[1]}`;
  }
  return `${base}/compare`;
}

export async function acceptQuoteAction(formData: FormData): Promise<void> {
  const quoteId = String(formData.get("quoteId") ?? "");
  const enquiryId = String(formData.get("enquiryId") ?? "");
  const token = formData.get("token");
  const back = returnPath(enquiryId, formData.get("from"));

  const buyerId = await resolveBuyerId(typeof token === "string" ? token : null);
  // Back to the screen the accept was pressed on, not the buyer account's front
  // page — board 7a `B9`, a sign-in round trip returns to what was in progress.
  if (!buyerId) redirect(signInHref(back));

  const result = await acceptQuote(buyerId, quoteId);
  const carry = typeof token === "string" && token ? `?t=${token}` : "";

  if (!result.ok) {
    const params = new URLSearchParams({ error: result.error });
    if (typeof token === "string" && token) params.set("t", token);
    redirect(`${back}?${params}`);
  }

  revalidatePath(`/enquiry/${enquiryId}`);
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/quotes");
  redirect(`/enquiry/${enquiryId}/accepted${carry}`);
}
