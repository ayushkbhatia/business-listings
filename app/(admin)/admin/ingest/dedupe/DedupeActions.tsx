"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import { Button, Input, Label, Textarea } from "@/components/primitives";
import { Modal } from "@/components/structure";
import { CERTAIN_MAX, CERTAIN_MIN, FLOOR_MIN } from "@/lib/dedupe/bands";
import { EN_DASH, formatCount, formatPercent } from "@/lib/format";
import { t } from "@/lib/i18n";
import { ReasonModal } from "../ReasonModal";
import type { ActionResult, PreviewResult } from "./actions";

/**
 * The header's two controls: `Tune matching` and `Bulk merge 1,412`.
 *
 * Bulk merge is one transaction and one audit row, reversible as a unit (B4),
 * and its confirm names the count it will merge. Tune matching changes how many
 * pairs reach the screen, so it previews the queue under the proposed lines
 * before anything can be applied (B8) — and the apply button only accepts the
 * lines that were previewed.
 */

const MIN_REASON = 4;

export interface DedupeActionsProps {
  certain: number;
  bands: { floor: number; certain: number };
  runId: string | null;
  reversibleDays: number;
  bulkLimit: number;
  bulkMerge: (formData: FormData) => Promise<ActionResult>;
  preview: (input: { floor: number; certain: number }) => Promise<PreviewResult>;
  tune: (formData: FormData) => Promise<ActionResult>;
  rescan: () => Promise<ActionResult>;
}

export function DedupeActions({
  certain,
  bands,
  runId,
  reversibleDays,
  bulkLimit,
  bulkMerge,
  preview,
  tune,
  rescan,
}: DedupeActionsProps) {
  const router = useRouter();
  const [open, setOpen] = useState<"bulk" | "tune" | null>(null);
  const [notice, setNotice] = useState<ActionResult | null>(null);
  const count = { count: certain, n: formatCount(certain) };

  function done(result: ActionResult) {
    setOpen(null);
    setNotice(result);
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => setOpen("tune")}>
          {t("admin.dedupe.tune")}
        </Button>
        <Button
          variant="primary"
          disabled={certain === 0}
          onClick={() => {
            setNotice(null);
            setOpen("bulk");
          }}
        >
          {t("admin.dedupe.bulk", { n: formatCount(certain) })}
        </Button>
      </div>

      {notice && (
        <div className="max-w-md">
          <Alert tone={notice.ok ? "ok" : "bad"} live={notice.ok ? "polite" : "assertive"} {...(notice.ok ? {} : { fix: t("admin.dedupe.error.fix") })}>
            {notice.ok ? notice.message : notice.error}
          </Alert>
        </div>
      )}

      <ReasonModal
        open={open === "bulk"}
        onClose={() => setOpen(null)}
        title={t("admin.dedupe.bulk_title", count)}
        description={t("admin.dedupe.bulk_description", {
          certain: formatPercent(bands.certain),
          days: formatCount(reversibleDays),
        })}
        confirmLabel={t("admin.dedupe.bulk_confirm", {
          count: Math.min(certain, bulkLimit),
          n: formatCount(Math.min(certain, bulkLimit)),
        })}
        fields={runId ? { runId } : {}}
        reasonHint={t("admin.dedupe.reason_hint_decision")}
        action={bulkMerge}
        onDone={done}
      >
        <div className="flex flex-col gap-2 text-body-sm text-body">
          <p>{t("admin.dedupe.bulk_what")}</p>
          <p>{t("admin.dedupe.bulk_owner")}</p>
          {certain > bulkLimit && (
            <p className="text-warn-ink">{t("admin.dedupe.bulk_limit", { limit: formatCount(bulkLimit) })}</p>
          )}
        </div>
      </ReasonModal>

      {open === "tune" && (
        <TuneMatching
          bands={bands}
          onClose={() => setOpen(null)}
          preview={preview}
          tune={tune}
          rescan={rescan}
          onDone={done}
        />
      )}
    </div>
  );
}

