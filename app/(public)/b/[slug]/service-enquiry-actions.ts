"use server";

import { getActor } from "@/lib/auth/session";
import { readAttribution } from "@/lib/campaign/cookie";
import { t } from "@/lib/i18n";
import type { ServiceEnquiryField } from "@/lib/enquiry/service-enquiry";
import { refusalWords } from "@/lib/enquiry/service-enquiry-words";
import {
  confirmEnquiryAttachment,
  sendServiceEnquiry,
  type SendServiceEnquiryInput,
} from "@/lib/enquiry/service-enquiry-server";

/**
 * Board `1d-s` — the storefront composer's two writes.
 *
 * Thin, like every action here: resolve who is asking, hand it to the service,
 * word the answer. The rules live in `lib/enquiry/service-enquiry.ts` and the
 * order they run in lives in `lib/enquiry/service-enquiry-server.ts`, where both
 * are tested without a request.
 *
 * Every string is built here rather than in the client, because a refusal is
 * only known here — and every error says what is wrong and what correct looks
 * like, never whose fault it was.
 */

export type ServiceEnquiryResult =
  | {
      ok: true;
      enquiryId: string;
      next: string;
      upload: { url: string; path: string } | null;
      claimToken: string | null;
    }
  | { ok: false; error: string; fields: Partial<Record<ServiceEnquiryField, string>> };

export async function submitServiceEnquiry(
  input: SendServiceEnquiryInput,
): Promise<ServiceEnquiryResult> {
  const actor = await getActor();
  const result = await sendServiceEnquiry(input, {
    buyerId: actor?.id ?? null,
    attribution: await readAttribution(),
  });

  if (result.ok) {
    return {
      ok: true,
      enquiryId: result.enquiryId,
      next: result.next,
      upload: result.upload,
      claimToken: result.claimToken,
    };
  }

  if ("refusals" in result) {
    const fields: Partial<Record<ServiceEnquiryField, string>> = {};
    for (const refusal of result.refusals) fields[refusal.field] ??= refusalWords(refusal);
    return { ok: false, error: t("storefront_services.composer.fix_fields"), fields };
  }

  return {
    ok: false,
    fields: {},
    error:
      result.error === "no_buyer"
        ? t("rfq.contact_required")
        : result.error === "no_recipients"
          ? t("storefront_services.composer.undelivered")
          : t("storefront_services.composer.gone"),
  };
}

export type AttachmentResult = { ok: true } | { ok: false };

export async function confirmServiceEnquiryAttachment(input: {
  enquiryId: string;
  path: string;
  filename: string;
  claimToken: string | null;
}): Promise<AttachmentResult> {
  const actor = await getActor();
  const result = await confirmEnquiryAttachment(input, { actorId: actor?.id ?? null });
  // The reason stays on the server. The buyer's page says the file did not
  // arrive, which is the one fact they can act on.
  return result.ok ? { ok: true } : { ok: false };
}
