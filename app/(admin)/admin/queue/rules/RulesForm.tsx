"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import { Button, Input, Label, Textarea, Toggle } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { formatCount, formatPercent } from "@/lib/format";
import { t } from "@/lib/i18n";
import { EXPIRY_WARN_MAX, EXPIRY_WARN_MIN, QUEUE_KINDS, RULES, type CheckRules, type QueueKind } from "@/lib/moderation/rules";
import type { ApplyResult, PreviewResult, RulesInput } from "./actions";

/**
 * Board 4b — `Tune auto-check rules`.
 *
 * *"Rule re-tuned: eligibility re-derived; the 62% figure and the bulk set both
 * move."* So the form never applies what it has not previewed: the preview runs
 * the real checks against the real queue under the proposed rules and states
 * the pass rate and the bulk set now and after, per kind. Change anything after
 * previewing and Apply waits for another preview.
 *
 * Two rules have no switch — a claim on a closing business, and two claims on
 * one listing — and the form says why rather than rendering a disabled toggle
 * with nothing beside it.
 */

const MIN_REASON = 4;

export interface RulesFormProps {
  rules: CheckRules;
  preview: (input: RulesInput) => Promise<PreviewResult>;
  apply: (input: RulesInput & { reason: string }) => Promise<ApplyResult>;
}

