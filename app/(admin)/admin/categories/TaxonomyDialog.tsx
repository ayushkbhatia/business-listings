"use client";

import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, FieldError, Label, Textarea } from "@/components/primitives";
import { Modal } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * Board 4d's decision dialog. Every taxonomy write on this screen that is not
 * the editor's Save goes through it: a switch, an address, a removal, an add,
 * a merge.
 *
 * Each is a staff state change with a written reason (non-negotiable 3), so the
 * reason sits at the moment of the decision and the confirm button repeats the
 * verb (§05). The floor on the reason mirrors `assertReason` — four characters,
 * with a letter or a digit in them — so the button says honestly when the
 * server will accept it. The service is still the rule.
 */

const MIN_REASON = 4;

export function reasonReady(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length >= MIN_REASON && /[\p{Letter}\p{Number}]/u.test(trimmed);
}

export type DialogOutcome = { ok: true; message: string } | { ok: false; error: string };

export function TaxonomyDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  destructive = false,
  ready = true,
  size = "md",
  children,
  onSubmit,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  /** Whether the fields above the reason are complete and the change is allowed. */
  ready?: boolean;
  size?: "sm" | "md" | "lg";
  children?: React.ReactNode;
  onSubmit: (reason: string) => Promise<DialogOutcome>;
  onDone: (message: string) => void;
}) {
  const reasonId = useId();
  const errorId = `${reasonId}-error`;
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    if (pending) return;
    setReason("");
    setReasonError(null);
    setError(null);
    onClose();
  }

  function submit() {
    if (!reasonReady(reason)) {
      // Required-field errors on submit, never on the first keystroke (§02).
      setReasonError(t("taxonomy.dialog.reason_short"));
      return;
    }
    setError(null);
    startTransition(async () => {
      const outcome = await onSubmit(reason);
      if (outcome.ok) {
        setReason("");
        onDone(outcome.message);
        return;
      }
      setError(outcome.error);
    });
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      {...(description ? { description } : {})}
      closeLabel={t("overlay.close")}
      dismissible={!pending}
      size={size}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={pending}>
            {t("action.cancel")}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={submit} loading={pending} disabled={!ready || pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {children}

        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={reasonId}
            requirement="required"
            requirementLabel={t("field.required")}
            hint={t("taxonomy.dialog.reason_hint")}
          >
            {t("taxonomy.dialog.reason")}
          </Label>
          <Textarea
            id={reasonId}
            rows={2}
            value={reason}
            invalid={reasonError !== null}
            aria-describedby={errorId}
            onChange={(event) => {
              setReason(event.target.value);
              if (reasonError && reasonReady(event.target.value)) setReasonError(null);
            }}
          />
          <FieldError id={errorId}>{reasonError}</FieldError>
        </div>

        {/* A failed save is the one assertive announcement §09 allows. */}
        {error ? (
          <Alert tone="bad" live="assertive">
            {error}
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}
