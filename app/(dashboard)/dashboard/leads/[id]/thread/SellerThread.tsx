"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Thread, type ThreadMessageView } from "@/components/domain";
import { t } from "@/lib/i18n";
import { threadLabels } from "@/lib/messaging/negotiation-words";
import { MAX_THREAD_ATTACHMENTS, THREAD_ATTACHMENT_TYPES } from "@/lib/messaging/attachments";
import { sendSellerMessage, signSellerAttachmentAction } from "./actions";

/**
 * Board 11b — the seller's side of one thread.
 *
 * Carries two things the buyer's side does not: the warning that this is the
 * record, and the read receipt. Board 11b states the warning in plain words and
 * the README says it is not decorative, so it is always on screen rather than
 * appearing once somebody has already tried.
 *
 * ## The chips changed shape
 *
 * They used to be three sentences that committed the supplier to terms nobody
 * had typed — one of them to a 21-day price hold, on a screen whose validity
 * field said fourteen and whose picker offers seven values. Board 11b §3:
 * suggest the act, never the number. The label names the act and the text it
 * drops in is a question the seller finishes.
 */

export function SellerThread({
  enquiryId,
  buyerFirstName,
  messages,
  readOnly,
  notes,
}: {
  enquiryId: string;
  buyerFirstName: string;
  messages: readonly ThreadMessageView[];
  readOnly: boolean;
  /**
   * The system lines under the thread, already worded: the read receipt, and
   * since board 3k a line for every extension of the quote's window.
   */
  notes: readonly string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);

  const labels = threadLabels(
    { logLabel: t("thread.log_buyer", { buyer: buyerFirstName }), formLabel: t("thread.composer_form") },
    "seller",
  );


  return (
    <Thread
      messages={messages}
      labels={labels}
      readOnly={readOnly}
      quickReplies={[
        { label: t("thread.chip.hold_price"), text: t("thread.chip.hold_price_text") },
        { label: t("thread.chip.site_survey"), text: t("thread.chip.site_survey_text") },
        { label: t("thread.chip.certificate"), text: t("thread.chip.certificate_text") },
      ]}
      systemNotes={notes}
      notice={
        <div className="rounded-ctl border border-line bg-paper-sunk px-3 py-2.5">
          <p className="text-body-sm text-ink">{t("thread.seller_warning_title")}</p>
          <p className="mt-1 max-w-[var(--measure-prose)] text-caption text-muted">
            {t("thread.seller_warning_body")}
          </p>
        </div>
      }
      busy={pending}
      {...(error ? { error } : {})}
      upload={{
        label: t("negotiation.attach.button"),
        hint: t("negotiation.attach.hint_seller"),
        accept: THREAD_ATTACHMENT_TYPES.join(","),
        maxFiles: MAX_THREAD_ATTACHMENTS,
        uploadingLabel: t("negotiation.attach.uploading"),
        removeLabel: (name) => t("negotiation.attach.remove", { name }),
        tooManyLabel: t("negotiation.attach.too_many"),
        upload: async (file) => {
          const signed = await signSellerAttachmentAction({ enquiryId, filename: file.name, type: file.type, bytes: file.size });
          if (!signed.ok) return signed;
          try {
            const response = await fetch(signed.url, { method: "PUT", headers: { "content-type": file.type }, body: file });
            return response.ok ? { ok: true, path: signed.path } : { ok: false, error: t("negotiation.attach.error_unavailable") };
          } catch {
            return { ok: false, error: t("negotiation.attach.error_unavailable") };
          }
        },
      }}
      onSend={async (body, attachments) => {
        setError(undefined);
        const result = await new Promise<Awaited<ReturnType<typeof sendSellerMessage>>>((resolve) => {
          startTransition(async () => {
            resolve(await sendSellerMessage({ enquiryId, body, attachments }));
          });
        });
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        router.refresh();
        return true;
      }}
    />
  );
}
