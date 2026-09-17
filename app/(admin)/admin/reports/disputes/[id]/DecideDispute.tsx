"use client";

import { useState, useTransition } from "react";
import { Button, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display";
import { t } from "@/lib/i18n";
import type { ActionResult } from "../../actions";

/**
 * Board 11c `B5` — deciding a review dispute, where the review is.
 *
 * Two outcomes, not three. A listing can be corrected and a review cannot: it
 * comes down or it stands, and a third button that resolves to nothing is how a
 * queue starts producing decisions nobody can act on.
 *
 * ## Upholding is not offered to a seat that cannot do it
 *
 * Upholding removes the review, and `review.remove` is ops lead alone. A
 * moderator gets the refusal control and a line saying where the other decision
 * lives — not a button that submits and comes back with a no. Board 4i:
 * *"a hidden button is a UI opinion and a server action is a URL"*, so
 * `resolveDispute` checks the capability before it opens a transaction and this
 * decides what is drawn.
 *
 * The reason gates both buttons rather than being something to fill in
 * afterwards, because the promise in the seller's own copy is *"the outcome and
 * the reason are logged and sent to you"*.
 */

const MIN_REASON = 4;

export function DecideDispute({
  disputeId,
  mayUphold,
  decide,
}: {
  disputeId: string;
  mayUphold: boolean;
  decide: (formData: FormData) => Promise<ActionResult>;
}) {
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = reason.trim().length >= MIN_REASON && !pending;

  function send(outcome: "upheld" | "refused") {
    const form = new FormData();
    form.set("disputeId", disputeId);
    form.set("outcome", outcome);
    form.set("reason", reason);
    startTransition(async () => {
      const outcomeResult = await decide(form);
      setResult(outcomeResult);
      if (outcomeResult.ok) setReason("");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-body-sm text-ink">{t("admin.review.reason_label")}</span>
        <Textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {mayUphold && (
          <Button disabled={!ready} onClick={() => send("upheld")}>
            {t("admin.disputes.uphold")}
          </Button>
        )}
        <Button
          variant={mayUphold ? "secondary" : "primary"}
          disabled={!ready}
          onClick={() => send("refused")}
        >
          {t("admin.disputes.refuse")}
        </Button>
      </div>

      <p className="max-w-prose text-caption text-muted">
        {mayUphold ? t("admin.disputes.note") : t("admin.disputes.refuse_only")}
      </p>

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
