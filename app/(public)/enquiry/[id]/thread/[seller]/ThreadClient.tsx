"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Thread, type ThreadLabels, type ThreadMessageView } from "@/components/domain";
import { t } from "@/lib/i18n";
import { sendBuyerMessage } from "../../../thread-actions";

/**
 * The buyer's side of one thread, board 10h.
 *
 * The chips are the ones the README names. They are not filler: a buyer who
 * does not know what to ask asks nothing, and a thread that dies is a quote
 * nobody accepts.
 */
export function BuyerThread({
  enquiryId,
  businessId,
  supplierName,
  messages,
  token,
  readOnly,
}: {
  enquiryId: string;
  businessId: string;
  supplierName: string;
  messages: readonly ThreadMessageView[];
  token: string | null;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);

  const labels: ThreadLabels = {
    heading: t("thread.heading"),
    formLabel: t("thread.composer_form"),
    logLabel: t("thread.log", { supplier: supplierName }),
    empty: t("thread.empty"),
    composerLabel: t("thread.composer"),
    placeholder: t("thread.placeholder"),
    send: t("thread.send"),
    sending: t("thread.sending"),
    quickRepliesLabel: t("thread.quick_replies"),
    flagged: t("thread.flagged"),
    flaggedExplain: t("thread.flagged_explain"),
    revisionOf: (revision) => t("thread.revision_of", { revision }),
    wasLabel: t("thread.was"),
  };

  return (
    <Thread
      messages={messages}
      labels={labels}
      readOnly={readOnly}
      quickReplies={[
        t("thread.chip.validity"),
        t("thread.chip.datasheets"),
        t("thread.chip.credit"),
      ]}
      busy={pending}
      {...(error ? { error } : {})}
      onSend={(body) => {
        setError(undefined);
        startTransition(async () => {
          const result = await sendBuyerMessage({ enquiryId, businessId, body, token });
          if (result.ok) router.refresh();
          else setError(result.error);
        });
      }}
    />
  );
}
