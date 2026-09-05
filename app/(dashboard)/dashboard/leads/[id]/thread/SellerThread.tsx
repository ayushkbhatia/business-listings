"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Thread, type ThreadLabels, type ThreadMessageView } from "@/components/domain";
import { t } from "@/lib/i18n";
import { sendSellerMessage } from "./actions";

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
  receipt,
}: {
  enquiryId: string;
  buyerFirstName: string;
  messages: readonly ThreadMessageView[];
  readOnly: boolean;
  /** The read receipt, already worded. Null when there is no quote to have read. */
  receipt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);

  const labels: ThreadLabels = {
    heading: t("thread.heading"),
    formLabel: t("thread.composer_form"),
    logLabel: t("thread.log_buyer", { buyer: buyerFirstName }),
    empty: t("thread.empty"),
    composerLabel: t("thread.composer"),
    placeholder: t("thread.placeholder"),
    send: t("thread.send"),
    sending: t("thread.sending"),
    quickRepliesLabel: t("thread.quick_replies"),
    flagged: t("thread.flagged"),
    flaggedExplain: t("thread.flagged_explain"),
    automatic: t("thread.automatic"),
    automaticExplain: t("thread.automatic_explain"),
    revisionOf: (revision) => t("thread.revision_of", { revision }),
    wasLabel: t("thread.was"),
  };

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
      {...(receipt ? { systemNote: receipt } : {})}
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
      onSend={(body) => {
        setError(undefined);
        startTransition(async () => {
          const result = await sendSellerMessage({ enquiryId, body });
          if (result.ok) router.refresh();
          else setError(result.error);
        });
      }}
    />
  );
}
