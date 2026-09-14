"use server";

import { revalidatePath } from "next/cache";
import { postMessage, signThreadAttachment, type PostMessageError } from "@/lib/messaging/service";
import { t } from "@/lib/i18n";
import { resolveBuyerId } from "./_buyer";

/**
 * The buyer's half of the thread.
 *
 * The seller's half is in the dashboard, and both call the same service — a
 * thread with two write paths is a thread whose two views can disagree.
 */
export type SendMessageResult = { ok: true } | { ok: false; error: string };

/** Every refusal the service can give, said to the buyer. One place, so the two actions agree. */
function refusalWords(error: PostMessageError | "unavailable"): string {
  switch (error) {
    case "supplier_closed":
      return t("thread.supplier_closed");
    case "closed":
      return t("thread.closed");
    case "not_chosen":
      return t("thread.not_chosen");
    case "type":
      return t("negotiation.attach.error_type");
    case "size":
      return t("negotiation.attach.error_size");
    case "count":
      return t("negotiation.attach.error_count");
    case "attachment_missing":
      return t("negotiation.attach.error_missing");
    case "unavailable":
      return t("negotiation.attach.error_unavailable");
    case "empty":
    case "not_a_participant":
    default:
      return t("thread.not_yours");
  }
}

export async function sendBuyerMessage(input: {
  enquiryId: string;
  businessId: string;
  body: string;
  attachments?: { path: string; filename: string }[];
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
    attachments: (input.attachments ?? []).slice(0, 10).map((file) => ({
      path: String(file.path),
      filename: String(file.filename),
    })),
  });

  if (!result.ok) return { ok: false, error: refusalWords(result.error) };

  // The page is dynamic and refreshes itself; the seller's side is what needs telling.
  revalidatePath(`/dashboard/leads/${input.enquiryId}/thread`);
  revalidatePath("/dashboard/leads");
  return { ok: true };
}

/**
 * A signed upload for one file the buyer is about to send.
 *
 * The browser puts the bytes straight to storage; the message that follows
 * reads them back and checks them again. Nothing is written here.
 */
export async function signBuyerAttachment(input: {
  enquiryId: string;
  businessId: string;
  filename: string;
  type: string;
  bytes: number;
  token?: string | null;
}): Promise<{ ok: true; url: string; path: string } | { ok: false; error: string }> {
  const buyerId = await resolveBuyerId(input.token ?? null);
  if (!buyerId) return { ok: false, error: t("thread.not_yours") };

  const result = await signThreadAttachment({
    enquiryId: input.enquiryId,
    businessId: input.businessId,
    senderId: buyerId,
    sender: "buyer",
    filename: String(input.filename),
    type: String(input.type),
    bytes: Number(input.bytes),
  });
  return result.ok ? result : { ok: false, error: refusalWords(result.error) };
}
