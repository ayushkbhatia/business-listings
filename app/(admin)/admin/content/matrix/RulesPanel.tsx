"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Input, Label, Textarea, Toggle } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult, PreviewResult } from "./actions";

/**
 * Board 6f §5 — six numbers, an impact preview and a second approver.
 *
 * The board offered five bare inputs with no confirmation, no preview and no
 * record. Every one of them republishes the site: lowering the absolute floor
 * from 60 to 40 publishes several hundred pages in one keystroke, and raising
 * it unpublishes pages that currently rank.
 *
 * So there is no save button. There is a preview, which writes nothing and
 * enumerates the pages that would come down; a propose, which freezes that
 * preview onto a row; and an approve, which only somebody else can press. The
 * enforcement is in the service and in a database CHECK — this is where a
 * person is told which of those they are about to run into, before they run
 * into it.
 */

export interface RuleValues {
  publishThreshold: number;
  demandPerThousand: number;
  verifiedShareMin: number;
  minIntroWords: number;
  holdShare: number;
  minLiveDays: number;
  humanReviewRequired: boolean;
}

export interface PendingChange {
  id: string;
  after: RuleValues;
  impact: { publishes: number; unpublishes: number; queuedForCopy: number };
  countedAt: string;
  proposedBy: string;
  proposedOn: string;
  reason: string;
  /** Whether the seat reading this is the one who proposed it. */
  mine: boolean;
}

export interface RulesPanelProps {
  categoryId: string;
  categoryName: string;
  values: RuleValues;
  pending: PendingChange | null;
  /** §5.5 — last-edited attribution, on the panel. */
  lastEdited: { date: string; who: string; approver: string } | null;
  preview: (formData: FormData) => Promise<PreviewResult>;
  propose: (formData: FormData) => Promise<ActionResult>;
  approve: (formData: FormData) => Promise<ActionResult>;
  close: (formData: FormData) => Promise<ActionResult>;
}

/*
   `step="any"` on the two fractions, and it is not cosmetic.

   `step` is a constraint the browser enforces before a form submits, measured
   from `min` — so `min="0.01" step="0.05"` made 0.8, the shipped default, an
   invalid value. The panel loaded with it in the box, every submit was blocked
   by constraint validation, and because the message belongs to a field nobody
   had touched there was nothing on screen to explain why the button did
   nothing. Found by clicking it.

   The real bounds are enforced twice regardless: `validate()` in the service
   refuses anything outside them, and a CHECK constraint refuses it again.
*/
const NUMERIC = [
  { key: "publishThreshold", step: "1", min: "1", max: "5000" },
  { key: "demandPerThousand", step: "1", min: "0", max: "5000" },
  { key: "verifiedShareMin", step: "any", min: "0", max: "1" },
  { key: "minIntroWords", step: "1", min: "0", max: "5000" },
  { key: "holdShare", step: "any", min: "0.01", max: "1" },
  { key: "minLiveDays", step: "1", min: "0", max: "365" },
] as const;

