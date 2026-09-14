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
 */
export async function acceptQuoteAction(formData: FormData): Promise<void> {
  const quoteId = String(formData.get("quoteId") ?? "");
  const enquiryId = String(formData.get("enquiryId") ?? "");
  const token = formData.get("token");

  const buyerId = await resolveBuyerId(typeof token === "string" ? token : null);
  // Back to the quotes being compared, not the buyer account's front page —
  // board 7a `B9`, a sign-in round trip returns to what was in progress.
  if (!buyerId) redirect(signInHref(`/enquiry/${encodeURIComponent(enquiryId)}/compare`));

  const result = await acceptQuote(buyerId, quoteId);
  const carry = typeof token === "string" && token ? `?t=${token}` : "";

  if (!result.ok) {
    const params = new URLSearchParams({ error: result.error });
    if (typeof token === "string" && token) params.set("t", token);
    redirect(`/enquiry/${enquiryId}/compare?${params}`);
  }

  revalidatePath(`/enquiry/${enquiryId}`);
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard/quotes");
  redirect(`/enquiry/${enquiryId}/accepted${carry}`);
}
