"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display/Alert";
import { Button, Input, Select, Toggle } from "@/components/primitives";
import { Panel } from "@/components/structure";
import type { RuleSentences } from "@/lib/buyer-company/words";
import { t } from "@/lib/i18n";
import { saveRuleAction, setFlagAction, type FieldErrors } from "./actions";
import { Field, keep, Outcome } from "./_field";

export type RuleFlagKey = "requirePoNumber" | "requireCostCode" | "unverifiedNeedsApproval" | "tellAdminsOffPlatform";

const FLAG_ORDER: readonly RuleFlagKey[] = [
  "requirePoNumber",
  "requireCostCode",
  "unverifiedNeedsApproval",
  "tellAdminsOffPlatform",
];

const FLAG_KEY: Record<RuleFlagKey, string> = {
  requirePoNumber: "po",
  requireCostCode: "cost_code",
  unverifiedNeedsApproval: "unverified",
  tellAdminsOffPlatform: "off_platform",
};

/**
 * Board `7b` — *Approval rule. One rule, in plain words.*
 *
 * The sentences arrive already rendered from the configured values (`B2`), by
 * the same `ruleSentences` the accept screen and the approval page call — so
 * the card cannot say one thing while the settings under it say another. Every
 * routing rule that can hold a request is among them (`B3`), including *nobody
 * approves their own request*.
 *
 * Two of the board's four toggles were promises; each now names its reach:
 * *Only verified sellers* is the approval gate and nothing else (`B9`), and
 * *Block payment outside platform* — which nothing can do — is *tell the
 * admins*, against the scanner that already exists (`B4`).
 */
export function RuleCard({
  sentences,
  flags,
  editable,
  thresholdAed,
  approverId,
  admins,
}: {
  sentences: RuleSentences;
  flags: Record<RuleFlagKey, boolean>;
  editable: boolean;
  thresholdAed: number | null;
  approverId: string | null;
  admins: readonly { userId: string; name: string }[];
}) {
  const router = useRouter();
  const [state, setState] = useState(flags);
  const [busy, setBusy] = useState<RuleFlagKey | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function toggle(flag: RuleFlagKey, value: boolean) {
    setStatus(null);
    setState((current) => ({ ...current, [flag]: value }));
    setBusy(flag);
    start(async () => {
      const result = await setFlagAction(flag, value);
      setBusy(null);
      if (!result.ok) {
        // The switch moved optimistically; put it back and say why.
        setState((current) => ({ ...current, [flag]: !value }));
        setStatus({ tone: "bad", text: result.error });
      }
      router.refresh();
    });
  }

  function saveRule(form: FormData) {
    setStatus(null);
    start(async () => {
      const result = await saveRuleAction(form);
      if (result.ok) {
        setFields({});
        setStatus({ tone: "ok", text: result.message ?? "" });
        router.refresh();
      } else {
        setFields(result.fields ?? {});
        setStatus({ tone: "bad", text: result.error });
      }
    });
  }

  return (
    <Panel title={t("company.rule.title")} description={t("company.rule.description")}>
      <div className="rounded-card bg-paper-sunk px-4 py-3.5" aria-live="polite">
        <p className="text-body-sm leading-relaxed text-ink">{sentences.lead}</p>
        {sentences.rest.length > 0 ? (
          <ul className="mt-2 space-y-1.5 text-caption leading-relaxed text-body">
            {sentences.rest.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {sentences.gap ? (
        <div className="mt-3">
          <Alert tone="warn" live="off" fix={t("company.rule.gap_fix")}>
            {sentences.gap}
          </Alert>
        </div>
      ) : null}

      {editable ? (
        <form onSubmit={keep(saveRule)} noValidate className="mt-4 grid gap-3">
          <Field
            label={t("company.rule.threshold_label")}
            hint={t("company.rule.threshold_hint")}
            requirement="optional"
            {...(fields.thresholdAed ? { error: fields.thresholdAed } : {})}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="thresholdAed"
                inputMode="numeric"
                suffix="AED"
                defaultValue={thresholdAed === null ? "" : String(thresholdAed)}
                invalid={invalid}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          <Field label={t("company.rule.approver_label")} hint={t("company.rule.approver_hint")}>
            {({ id, describedBy }) => (
              <Select
                id={id}
                name="approverId"
                defaultValue={approverId ?? ""}
                options={[
                  { value: "", label: t("company.rule.approver_any_admin") },
                  ...admins.map((admin) => ({ value: admin.userId, label: admin.name })),
                ]}
                aria-describedby={describedBy}
              />
            )}
          </Field>
          <div>
            <Button type="submit" variant="secondary" size="sm" loading={pending && busy === null}>
              {t("company.rule.save")}
            </Button>
          </div>
        </form>
      ) : null}

      <ul className="mt-4 space-y-3 border-t border-line pt-4">
        {FLAG_ORDER.map((flag) => (
          <li key={flag}>
            <Toggle
              checked={state[flag]}
              onChange={(value) => toggle(flag, value)}
              label={t(`company.flag.${FLAG_KEY[flag]}` as "company.flag.po")}
              description={t(`company.flag.${FLAG_KEY[flag]}_hint` as "company.flag.po_hint")}
              disabled={!editable}
              pending={busy === flag}
            />
          </li>
        ))}
      </ul>

      {!editable ? <p className="mt-3 text-caption text-body">{t("company.rule.admins_only")}</p> : null}

      {status?.text ? (
        <div className="mt-3">
          <Outcome tone={status.tone} text={status.text} />
        </div>
      ) : null}
    </Panel>
  );
}