export function RulesPanel(props: RulesPanelProps) {
  const [impact, setImpact] = useState<
    (PreviewResult & { ok: true })["impact"] | null
  >(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState(props.values.humanReviewRequired);
  const [pending, startTransition] = useTransition();

  /**
   * The form's fields **and the button that submitted it**.
   *
   * `new FormData(form)` leaves the submitter's own name and value out — which
   * is correct per the spec and was silently wrong here: the decision form
   * reads `decision`, found nothing, and ran the reject branch when somebody
   * pressed Approve. It applied no rule change, so nothing was lost; it also
   * told the second approver they had rejected a proposal they had just
   * approved. Found by pressing the button.
   */
  function form(event: React.FormEvent<HTMLFormElement>): FormData {
    return new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
  }

  const proposal = props.pending;

  return (
    /*
       The trade is in the description, not only in the eyebrow.

       With no filter the matrix shows every trade and this panel opens on the
       first sector — so a reader looking at HVAC rows could change Valves &
       fittings' floor without noticing which trade the form belonged to. A
       9.5px mono eyebrow is not enough to carry that.
    */
    <Panel
      title={t("rules.title")}
      description={t("rules.subtitle", { trade: props.categoryName })}
      eyebrow={props.categoryName}
    >
      {proposal && (
        <div className="mb-[var(--gutter)] rounded-card border border-line bg-card p-3.5">
          <p className="text-body-sm text-ink">{t("rules.pending")}</p>
          <p className="mt-1 text-caption text-muted">
            {t("rules.pending_by", {
              who: proposal.proposedBy,
              date: proposal.proposedOn,
              reason: proposal.reason,
            })}
          </p>
          {/*
             Both sets, side by side. §States: "the panel shows the proposed
             values alongside the live ones and the matrix keeps computing on
             the live ones" — so the inputs below stay on the live values and
             this block is the only place the proposal appears.
          */}
          <table className="mt-3 w-full">
            <caption className="sr-only">{t("rules.pending")}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left font-mono text-eyebrow uppercase text-muted">
                  {t("rules.col.rule")}
                </th>
                <th scope="col" className="text-right font-mono text-eyebrow uppercase text-muted">
                  {t("rules.col.live")}
                </th>
                <th scope="col" className="text-right font-mono text-eyebrow uppercase text-muted">
                  {t("rules.col.proposed")}
                </th>
              </tr>
            </thead>
            <tbody>
              {NUMERIC.map((field) => (
                <tr key={field.key}>
                  <th scope="row" className="py-1 text-left text-caption font-normal text-body">
                    {t(`rules.${field.key}` as never)}
                  </th>
                  <td className="py-1 text-right text-caption tabular-nums text-muted">
                    {String(props.values[field.key])}
                  </td>
                  <td className="py-1 text-right text-caption tabular-nums text-ink">
                    {String(proposal.after[field.key])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-caption text-muted">
            {t("rules.impact", {
              publishes: String(proposal.impact.publishes),
              unpublishes: String(proposal.impact.unpublishes),
              queued: String(proposal.impact.queuedForCopy),
            })}
          </p>
          <p className="mt-1 text-caption text-muted">
            {t("rules.pending_counted", { date: proposal.countedAt })}
          </p>
          <p className="mt-1 text-caption text-muted">{t("rules.pending_live")}</p>

          <form
            className="mt-3 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const data = form(event);
              const action = String(data.get("decision")) === "approve" ? props.approve : props.close;
              startTransition(async () => setResult(await action(data)));
            }}
          >
            <input type="hidden" name="changeId" value={proposal.id} />
            <Label
              htmlFor="decide-reason"
              requirement="required"
              requirementLabel={t("field.required")}
            >
              {t("rules.reason")}
            </Label>
            <Textarea id="decide-reason" name="reason" rows={2} required />
            <div className="flex flex-wrap gap-2">
              {/*
                 Absent for the proposer, and the sentence says why rather than
                 leaving a disabled button to explain itself. The service
                 refuses this and so does a CHECK constraint; a button that
                 looks live and then refuses is worse than one that is not there.
              */}
              {!proposal.mine && (
                <Button type="submit" name="decision" value="approve" disabled={pending}>
                  {t("rules.approve")}
                </Button>
              )}
              <Button type="submit" name="decision" value="close" variant="ghost" disabled={pending}>
                {proposal.mine ? t("rules.withdraw") : t("rules.reject")}
              </Button>
            </div>
            {proposal.mine && (
              <p className="text-caption text-muted">{t("rules.second_approver")}</p>
            )}
          </form>
        </div>
      )}

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const data = form(event);
          if (String(data.get("intent")) === "propose") {
            startTransition(async () => {
              const outcome = await props.propose(data);
              setResult(outcome);
              if (outcome.ok) setImpact(null);
            });
            return;
          }
          startTransition(async () => {
            const outcome = await props.preview(data);
            if (outcome.ok) {
              setImpact(outcome.impact);
              setError(null);
            } else {
              setImpact(null);
              setError(outcome.error);
            }
          });
        }}
      >
        <input type="hidden" name="categoryId" value={props.categoryId} />

        <div className="grid grid-cols-2 gap-3">
          {NUMERIC.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <Label htmlFor={`rule-${field.key}`}>{t(`rules.${field.key}` as never)}</Label>
              <Input
                id={`rule-${field.key}`}
                name={field.key}
                type="number"
                step={field.step}
                min={field.min}
                max={field.max}
                defaultValue={String(props.values[field.key])}
              />
            </div>
          ))}
        </div>

        {/*
           A controlled toggle plus a hidden field, because `Toggle` is a
           button and a button carries no value into a FormData.
        */}
        <Toggle
          checked={review}
          onChange={setReview}
          label={t("rules.humanReviewRequired")}
          disabled={pending}
        />
        <input type="hidden" name="humanReviewRequired" value={String(review)} />

        <Label htmlFor="rule-reason" requirement="required" requirementLabel={t("field.required")}>
          {t("rules.reason")}
        </Label>
        <Textarea id="rule-reason" name="reason" rows={2} />

        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="intent" value="preview" variant="secondary" disabled={pending}>
            {t("rules.preview")}
          </Button>
          <Button type="submit" name="intent" value="propose" disabled={pending || impact === null}>
            {t("rules.propose")}
          </Button>
        </div>

        {error && (
          <Alert tone="bad" live="assertive">
            {error}
          </Alert>
        )}

        {impact && (
          <div className="rounded-card border border-line bg-card p-3.5">
            <p className="text-body-sm text-ink">
              {impact.publishes + impact.unpublishes + impact.queuedForCopy === 0
                ? t("rules.impact_none")
                : t("rules.impact", {
                    publishes: String(impact.publishes),
                    unpublishes: String(impact.unpublishes),
                    queued: String(impact.queuedForCopy),
                  })}
            </p>
            {/*
               Enumerated, not counted. §5.1 asks for the unpublish list by
               name: a count tells an approver the size of the change and the
               list tells them whether the three pages about to go dark are
               three nobody reads or the three that carry the section.
            */}
            {impact.unpublishing.length > 0 && (
              <>
                <p className="mt-2 font-mono text-eyebrow uppercase text-muted">
                  {t("rules.unpublishing")}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {impact.unpublishing.map((row) => (
                    <li key={row.path} className="font-mono text-caption text-ink">
                      {row.path} — {row.listings}/{row.need}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {impact.publishing.length > 0 && (
              <>
                <p className="mt-2 font-mono text-eyebrow uppercase text-muted">
                  {t("rules.publishing")}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {impact.publishing.map((row) => (
                    <li key={row.path} className="font-mono text-caption text-ink">
                      {row.path} — {row.listings}/{row.need}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </form>

      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <p className="mt-[var(--gutter)] text-caption text-muted">
        {props.lastEdited
          ? t("rules.last_edited", {
              date: props.lastEdited.date,
              who: props.lastEdited.who,
              approver: props.lastEdited.approver,
            })
          : t("rules.never_edited")}
      </p>
      <p className="mt-1 text-caption text-muted">{t("rules.second_approver")}</p>
    </Panel>
  );
}
