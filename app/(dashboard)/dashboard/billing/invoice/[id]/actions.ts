"use server";

import { revalidatePath } from "next/cache";
import { emailInvoice } from "@/lib/billing/invoice-delivery";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../../../_shell";

/**
 * The one action on board 11g, and it does not touch the invoice.
 *
 * Criterion 10: no control on this route writes to the document. Emailing it
 * writes an `invoice_event` — a record of what happened *to* the document —
 * which is the opposite of changing it.
 */
export type SendResult = { ok: true; message: string } | { ok: false; error: string };

export async function sendInvoice(formData: FormData): Promise<SendResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  /*
     Absent means the billing address. An empty string is not the same thing and
     must not fall through to it: somebody who opened the one-off field and
     cleared it has not asked to send to Settings.
  */
  const raw = formData.get("to");
  const to = raw === null ? null : String(raw).trim();

  const result = await emailInvoice(
    seat.actor,
    seat.businessId,
    String(formData.get("invoiceId") ?? ""),
    to,
  );

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "no_sender"
          ? t("invoice.email_no_sender")
          : result.error === "no_address"
            ? t("invoice.email_bad_address")
            : t("invoice.email_failed"),
    };
  }

  // The delivery panel is on this page and has just gained a row.
  revalidatePath(`/dashboard/billing/invoice/${String(formData.get("invoiceId") ?? "")}`);
  return { ok: true, message: t("invoice.emailed_ok", { address: result.address }) };
}
