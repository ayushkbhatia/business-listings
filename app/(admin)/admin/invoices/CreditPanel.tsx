"use client";

import { useState, useTransition } from "react";
import { Button, Input, Label, Select, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 12e — issuing a subscription credit.
 *
 * `issueSubscriptionCredit` was written, audited and tested, and no screen
 * called it: when the platform overcharged a seller there was no way to put it
 * right except in the database.
 *
 * Two fields that look alike and are not. **What it is for** prints on the
 * invoice in the seller's language. **Why** goes on the audit row in ours. A
 * seller reads the first and never the second.
 *
 * The amount is asked for in dirhams and sent in fils. The service takes whole
 * fils and guards a ceiling, which is exactly where a hundred-fold mistake
 * would land — so the conversion happens once, here, and the field says which
 * unit it wants.
 */

export interface CreditableBusiness {
  id: string;
  name: string;
}

const MIN_REASON = 4;

export interface CreditPanelProps {
  businesses: readonly CreditableBusiness[];
  issueCredit: (formData: FormData) => Promise<ActionResult>;
}

export function CreditPanel({ businesses, issueCredit }: CreditPanelProps) {
  const [businessId, setBusinessId] = useState("");
  const [dirhams, setDirhams] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const amount = Number(dirhams);
  const ready =
    businessId !== "" &&
    Number.isFinite(amount) &&
    amount > 0 &&
    description.trim().length > 0 &&
    reason.trim().length >= MIN_REASON &&
    !pending;

  function submit() {
    const form = new FormData();
    form.set("businessId", businessId);
    // Whole fils, rounded here so the service never sees a fraction of one.
    form.set("fils", String(Math.round(amount * 100)));
    form.set("description", description);
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await issueCredit(form);
      setResult(outcome);
      if (outcome.ok) {
        setDirhams("");
        setDescription("");
        setReason("");
      }
    });
  }

  return (
    <Panel title={t("admin.invoices.credit_title")}>
      <div className="flex flex-col gap-4">
        <p className="max-w-prose text-caption text-muted">{t("admin.invoices.credit_help")}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="credit-business" requirement="required">
              {t("admin.invoices.credit_business")}
            </Label>
            <Select
              id="credit-business"
              value={businessId}
              onChange={(event) => setBusinessId(event.target.value)}
              options={[
                { value: "", label: t("admin.invoices.credit_pick") },
                ...businesses.map((business) => ({ value: business.id, label: business.name })),
              ]}
            />
          </div>

          <div>
            <Label htmlFor="credit-amount" requirement="required">
              {t("admin.invoices.credit_amount")}
            </Label>
            <Input
              id="credit-amount"
              inputMode="decimal"
              value={dirhams}
              onChange={(event) => setDirhams(event.target.value)}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="credit-description" requirement="required">
            {t("admin.invoices.credit_description")}
          </Label>
          <Input
            id="credit-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <p className="mt-1 text-caption text-muted">
            {t("admin.invoices.credit_description_hint")}
          </p>
        </div>

        <div>
          <Label htmlFor="credit-reason" requirement="required">
            {t("admin.review.reason_label")}
          </Label>
          <Textarea
            id="credit-reason"
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="mt-1 text-caption text-muted">{t("admin.invoices.credit_reason_hint")}</p>
        </div>

        <div>
          <Button disabled={!ready} onClick={submit}>
            {t("admin.invoices.credit_issue")}
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
    </Panel>
  );
}
