"use server";

import { revalidatePath } from "next/cache";
import { t } from "@/lib/i18n";
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
