"use server";

import { revalidatePath } from "next/cache";
import { formatCount, formatList } from "@/lib/format";
import { t } from "@/lib/i18n";
import { MESSAGE_ALL_MAX } from "@/lib/messaging/limits";
import { messageAllSuppliers } from "@/lib/messaging/message-all";
import { resolveBuyerId } from "../../_buyer";

/**
 * Board `1n` — *Message all*, from the comparison.
 *
 * Resolves who is asking the way the page does (the session, or the claim token
 * a buyer with no account carries), hands the words to the service, and says
 * what happened in words. The service decides everything; this is the edge.
 */
export type MessageAllState =
  | { status: "idle" }
  | { status: "sent"; message: string }
  | { status: "error"; message: string };

export async function messageAllAction(_previous: MessageAllState, formData: FormData): Promise<MessageAllState> {
  const ref = String(formData.get("enquiryId") ?? "");
  const body = String(formData.get("body") ?? "");
  const token = formData.get("token");

  const buyerId = await resolveBuyerId(typeof token === "string" && token ? token : null);
  if (!buyerId) return { status: "error", message: t("compare_quotes.message_all.error.not_found") };

  const result = await messageAllSuppliers({ buyerId, ref, body });
  if (!result.ok) {
    switch (result.error) {
      case "empty":
        return { status: "error", message: t("compare_quotes.message_all.error.empty") };
      case "too_long":
        return { status: "error", message: t("compare_quotes.message_all.error.too_long", { max: formatCount(MESSAGE_ALL_MAX) }) };
      case "decided":
        return { status: "error", message: t("compare_quotes.message_all.error.decided") };
      case "closed":
        return { status: "error", message: t("compare_quotes.message_all.error.closed") };
      case "nobody":
        return { status: "error", message: t("compare_quotes.message_all.error.nobody") };
      case "rate_limited":
        return {
          status: "error",
          message: t("compare_quotes.message_all.error.rate_limited", {
            minutes: Math.max(1, Math.ceil((result.retryAfterMs ?? 60_000) / 60_000)),
          }),
        };
      default:
        return { status: "error", message: t("compare_quotes.message_all.error.not_found") };
    }
  }

  revalidatePath(`/enquiry/${ref}/compare`);
  revalidatePath("/dashboard/leads");
  const total = result.sent + result.skipped.length;
  return {
    status: "sent",
    message:
      result.skipped.length === 0
        ? t("compare_quotes.message_all.sent", { count: result.sent })
        : t("compare_quotes.message_all.partial", {
            sent: result.sent,
            total,
            names: formatList(result.skipped.map((row) => row.displayName)),
          }),
  };
}
