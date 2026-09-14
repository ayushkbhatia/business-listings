"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Label, Radio, RadioGroup, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display";
import { t } from "@/lib/i18n";
import type { ActionResult } from "../actions";
import type { DecisionView } from "./view";

/**
 * Board `4c-s` — the three decisions, and the one the evidence does not allow
 * replaced by the sentence that says why.
 *
 * **B3.** `Verify — all three match` renders only where the read allows it. A
 * disagreement on any of the three, or a licence naming another entity,
 * replaces the button with the count and the reason: a reviewer cannot tick
 * through a disagreement, because there is nothing to tick.
 *
 * **B5.** A rejection is one of four reasons, and a reason the read contradicts
 * is disabled with the note that says so. The one the read makes plain is
 * pre-selected. The reason text is still required — `assertReason` refuses a
 * decision without one, and a decision "composed from a dropdown" is exactly
 * what the queue's actions refuse — but the seller reads both.
 *
 * The server repeats every rule. The disabled states are the rules made visible
 * before they are enforced, not the enforcement.
 */

export interface CredentialDecisionProps {
  credentialId: string;
  decision: DecisionView;
  verify: (formData: FormData) => Promise<ActionResult>;
  requestMore: (formData: FormData) => Promise<ActionResult>;
  reject: (formData: FormData) => Promise<ActionResult>;
}

const MIN_REASON = 4;

export function CredentialDecision({ credentialId, decision, verify, requestMore, reject }: CredentialDecisionProps) {
  const router = useRouter();
  const ids = { reason: useId(), legend: useId() };
  const [reason, setReason] = useState("");
  const [rejectReason, setRejectReason] = useState<string>(
    decision.suggested && decision.reasons.some((option) => option.value === decision.suggested && option.supported)
      ? decision.suggested
      : "",
  );
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = reason.trim().length >= MIN_REASON;
  const rejectable = decision.reasons.some((option) => option.value === rejectReason && option.supported);

  if (!decision.canDecide) {
    return <p className="text-body-sm text-body">{decision.verifyBlocked}</p>;
  }

  function send(action: (formData: FormData) => Promise<ActionResult>) {
    const form = new FormData();
    form.set("credentialId", credentialId);
    form.set("reason", reason);
    form.set("rejectReason", rejectReason);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) {
        setReason("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label
          htmlFor={ids.reason}
          requirement="required"
          requirementLabel={t("field.required")}
          hint={t("admin.credential_review.decision.reason_hint")}
        >
          {t("admin.review.reason_label")}
        </Label>
        <Textarea id={ids.reason} value={reason} rows={2} onChange={(event) => setReason(event.target.value)} />
      </div>

      <RadioGroup legend={t("admin.credential_review.decision.reject_legend")}>
        {decision.reasons.map((option) => (
          <Radio
            key={option.value}
            name="rejectReason"
            value={option.value}
            label={option.label}
            checked={rejectReason === option.value}
            disabled={!option.supported || pending}
            onChange={() => setRejectReason(option.value)}
            {...(option.supported ? {} : { description: t("admin.credential_review.decision.reason_unsupported") })}
          />
        ))}
      </RadioGroup>

      <div className="flex flex-wrap items-center gap-2">
        {decision.canVerify ? (
          <Button disabled={!ready || pending} onClick={() => send(verify)}>
            {t("admin.credential_review.decision.verify")}
          </Button>
        ) : (
          <p className="basis-full text-body-sm text-body">{decision.verifyBlocked}</p>
        )}
        <Button variant="secondary" disabled={!ready || pending} onClick={() => send(requestMore)}>
          {t("admin.credential_review.decision.more_info")}
        </Button>
        <Button variant="secondary" disabled={!ready || !rejectable || pending} onClick={() => send(reject)}>
          {t("admin.credential_review.decision.reject")}
        </Button>
      </div>

      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: t("admin.credential_review.decision.error_fix") })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </div>
  );
}

/** Ask the register again. Evidence only: nothing is decided by pressing it. */
export function RefetchButton({
  credentialId,
  refetch,
}: {
  credentialId: string;
  refetch: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() => {
          const form = new FormData();
          form.set("credentialId", credentialId);
          startTransition(async () => {
            const outcome = await refetch(form);
            setResult(outcome);
            if (outcome.ok) router.refresh();
          });
        }}
      >
        {pending ? t("admin.credential_review.refetching") : t("admin.credential_review.refetch")}
      </Button>
      {result && !result.ok && (
        <span role="alert" className="text-caption text-bad-ink">
          {result.error}
        </span>
      )}
    </span>
  );
}
