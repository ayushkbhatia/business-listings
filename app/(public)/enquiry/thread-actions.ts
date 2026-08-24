"use server";

import { revalidatePath } from "next/cache";
import { postMessage } from "@/lib/messaging/service";
import { t } from "@/lib/i18n";
import { resolveBuyerId } from "./_buyer";

/**
 * The buyer's half of the thread.
 *
 * The seller's half is in the dashboard, and both call the same service — a
 * thread with two write paths is a thread whose two views can disagree.
 */
export type SendMessageResult = { ok: true } | { ok: false; error: string };

export async function sendBuyerMessage(input: {
  enquiryId: string;
  businessId: string;
  body: string;
  token?: string | null;
}): Promise<SendMessageResult> {
  const buyerId = await resolveBuyerId(input.token ?? null);
  if (!buyerId) return { ok: false, error: t("thread.not_yours") };

  const result = await postMessage({
    enquiryId: input.enquiryId,
    businessId: input.businessId,
    senderId: buyerId,
    sender: "buyer",
    body: input.body,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "closed" ? t("thread.closed") : t("thread.not_yours"),
    };
  }

  revalidatePath(`/enquiry/${input.enquiryId}/thread/${input.businessId}`);
  revalidatePath(`/dashboard/leads/${input.enquiryId}/thread`);
  return { ok: true };
}
