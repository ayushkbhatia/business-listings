"use client";

import { useState, useTransition } from "react";
import { Button, Input, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display";
import { t } from "@/lib/i18n";
import type { ActionResult } from "../actions";

/**
 * Board 4h `B5` — the decision, taken where the evidence is.
 *
 * One reason box, shared by every control, and nothing here submits without it:
 * every staff state change on this board writes an audit row with a written
 * reason, which is non-negotiable 3 and the sentence the rail makes to sellers.
 *
 * ## Three controls, and what each of them is
 *
 * **Resolve** closes the report with one of three outcomes. **Escalate** leaves
 * it open and puts it in front of an ops lead — it is not a fourth outcome, and
 * it is not a suspension: the ops lead takes that on `/admin/businesses`, where
 * it has its reason codes and its appeal path. **Remove the reply** is board
 * 11c `B4`, ops-lead only, and the same `removeSellerReply` the reviews screen
 * calls rather than a second one that looks like it.
 *
 * A control the seat cannot use is not drawn. Board 4i: *"a hidden button is a
 * UI opinion and a server action is a URL"* — so the service checks too, and
 * this decides what a moderator is asked to look at.
 */

const MIN_REASON = 4;

export interface DecidePanelProps {
  reportId: string;
  /** Null where this report is not about a review. */
  reviewId: string | null;
  hasRemovableReply: boolean;
  escalated: boolean;
  /** How many other records this decision will close with it (`B6`). */
  alsoCloses: number;
  mayRemoveReply: boolean;
  resolve: (formData: FormData) => Promise<ActionResult>;
  escalate: (formData: FormData) => Promise<ActionResult>;
  removeSellerReply: (formData: FormData) => Promise<ActionResult>;
}

const OUTCOMES = ["seller_corrected", "upheld", "no_action"] as const;

export function DecidePanel({
  reportId,
  reviewId,
  hasRemovableReply,
  escalated,
  alsoCloses,
  mayRemoveReply,
  resolve,
  escalate,
  removeSellerReply,
}: DecidePanelProps) {
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = reason.trim().length >= MIN_REASON && !pending;

  function run(action: (formData: FormData) => Promise<ActionResult>, extra: Record<string, string>) {
    const form = new FormData();
    form.set("reason", reason);
    for (const [key, value] of Object.entries(extra)) form.set(key, value);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) setReason("");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-body-sm text-ink">{t("admin.review.reason_label")}</span>
        <Textarea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-describedby="decide-reason-hint"
        />
        <span id="decide-reason-hint" className="text-caption text-muted">
          {t("admin.reports.reason_hint")}
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {OUTCOMES.map((outcome) => (
          <Button
            key={outcome}
            variant={outcome === "seller_corrected" ? "primary" : "secondary"}
            disabled={!ready}
            onClick={() => run(resolve, { reportId, outcome })}
          >
            {t(`admin.reports.outcome.${outcome}` as "admin.reports.outcome.upheld")}
          </Button>
        ))}
      </div>

      {alsoCloses > 0 && (
        <p className="text-caption text-muted">
          {t("admin.reports.also_closes", { count: alsoCloses })}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button
          variant="secondary"
          disabled={!ready || escalated}
          onClick={() => run(escalate, { reportId })}
        >
          {escalated ? t("admin.reports.already_escalated") : t("admin.reports.escalate")}
        </Button>
        {mayRemoveReply && reviewId && hasRemovableReply && (
          <Button variant="danger" disabled={!ready} onClick={() => run(removeSellerReply, { reviewId })}>
            {t("admin.reports.remove_reply")}
          </Button>
        )}
      </div>

      <p className="max-w-prose text-caption text-muted">{t("admin.reports.escalate_note")}</p>

      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: result.fix })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </div>
  );
}

/**
 * `B6`'s other half — two reports a person can see are one problem.
 *
 * The collapse in `lib/reports/queue.ts` groups on `(business, kind, field)`,
 * which catches three buyers reporting one telephone number and misses a
 * photograph reported once as content and once as wrong details. This is how a
 * moderator who has read both says so, and it takes the id of the report this
 * one duplicates rather than guessing.
 */
export function MarkDuplicate({
  reportId,
  duplicate,
}: {
  reportId: string;
  duplicate: (formData: FormData) => Promise<ActionResult>;
}) {
  const [ofId, setOfId] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    const form = new FormData();
    form.set("reportId", reportId);
    form.set("duplicateOfId", ofId.trim());
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await duplicate(form);
      setResult(outcome);
      if (outcome.ok) {
        setOfId("");
        setReason("");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-body-sm text-ink">{t("admin.reports.duplicate_of")}</span>
        <Input
          mono
          value={ofId}
          onChange={(event) => setOfId(event.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-body-sm text-ink">{t("admin.review.reason_label")}</span>
        <Input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <div>
        <Button
          variant="secondary"
          disabled={ofId.trim().length < 8 || reason.trim().length < MIN_REASON || pending}
          onClick={send}
        >
          {t("admin.reports.mark_duplicate")}
        </Button>
      </div>
      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: result.fix })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </div>
  );
}