export function RulesForm({ rules, preview, apply }: RulesFormProps) {
  const router = useRouter();
  const ids = { expiry: useId(), scan: useId(), name: useId(), terms: useId(), reason: useId() };
  const [disabled, setDisabled] = useState<string[]>(rules.disabled);
  const [expiry, setExpiry] = useState(String(rules.expiryWarnDays));
  const [scan, setScan] = useState(String(Math.round(rules.scanConfidenceFloor * 100)));
  const [name, setName] = useState(String(Math.round(rules.nameSimilarityFloor * 100)));
  const [terms, setTerms] = useState(rules.bannedTerms.join("\n"));
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<ApplyResult | null>(null);
  const [previewing, startPreview] = useTransition();
  const [applying, startApply] = useTransition();

  const input: RulesInput = {
    disabled,
    expiryWarnDays: Number(expiry),
    scanConfidencePercent: Number(scan),
    nameSimilarityPercent: Number(name),
    bannedTerms: terms,
  };
  const key = JSON.stringify(input);
  const stale = result?.ok === true && previewedKey !== key;

  function runPreview() {
    setNotice(null);
    startPreview(async () => {
      setResult(await preview(input));
      setPreviewedKey(key);
    });
  }

  function runApply() {
    startApply(async () => {
      const outcome = await apply({ ...input, reason });
      setNotice(outcome);
      if (outcome.ok) {
        setReason("");
        setResult(null);
        router.refresh();
      }
    });
  }

  const canApply = result?.ok === true && !stale && reason.trim().length >= MIN_REASON && !applying && !previewing;

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      {QUEUE_KINDS.map((kind) => {
        const kindRules = RULES.filter((rule) => rule.kinds[0] === kind);
        if (kindRules.length === 0) return null;
        return (
          <Panel key={kind} title={t(`admin.queue_rules.kind.${kind}`)}>
            <ul className="flex flex-col divide-y divide-line">
              {kindRules.map((rule) => (
                <li key={rule.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 max-w-prose">
                    <p className="text-body-sm text-ink">{t(`admin.queue_rules.rule.${rule.id}.name`)}</p>
                    <p className="mt-0.5 text-caption text-muted">{t(`admin.queue_rules.rule.${rule.id}.body`)}</p>
                  </div>
                  {rule.switchable ? (
                    <Toggle
                      checked={!disabled.includes(rule.id)}
                      onChange={(on) => setDisabled((current) => (on ? current.filter((id) => id !== rule.id) : [...current, rule.id]))}
                      label={t("admin.queue_rules.run", { rule: t(`admin.queue_rules.rule.${rule.id}.name`) })}
                      hideLabel
                    />
                  ) : (
                    <span className="text-caption text-muted">{t("admin.queue_rules.always_on")}</span>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        );
      })}

      <Panel title={t("admin.queue_rules.thresholds")}>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.expiry} hint={t("admin.queue_rules.expiry_hint", { min: EXPIRY_WARN_MIN, max: EXPIRY_WARN_MAX })}>
              {t("admin.queue_rules.expiry")}
            </Label>
            <Input id={ids.expiry} type="number" inputMode="numeric" min={EXPIRY_WARN_MIN} max={EXPIRY_WARN_MAX} suffix={t("admin.queue_rules.days_unit")} value={expiry} onChange={(event) => setExpiry(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.scan} hint={t("admin.queue_rules.scan_hint")}>
              {t("admin.queue_rules.scan")}
            </Label>
            <Input id={ids.scan} type="number" inputMode="numeric" min={0} max={100} suffix="%" value={scan} onChange={(event) => setScan(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.name} hint={t("admin.queue_rules.name_hint")}>
              {t("admin.queue_rules.name")}
            </Label>
            <Input id={ids.name} type="number" inputMode="numeric" min={0} max={100} suffix="%" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-1">
          <Label htmlFor={ids.terms} hint={t("admin.queue_rules.terms_hint")}>
            {t("admin.queue_rules.terms")}
          </Label>
          <Textarea id={ids.terms} rows={4} value={terms} onChange={(event) => setTerms(event.target.value)} />
        </div>
      </Panel>

      <Panel title={t("admin.queue_rules.preview_title")} description={t("admin.queue_rules.preview_description")}>
        <div className="flex flex-col gap-4">
          <div>
            <Button variant="secondary" loading={previewing} disabled={previewing || applying} onClick={runPreview}>
              {t("admin.queue_rules.preview")}
            </Button>
          </div>

          {result && !result.ok && (
            <Alert tone="bad" live="assertive" fix={t("admin.queue_rules.fix")}>
              {result.error}
            </Alert>
          )}

          {result?.ok && (
            <div className="flex flex-col gap-3" aria-live="polite">
              <p className="text-body-sm text-body">
                {t("admin.queue_rules.summary", {
                  now: formatPercent(result.now.total === 0 ? 0 : result.now.passing / result.now.total),
                  after: formatPercent(result.after.total === 0 ? 0 : result.after.passing / result.after.total),
                })}{" "}
                {t("admin.queue_rules.summary_gain", { count: result.becomeEligible, n: formatCount(result.becomeEligible) })}{" "}
                {t("admin.queue_rules.summary_loss", { count: result.becomeIneligible, n: formatCount(result.becomeIneligible) })}
              </p>
              <div className="overflow-x-auto rounded-card border border-line">
                <table className="w-full text-body-sm">
                  <caption className="sr-only">{t("admin.queue_rules.caption")}</caption>
                  <thead className="bg-paper-sunk">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-start font-mono text-eyebrow uppercase text-muted">
                        {t("admin.queue_rules.col.kind")}
                      </th>
                      <th scope="col" className="px-3 py-2 text-end font-mono text-eyebrow uppercase text-muted">
                        {t("admin.queue_rules.col.now")}
                      </th>
                      <th scope="col" className="px-3 py-2 text-end font-mono text-eyebrow uppercase text-muted">
                        {t("admin.queue_rules.col.after")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <PreviewRow label={t("admin.queue_rules.row.all")} now={result.now} after={result.after} />
                    {QUEUE_KINDS.filter((kind) => result.now.byKind[kind].total > 0).map((kind: QueueKind) => (
                      <PreviewRow
                        key={kind}
                        label={t(`admin.queue.type.${kind}`)}
                        now={result.now.byKind[kind]}
                        after={result.after.byKind[kind]}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {stale && (
                <Alert tone="warn" fix={t("admin.queue_rules.preview")}>
                  {t("admin.queue_rules.stale")}
                </Alert>
              )}
            </div>
          )}

          {result?.ok && (
            <div className="flex flex-col gap-1">
              <Label htmlFor={ids.reason} requirement="required" requirementLabel={t("field.required")} hint={t("admin.queue.dialog.reason_hint")}>
                {t("admin.review.reason_label")}
              </Label>
              <Textarea id={ids.reason} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button loading={applying} disabled={!canApply} onClick={runApply}>
              {t("admin.queue_rules.apply")}
            </Button>
            {!result?.ok && <span className="text-caption text-muted">{t("admin.queue_rules.apply_hint")}</span>}
          </div>

          {notice && (
            <Alert tone={notice.ok ? "ok" : "bad"} live={notice.ok ? "polite" : "assertive"} {...(notice.ok ? {} : { fix: t("admin.queue_rules.fix") })}>
              {notice.ok ? notice.message : notice.error}
            </Alert>
          )}
        </div>
      </Panel>
    </div>
  );
}

function PreviewRow({
  label,
  now,
  after,
}: {
  label: string;
  now: { total: number; passing: number };
  after: { total: number; passing: number };
}) {
  const cell = (figures: { total: number; passing: number }) =>
    t("admin.queue_rules.cell", { passing: formatCount(figures.passing), total: formatCount(figures.total) });
  return (
    <tr className="border-t border-line">
      <th scope="row" className="px-3 py-2 text-start font-normal text-ink">
        {label}
      </th>
      <td className="px-3 py-2 text-end font-mono tabular-nums text-muted">{cell(now)}</td>
      <td className="px-3 py-2 text-end font-mono tabular-nums text-ink">{cell(after)}</td>
    </tr>
  );
}
