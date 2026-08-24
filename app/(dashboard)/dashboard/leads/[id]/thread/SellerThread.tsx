"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";
import { Thread, type ThreadLabels, type ThreadMessageView } from "@/components/domain";
import { t } from "@/lib/i18n";
import { nudgeBuyer, sendSellerMessage } from "./actions";

/**
 * Board 11b — the seller's side of one thread.
 *
 * Carries two things the buyer's side does not: the warning that this is the
 * record, and the single follow-up. Board 11b states the warning in plain
 * words and the README says it is not decorative, so it is always on screen
 * rather than appearing once somebody has already tried.
 */
export function SellerThread({
  enquiryId,
  buyerFirstName,
  messages,
  readOnly,
  canNudge,
  nudgedLabel,
}: {
  enquiryId: string;
  buyerFirstName: string;
  messages: readonly ThreadMessageView[];
  readOnly: boolean;
  canNudge: boolean;
  nudgedLabel: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);
  const [nudgeNote, setNudgeNote] = useState<string | null>(null);

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
    revisionOf: (revision) => t("thread.revision_of", { revision }),
    wasLabel: t("thread.was"),
  };

  return (
    <div className="space-y-4">
      <Thread
        messages={messages}
        labels={labels}
        readOnly={readOnly}
        quickReplies={[
          t("thread.chip.hold_price"),
          t("thread.chip.site_survey"),
          t("thread.chip.certificate"),
        ]}
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

      {/*
        One follow-up. The button disappears after it is used rather than
        greying out, because a disabled button invites a second attempt and
        board 11b's point is that there is no second.
      */}
      {nudgedLabel ? (
        <p className="text-caption text-muted">{nudgedLabel}</p>
      ) : canNudge ? (
        <div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            loading={pending}
            onClick={() => {
              setNudgeNote(null);
              startTransition(async () => {
                const result = await nudgeBuyer(enquiryId);
                if (result.ok) router.refresh();
                else setNudgeNote(result.error ?? null);
              });
            }}
          >
            {t("thread.nudge")}
          </Button>
          <p className="mt-1.5 text-caption text-muted">{t("thread.nudge_help")}</p>
          {nudgeNote ? (
            <p role="alert" className="mt-1.5 text-caption text-warn-ink">
              {nudgeNote}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-caption text-muted">{t("thread.nudge_not_yet")}</p>
      )}
    </div>
  );
}
