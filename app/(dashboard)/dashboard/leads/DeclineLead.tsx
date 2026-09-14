"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { Button, Textarea } from "@/components/primitives";
import { Modal } from "@/components/structure";
import { t } from "@/lib/i18n";
import { declineLeadAction } from "./actions";

/**
 * Board `3j-s` — `Decline`, behind a confirmation that says what the buyer sees.
 *
 * A modal rather than a one-click button, because it is final: the buyer's row
 * changes the moment it commits, and they may act on it — widen the area, send
 * to two more suppliers — before anybody could take it back. The confirmation
 * repeats the verb, puts Cancel first, and quotes the buyer's row back to the
 * seller so they decline knowing exactly what it will read.
 *
 * The reason is optional and goes to the buyer as written. It is not a code
 * picked from a list: *outside the area we cover* and *we are fully booked
 * until March* are both useful to a buyer, and a dropdown holds neither.
 */

export const DECLINE_REASON_LIMIT = 200;

export function DeclineLead({ enquiryId, buyerFirstName }: { enquiryId: string; buyerFirstName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const opener = useRef<HTMLElement | null>(null);
  const reasonId = useId();

  function close() {
    setOpen(false);
    // Back to where the seller was, not to the top of the page.
    requestAnimationFrame(() => opener.current?.focus());
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await declineLeadAction({ enquiryId, reason });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error ?? t("decline.error.generic"));
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={(event) => {
          opener.current = event.currentTarget;
          setOpen(true);
        }}
      >
        {t("decline.action")}
      </Button>
      <Modal
        open={open}
        onClose={close}
        title={t("decline.title")}
        description={t("decline.description", { name: buyerFirstName || t("decline.the_buyer") })}
        closeLabel={t("lead.close")}
        size="sm"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={close}>
              {t("lead.cancel")}
            </Button>
            <Button type="button" variant="danger" loading={pending} onClick={confirm}>
              {t("decline.confirm")}
            </Button>
          </>
        }
      >
        <div className="space-y-1.5">
          <label htmlFor={reasonId} className="block text-body-sm text-ink">
            {t("decline.reason_label")}
          </label>
          <Textarea
            id={reasonId}
            rows={3}
            limit={DECLINE_REASON_LIMIT}
            counterLabel={(used, limit) => t("field.counter", { used, limit })}
            placeholder={t("decline.reason_placeholder")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-caption text-muted">{t("decline.reason_note")}</p>
          {error ? (
            <p role="alert" className="text-caption text-bad-ink">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
