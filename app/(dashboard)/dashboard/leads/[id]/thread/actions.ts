"use server";

import { revalidatePath } from "next/cache";
import { t } from "@/lib/i18n";
import { nudge, postMessage } from "@/lib/messaging/service";
import {
  sendQuoteForBusiness,
  type SendQuoteInput,
  type SendQuoteResult,
} from "@/lib/quote/send-quote";
import { getSellerSeat } from "../../../_shell";

export type { SendQuoteInput, SendQuoteLineInput, SendQuoteResult } from "@/lib/quote/send-quote";

/**
 * The composer's submit.
 *
 * Thin on purpose: resolve who is acting, hand the work to the service, and
 * revalidate what changed. Every invariant lives in lib/quote/send-quote.ts,
 * where it can be tested against a real database without a request — see
 * tests/integration/send-quote.test.ts.
 */
/** The seller's half of the thread. Same service as the buyer's. */
export async function sendSellerMessage(input: {
  enquiryId: string;
  body: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("thread.not_yours") };

  const result = await postMessage({
    enquiryId: input.enquiryId,
    businessId: seat.businessId,
    senderId: seat.actor.id,
    sender: "seller",
    body: input.body,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "closed" ? t("thread.closed") : t("thread.not_yours"),
    };
  }

  revalidatePath(`/dashboard/leads/${input.enquiryId}/thread`);
  return { ok: true };
}

/**
 * The one follow-up. Board 11b says a second loses more deals than it wins, so
 * the service refuses one and this surfaces the refusal rather than hiding it.
 */
export async function nudgeBuyer(enquiryId: string): Promise<{ ok: boolean; error?: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("thread.not_yours") };

  const result = await nudge(enquiryId, seat.businessId);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "already_nudged" ? t("thread.nudge_help") : t("thread.nudge_not_yet"),
    };
  }

  revalidatePath(`/dashboard/leads/${enquiryId}/thread`);
  return { ok: true };
}

export async function sendQuote(input: SendQuoteInput): Promise<SendQuoteResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("quote.error.not_your_enquiry") };

  const result = await sendQuoteForBusiness(seat.actor, seat.businessId, input);
  if (!result.ok) return result;

  revalidatePath("/dashboard/leads");
  revalidatePath(`/dashboard/leads/${input.enquiryId}/thread`);
  revalidatePath("/dashboard/quotes");
  return result;
}
