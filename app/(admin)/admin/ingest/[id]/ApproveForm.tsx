"use client";

import { useId, useState, useTransition } from "react";
import { Button, Label, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ActionResult } from "../actions";

/**
 * Approving a run creates listings. The count is on the button's own panel
 * rather than in a confirm dialog after it, for the reason board 5a gives about
 * publishing: a number you see before you decide is a decision, and one you see
 * after is a receipt.
 */

const MIN_REASON = 4;

export function ApproveForm({
  runId,
  ready,
  approve,
}: {
  runId: string;
  ready: number;
  approve: (formData: FormData) => Promise<ActionResult>;
}) {
  const fieldId = useId();
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    const form = new FormData();
    form.set("runId", runId);
    form.set("reason", reason);
    startTransition(async () => setResult(await approve(form)));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-prose text-caption text-muted">{t("admin.run.nothing_publishes")}</p>

      <div className="flex flex-col gap-1">
        <Label
          htmlFor={fieldId}
          requirement="required"
          requirementLabel={t("field.required")}
          hint={t("admin.review.reason_hint")}
        >
          {t("admin.review.reason_label")}
        </Label>
        <Textarea
          id={fieldId}
          value={reason}
          rows={3}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>

      <div>
        <Button disabled={reason.trim().length < MIN_REASON || pending || ready === 0} onClick={send}>
          {t("admin.run.approve")} · {formatCount(ready)}
        </Button>
      </div>

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
