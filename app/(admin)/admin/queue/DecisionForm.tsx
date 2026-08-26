"use client";

import { useId, useState, useTransition } from "react";
import { Button, Label, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * The reason field, and the two buttons that cannot be pressed without it.
 *
 * `assertReason` refuses a blank, a row of punctuation, and anything under four
 * characters — but it refuses them at the service layer, which means the person
 * finds out after clicking. The buttons are disabled until there is something
 * to send, so the rule is visible before it is enforced rather than only after.
 *
 * The reason is one field for both decisions. An approval needs a reason as
 * much as a rejection does: "approved" with no explanation is the row somebody
 * has to interpret a year later, and §07 gives ops lead no exemption.
 */

export interface DecisionFormProps {
  requestId: string;
  approve: (formData: FormData) => Promise<ActionResult>;
  reject: (formData: FormData) => Promise<ActionResult>;
  /** Shown under the approve button where approving moves the public address. */
  note?: string;
}

const MIN_REASON = 4;

export function DecisionForm({ requestId, approve, reject, note }: DecisionFormProps) {
  const fieldId = useId();
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = reason.trim().length >= MIN_REASON;

  function send(action: (formData: FormData) => Promise<ActionResult>) {
    const form = new FormData();
    form.set("requestId", requestId);
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) setReason("");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor={fieldId} requirement="required" requirementLabel={t("field.required")} hint={t("admin.review.reason_hint")}>
          {t("admin.review.reason_label")}
        </Label>
        <Textarea
          id={fieldId}
          value={reason}
          rows={3}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!ready || pending} onClick={() => send(approve)}>
          {t("admin.review.approve")}
        </Button>
        <Button variant="secondary" disabled={!ready || pending} onClick={() => send(reject)}>
          {t("admin.review.reject")}
        </Button>
      </div>

      {note && <p className="max-w-prose text-caption text-muted">{note}</p>}

      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: t("admin.review.reason_hint") })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </div>
  );
}
