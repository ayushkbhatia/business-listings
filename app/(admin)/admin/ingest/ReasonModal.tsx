"use client";

import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Label, Textarea } from "@/components/primitives";
import { Modal } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * A run decision, confirmed with a written reason.
 *
 * Every control on the importer that changes a run is audited (B8), and the
 * reason is asked for in the same dialog that names what will happen — the
 * number of listings, what stays and what goes — so the sentence somebody
 * writes is about the consequence they have just read, not about a button.
 *
 * The confirm repeats the verb, per §05: "Publish 6,104 listings", never "OK".
 * The field's floor matches `assertReason`'s, so the button cannot be pressed
 * into a refusal the server would give.
 */

const MIN_REASON = 4;

export interface ReasonModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** What will happen, above the reason. */
  children?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** The line under the reason field. Defaults to the run's wording. */
  reasonHint?: string;
  /** The decision cannot be made at all; the children say why. */
  blocked?: boolean;
  /** Hidden fields sent with the reason. */
  fields: Record<string, string>;
  action: (formData: FormData) => Promise<ActionResult>;
  onDone: (result: ActionResult) => void;
}

export function ReasonModal({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel,
  destructive = false,
  blocked = false,
  reasonHint = t("admin.ingest.reason_hint"),
  fields,
  action,
  onDone,
}: ReasonModalProps) {
  const fieldId = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setError(null);
    onClose();
  }

  function confirm() {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    form.set("reason", reason);
    startTransition(async () => {
      const result = await action(form);
      if (result.ok) {
        setReason("");
        setError(null);
        onDone(result);
      } else {
        // Kept inside the dialog, beside the reason that was refused, rather
        // than behind it on the page where nobody is looking.
        setError(result.error);
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      {...(description ? { description } : {})}
      closeLabel={t("action.cancel")}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={pending}>
            {t("action.cancel")}
          </Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            loading={pending}
            disabled={blocked || reason.trim().length < MIN_REASON || pending}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {children}
        <div className="flex flex-col gap-1">
          <Label
            htmlFor={fieldId}
            requirement="required"
            requirementLabel={t("field.required")}
            hint={reasonHint}
          >
            {t("admin.review.reason_label")}
          </Label>
          <Textarea
            id={fieldId}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        {error && (
          <Alert tone="bad" live="assertive" fix={reasonHint}>
            {error}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
