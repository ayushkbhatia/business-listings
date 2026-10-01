import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanManageBilling } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { resolveNotificationSenders } from "@/lib/notify/senders";
import { absoluteUrl } from "@/lib/site";
import { t } from "@/lib/i18n";
import { billingRecipient } from "./tax-invoice";

/**
 * Sending an invoice, and recording that it went.
 *
 * Board 11g's `DELIVERY` panel. The board's version named no recipient and left
 * no record — *"Email to accounts"* against nobody in particular — and the two
 * failures are the same one: an accounting team asking *"did you send it, and to
 * whom"* has to be answered from a row, not from a mail server's logs.
 *
 * ## A one-off send does not change where invoices go
 *
 * Spec Q6. The billing address is board 7e's setting; this sends a copy. Both
 * the default and the one-off are written to `invoice_event` with the address
 * they actually reached, so the panel reads back what happened rather than what
 * was configured.
 *
 * ## The link, not the bytes
 *
 * The email carries a link to the document rather than the PDF as an
 * attachment. Attaching it would put a seller's invoice into a mailbox we do not
 * control, addressed to whatever was typed into a box — and the route behind the
 * link checks the capability on every read, where an attachment checks it once.
 */

export type SendResult =
  | { ok: true; address: string }
  | { ok: false; error: "not_found" | "no_address" | "no_sender" | "refused" };

/** A shape that is at least plausibly an address. Delivery is the real test. */
function looksLikeAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/**
 * Email one invoice.
 *
 * `to` absent means the billing address — 7e's setting, then the finance seat,
 * then the owner. Present, it is a one-off and nothing about the stored address
 * changes.
 *
 * Present and empty is a one-off with nothing in it, and is refused. It fell
 * through to the billing address: `sendInvoice` passes `""` for a field that was
 * opened and cleared, and says in a comment that this must not reach Settings —
 * the `||` below it did exactly that. Somebody who typed an accountant's address
 * and deleted it has not asked for the invoice to go to the owner instead.
 */
export async function emailInvoice(
  actor: Actor,
  businessId: string,
  invoiceId: string,
  to?: string | null,
): Promise<SendResult> {
  assertCanManageBilling(actor);
  /*
     A billing seat of this business, not any billing seat. Every other service
     in `lib/billing` refuses a business that is not the actor's own; this one
     checked the role and then trusted the id it was handed, which is a seat
     sending another firm's invoice to an address of its choosing. Not found
     rather than forbidden, the route's rule: an invoice that is not yours does
     not exist.
  */
  if (actor.businessId !== businessId) return { ok: false, error: "not_found" };

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, ref: true, businessId: true, status: true, totalFils: true },
  });
  if (!invoice || invoice.businessId !== businessId) return { ok: false, error: "not_found" };
  if (invoice.status === "draft") return { ok: false, error: "not_found" };

  const address =
    to === undefined || to === null ? ((await billingRecipient(businessId)) ?? "") : to.trim();
  if (!address || !looksLikeAddress(address)) return { ok: false, error: "no_address" };

  const sender = resolveNotificationSenders().email;
  /*
     No configured sender is a refusal, not a silent success.

     The same rule `paymentProvider().live` follows on `3m`: a stub that reports
     delivery is how a staging environment convinces somebody the mail works.
     Nothing is written to the delivery log either — a row saying it was emailed
     is a claim, and this claim would be false.
  */
  if (!sender) return { ok: false, error: "no_sender" };

  const url = absoluteUrl(`/dashboard/billing/invoice/${invoice.id}`);
  const result = await sender.send({
    channel: "email",
    to: address,
    subject: t("invoice.email.subject", { ref: invoice.ref }),
    body: t("invoice.email.body", { ref: invoice.ref }),
    actionLabel: t("invoice.email.action"),
    actionUrl: url,
    businessId,
  });

  if (!result.delivered) return { ok: false, error: "refused" };

  await prisma.invoiceEvent.create({
    data: {
      invoiceId: invoice.id,
      kind: "emailed",
      recipient: address,
      actorId: actor.id,
    },
  });

  return { ok: true, address };
}