function TuneMatching({
  bands,
  onClose,
  preview,
  tune,
  rescan,
  onDone,
}: {
  bands: { floor: number; certain: number };
  onClose: () => void;
  preview: DedupeActionsProps["preview"];
  tune: DedupeActionsProps["tune"];
  rescan: DedupeActionsProps["rescan"];
  onDone: (result: ActionResult) => void;
}) {
  const ids = { floor: useId(), certain: useId(), reason: useId(), caption: useId() };
  const [floor, setFloor] = useState(String(Math.round(bands.floor * 100)));
  const [certainLine, setCertainLine] = useState(String(Math.round(bands.certain * 100)));
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [previewed, setPreviewed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanNotice, setScanNotice] = useState<ActionResult | null>(null);
  const [previewing, startPreview] = useTransition();
  const [applying, startApply] = useTransition();
  const [scanning, startScan] = useTransition();

  const proposed = { floor: Number(floor) / 100, certain: Number(certainLine) / 100 };
  const key = `${floor}|${certainLine}`;
  const stale = result?.ok === true && previewed !== key;
  const busy = previewing || applying || scanning;

  function runPreview() {
    setError(null);
    startPreview(async () => {
      const next = await preview(proposed);
      setResult(next);
      setPreviewed(key);
    });
  }

  function apply() {
    const form = new FormData();
    form.set("floor", String(proposed.floor));
    form.set("certain", String(proposed.certain));
    form.set("reason", reason);
    startApply(async () => {
      const outcome = await tune(form);
      if (outcome.ok) onDone(outcome);
      else setError(outcome.error);
    });
  }

  function runRescan() {
    startScan(async () => {
      setScanNotice(await rescan());
    });
  }

  const canApply = result?.ok === true && !stale && reason.trim().length >= MIN_REASON && !busy;

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={t("admin.dedupe.tune_title")}
      description={t("admin.dedupe.tune_description")}
      closeLabel={t("action.cancel")}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("action.cancel")}
          </Button>
          <Button loading={applying} disabled={!canApply} onClick={apply}>
            {t("admin.dedupe.tune_apply")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.floor} hint={t("admin.dedupe.tune_floor_hint", { min: formatPercent(FLOOR_MIN) })}>
              {t("admin.dedupe.tune_floor")}
            </Label>
            <Input
              id={ids.floor}
              type="number"
              inputMode="numeric"
              min={Math.round(FLOOR_MIN * 100)}
              max={Math.round(CERTAIN_MAX * 100) - 5}
              step={1}
              suffix="%"
              value={floor}
              onChange={(event) => setFloor(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.certain} hint={t("admin.dedupe.tune_certain_hint", { min: formatPercent(CERTAIN_MIN) })}>
              {t("admin.dedupe.tune_certain")}
            </Label>
            <Input
              id={ids.certain}
              type="number"
              inputMode="numeric"
              min={Math.round(CERTAIN_MIN * 100)}
              max={Math.round(CERTAIN_MAX * 100)}
              step={1}
              suffix="%"
              value={certainLine}
              onChange={(event) => setCertainLine(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" loading={previewing} disabled={busy} onClick={runPreview}>
            {t("admin.dedupe.tune_preview")}
          </Button>
          {previewing && (
            <span className="text-caption text-muted" aria-live="polite">
              {t("admin.dedupe.tune_previewing")}
            </span>
          )}
        </div>

        {result && !result.ok && (
          <Alert tone="bad" live="assertive" fix={t("admin.dedupe.tune_floor_hint", { min: formatPercent(FLOOR_MIN) })}>
            {result.error}
          </Alert>
        )}

        {result?.ok && (
          <div className="flex flex-col gap-2" aria-live="polite">
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full text-body-sm">
                <caption id={ids.caption} className="sr-only">
                  {t("admin.dedupe.tune_caption")}
                </caption>
                <thead className="bg-paper-sunk">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-start font-mono text-eyebrow uppercase text-muted">
                      {t("admin.dedupe.tune_col.band")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-end font-mono text-eyebrow uppercase text-muted">
                      {t("admin.dedupe.tune_col.now", { range: `${formatPercent(result.current.floor)}${EN_DASH}${formatPercent(result.current.certain)}` })}
                    </th>
                    <th scope="col" className="px-3 py-2 text-end font-mono text-eyebrow uppercase text-muted">
                      {t("admin.dedupe.tune_col.after", { range: `${formatPercent(result.proposed.floor)}${EN_DASH}${formatPercent(result.proposed.certain)}` })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <PreviewRow label={t("admin.dedupe.tune_row.certain")} now={result.now.certain} after={result.after.certain} />
                  <PreviewRow label={t("admin.dedupe.tune_row.probable")} now={result.now.probable} after={result.after.probable} />
                  <PreviewRow label={t("admin.dedupe.tune_row.withdrawn")} now={0} after={result.after.withdrawn} />
                  <PreviewRow label={t("admin.dedupe.tune_row.new_records")} now={0} after={result.after.newRecordPairs} />
                  <PreviewRow label={t("admin.dedupe.tune_row.new_listings")} now={0} after={result.after.newListingPairs} />
                </tbody>
              </table>
            </div>
            {stale && (
              <Alert tone="warn" fix={t("admin.dedupe.tune_preview")}>
                {t("admin.dedupe.tune_stale")}
              </Alert>
            )}
          </div>
        )}

        {result?.ok && (
          <div className="flex flex-col gap-1">
            <Label
              htmlFor={ids.reason}
              requirement="required"
              requirementLabel={t("field.required")}
              hint={t("admin.dedupe.reason_hint_decision")}
            >
              {t("admin.review.reason_label")}
            </Label>
            <Textarea id={ids.reason} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
        )}

        {error && (
          <Alert tone="bad" live="assertive" fix={t("admin.dedupe.reason_hint_decision")}>
            {error}
          </Alert>
        )}

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-prose text-caption text-muted">{t("admin.dedupe.rescan_help")}</p>
            <Button variant="secondary" size="sm" loading={scanning} disabled={busy} onClick={runRescan}>
              {t("admin.dedupe.rescan")}
            </Button>
          </div>
          {scanNotice && (
            <Alert
              tone={scanNotice.ok ? "ok" : "bad"}
              live={scanNotice.ok ? "polite" : "assertive"}
              {...(scanNotice.ok ? {} : { fix: t("admin.dedupe.error.fix") })}
            >
              {scanNotice.ok ? scanNotice.message : scanNotice.error}
            </Alert>
          )}
        </div>
      </div>
    </Modal>
  );
}

function PreviewRow({ label, now, after }: { label: string; now: number; after: number }) {
  return (
    <tr className="border-t border-line">
      <th scope="row" className="px-3 py-2 text-start font-normal text-ink">
        {label}
      </th>
      <td className="px-3 py-2 text-end font-mono tabular-nums text-muted">{formatCount(now)}</td>
      <td className="px-3 py-2 text-end font-mono tabular-nums text-ink">{formatCount(after)}</td>
    </tr>
  );
}
