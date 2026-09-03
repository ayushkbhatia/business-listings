"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Button, IconButton, Input, Select, Textarea } from "@/components/primitives";
import { Close } from "@/components/primitives/icons";
import { StatusBadge } from "@/components/display/StatusBadge";

/**
 * EnquiryComposer — tier 4, buyer side.
 *
 * The README: "Free text, matched lines, quantities, target price (optional),
 * delivery area, needed-by, terms wanted, attachments, and the fan-out
 * recipient picker with its 'also send to N similar suppliers' default."
 *
 * One component, two shapes, because they are the same form and the difference
 * is only how much of it is on screen at once:
 *
 *   `single`  one seller, one page — the composer on a storefront, where the
 *             buyer already knows who they are writing to.
 *   `wizard`  board 1h's three steps, ending in the recipient picker.
 *
 * They share state, so a buyer who starts on a storefront and widens to a
 * fan-out does not retype anything.
 *
 * Every string arrives already translated. This component never calls t().
 */

export interface EnquiryLineDraft {
  key: string;
  /**
   * The product this line came from, where it came from one.
   *
   * The tray already had it — it was the React key — and threw it away on the
   * way to the server, so `EnquiryLine` recorded a description and no id. That
   * is why "auto-pick most-enquired" on the featured-products section had
   * nothing to rank on and could not be backfilled.
   */
  productId?: string | null;
  description: string;
  qty: number;
  unit: string;
  size: string;
  targetUnitPriceAed: string;
}

export interface RecipientPreview {
  businessId: string;
  displayName: string;
  areaName: string | null;
  verificationTier: number;
  /** Already localised: "Typically replies in 2 h", or the unmeasured line. */
  responseLabel: string;
  /** True for the storefront the buyer came from. Always included. */
  pinned?: boolean;
}

export interface EnquiryComposerValue {
  requirement: string;
  lines: { description: string; qty: number; unit: string | null; size: string | null; targetUnitPriceAed: string | null; productId: string | null }[];
  emirate: string | null;
  deliverToArea: string | null;
  neededBy: string | null;
  termsWanted: string | null;
  closesInDays: number;
  fanoutTo: number;
  contactPhone: string;
  contactName: string;
}

export interface EnquiryComposerLabels {
  formLabel: string;
  steps: readonly string[];
  /** Receives a 1-based step number, as StepHeader hands it over. */
  stepOf: (current: number, total: number) => string;

  requirement: string;
  requirementHint: string;
  requirementPlaceholder: string;

  lines: string;
  linesHint: string;
  lineDescription: (n: number) => string;
  lineQty: (n: number) => string;
  lineUnit: (n: number) => string;
  lineSize: (n: number) => string;
  lineTarget: (n: number) => string;
  lineTargetHint: string;
  colDescription: string;
  colQty: string;
  colUnit: string;
  colSize: string;
  colTarget: string;
  addLine: string;
  removeLine: (n: number) => string;

  area: string;
  areaHint: string;
  emirate: string;
  emirateOptions: readonly { value: string; label: string }[];
  neededBy: string;
  neededByHint: string;
  terms: string;
  termsHint: string;
  termsOptions: readonly { value: string; label: string }[];
  closes: string;
  closesHint: string;
  closesOptions: readonly { value: string; label: string }[];

  recipients: string;
  recipientsHint: string;
  fanout: (count: number) => string;
  fanoutLabel: string;
  fanoutNote: string;
  pinned: string;
  recipientsPreview: (count: number) => string;
  recipientsNone: string;
  privacy: string;

  contact: string;
  contactHint: string;
  contactName: string;
  contactNameHint: string;

  back: string;
  next: string;
  submit: string;
  sending: string;

  errorRequirement: string;
  errorLines: string;
  errorContact: string;
}

export interface EnquiryComposerProps {
  /**
   * `single`  Composer A — the inline card on 1d and 1g. Everything stacked,
   *           its own lines editor, its own submit.
   * `panel`   Composer B's requirement half, mounted inside `/rfq/new`
   *           alongside a lines table and a recipient picker the page owns.
   *
   * There was a third, `wizard`, which navigated between three steps and showed
   * one at a time. Board 1h's composer model removed it in as many words: "the
   * stepper reflects completion, not navigation", "all three steps live on one
   * route and the page never reloads", and "steps never gate backwards". A
   * component that hid two thirds of the form could honour none of those, and
   * the page owns the progress statement now.
   */
  shape: "single" | "panel";
  labels: EnquiryComposerLabels;
  initialLines?: readonly EnquiryLineDraft[];
  initialRequirement?: string;
  /** Shown in the wizard's third step. Recomputed by the caller as the count changes. */
  recipients?: readonly RecipientPreview[];
  /** Hidden entirely when the buyer is signed in. */
  askForContact?: boolean;
  maxFanout?: number;
  defaultFanout?: number;
  onSubmit?: (value: EnquiryComposerValue) => void | Promise<void>;
  /** Fired when the fan-out count changes, so the caller can re-query the preview. */
  onFanoutChange?: (count: number) => void;
  busy?: boolean;
  error?: string;
  /**
   * `panel` only: fired on every change so the page can mirror the value.
   * The page owns Send, the lines and the recipients, so it needs the
   * requirement fields as they are typed rather than at submit.
   */
  onChange?: (value: EnquiryComposerValue) => void;
  /**
   * `panel` only: board 1h's step 1. The fields render so a buyer can see what
   * is coming, and refuse input so they cannot fill them out of order. Dimmed
   * rather than hidden, and `disabled` rather than `readonly`, so the state
   * reaches a screen reader as well as the eye.
   */
  disabled?: boolean;
}

let seq = 0;
const blankLine = (): EnquiryLineDraft => ({
  key: `line-${(seq += 1)}`,
  description: "",
  qty: 1,
  unit: "pcs",
  size: "",
  targetUnitPriceAed: "",
});

export function EnquiryComposer({
  shape,
  labels,
  initialLines,
  initialRequirement = "",
  recipients = [],
  askForContact = true,
  maxFanout = 8,
  defaultFanout = 5,
  onSubmit,
  onFanoutChange,
  busy = false,
  error,
  onChange,
  disabled = false,
}: EnquiryComposerProps) {
  const formId = useId();
  const [requirement, setRequirement] = useState(initialRequirement);
  const [lines, setLines] = useState<EnquiryLineDraft[]>(() =>
    initialLines && initialLines.length > 0 ? [...initialLines] : [blankLine()],
  );
  const [emirate, setEmirate] = useState("");
  const [area, setArea] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [terms, setTerms] = useState("");
  const [closesInDays, setClosesInDays] = useState("7");
  const [fanoutTo, setFanoutTo] = useState(shape === "single" ? 1 : defaultFanout);
  const [contactPhone, setContactPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  /*
     `panel` publishes its value on every change, because `/rfq/new` owns Send
     and needs the requirement fields as they are typed rather than at submit.
     In an effect rather than in each handler: one place, and it cannot drift
     from the state it describes.
  */
  useEffect(() => {
    if (!onChange) return;
    onChange({
      requirement: requirement.trim(),
      lines: [],
      emirate: emirate || null,
      deliverToArea: area.trim() || null,
      neededBy: neededBy || null,
      termsWanted: terms || null,
      closesInDays: Number(closesInDays) || 7,
      fanoutTo,
      contactPhone: contactPhone.trim(),
      contactName: contactName.trim(),
    });
  }, [onChange, requirement, emirate, area, neededBy, terms, closesInDays, fanoutTo, contactPhone, contactName]);

  const totalSteps = labels.steps.length;

  /*
     Every section renders. Board 1h's steps are a reading of the form, not a
     filter on it — the wizard that showed one at a time is gone, and with it
     the buyer who corrected a line and found themselves two steps back.
  */
  const showStep = () => true;

  const filledLines = useMemo(
    () => lines.filter((l) => l.description.trim() !== "" && l.qty > 0),
    [lines],
  );

  function updateLine(key: string, patch: Partial<EnquiryLineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  /** What must be true before leaving a step. Named, so the message can be. */
  function problemWith(index: number): string | null {
    if (index === 0) {
      if (requirement.trim().length < 10) return labels.errorRequirement;
      if (filledLines.length === 0) return labels.errorLines;
    }
    if (index === totalSteps - 1 && askForContact && contactPhone.trim() === "") {
      return labels.errorContact;
    }
    return null;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    /*
       Validation is no longer a walk back to the offending step, because there
       are no steps to walk to — everything is on screen. The first problem is
       named and the field it names is visible.
    */
    for (let i = 0; i < totalSteps; i += 1) {
      const problem = problemWith(i);
      if (problem) {
        setLocalError(problem);
        return;
      }
    }
    setLocalError(null);

    void onSubmit?.({
      requirement: requirement.trim(),
      lines: filledLines.map((l) => ({
        description: l.description.trim(),
        qty: l.qty,
        unit: l.unit.trim() || null,
        size: l.size.trim() || null,
        targetUnitPriceAed: l.targetUnitPriceAed.trim() || null,
        productId: l.productId ?? null,
      })),
      emirate: emirate || null,
      deliverToArea: area.trim() || null,
      neededBy: neededBy || null,
      termsWanted: terms || null,
      closesInDays: Number(closesInDays),
      fanoutTo,
      contactPhone: contactPhone.trim(),
      contactName: contactName.trim(),
    });
  }

  const message = error ?? localError;
  return (
    <form onSubmit={handleSubmit} noValidate aria-label={labels.formLabel} className="space-y-5">
      {/*
         Board 1h step 1. A fieldset rather than a per-input flag: one element
         disables every control inside it, and a screen reader reads the group
         as unavailable rather than announcing nine separate disabled fields.
      */}
      <fieldset disabled={disabled} className="contents">
      {/* The progress statement belongs to the page, not the form. */}

      {showStep() ? (
        <div className="space-y-5">
          <div>
            <label htmlFor={`${formId}-req`} className="mb-1.5 block text-body-sm text-ink">
              {labels.requirement}
            </label>
            <Textarea
              id={`${formId}-req`}
              rows={4}
              value={requirement}
              placeholder={labels.requirementPlaceholder}
              aria-describedby={`${formId}-req-hint`}
              onChange={(e) => setRequirement(e.target.value)}
            />
            <p id={`${formId}-req-hint`} className="mt-1.5 text-caption text-muted">
              {labels.requirementHint}
            </p>
          </div>

          {/*
             `panel` renders no lines editor: `/rfq/new` owns the items table,
             with the three row types and the target-price column the inline
             composer has no use for.
          */}
          <fieldset className={shape === "panel" ? "hidden" : undefined}>
            <legend className="text-body-sm text-ink">{labels.lines}</legend>
            <p className="mt-1 mb-2 text-caption text-muted">{labels.linesHint}</p>

            {/* `contain-paint` is not decoration. A scroll container nested in a
                fieldset does not stop the document's own scroll width from
                counting the content it clips, so on a 412px phone this table's
                40rem floor made the page 693px wide: it panned sideways over
                blank space, and taps landed on whatever the offset put under
                the finger. Of the fifteen `overflow-x-auto` wrappers in the
                app this is the only one inside a fieldset, and the only one
                that did it. */}
            <div className="overflow-x-auto contain-paint">
              <table className="w-full min-w-[40rem] border-collapse text-left">
                <caption className="sr-only">{labels.lines}</caption>
                <thead>
                  <tr className="bg-paper-sunk">
                    <th scope="col" className="px-2 py-1.5 text-caption font-normal text-muted">{labels.colDescription}</th>
                    <th scope="col" className="w-20 px-2 py-1.5 text-caption font-normal text-muted">{labels.colQty}</th>
                    <th scope="col" className="w-24 px-2 py-1.5 text-caption font-normal text-muted">{labels.colUnit}</th>
                    <th scope="col" className="w-28 px-2 py-1.5 text-caption font-normal text-muted">{labels.colSize}</th>
                    <th scope="col" className="w-32 px-2 py-1.5 text-caption font-normal text-muted">{labels.colTarget}</th>
                    <th scope="col" className="w-10 px-2 py-1.5">
                      <span className="sr-only">{labels.removeLine(1)}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={line.key} className="border-t border-line">
                      <td className="px-2 py-2">
                        <Input
                          size="sm"
                          aria-label={labels.lineDescription(i + 1)}
                          value={line.description}
                          onChange={(e) => updateLine(line.key, { description: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          size="sm"
                          mono
                          inputMode="numeric"
                          aria-label={labels.lineQty(i + 1)}
                          value={String(line.qty)}
                          onChange={(e) =>
                            updateLine(line.key, { qty: Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0) })
                          }
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          size="sm"
                          aria-label={labels.lineUnit(i + 1)}
                          value={line.unit}
                          onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          size="sm"
                          mono
                          aria-label={labels.lineSize(i + 1)}
                          value={line.size}
                          onChange={(e) => updateLine(line.key, { size: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          size="sm"
                          mono
                          inputMode="decimal"
                          aria-label={labels.lineTarget(i + 1)}
                          value={line.targetUnitPriceAed}
                          onChange={(e) => updateLine(line.key, { targetUnitPriceAed: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        {lines.length > 1 ? (
                          <IconButton
                            type="button"
                            size="sm"
                            variant="ghost"
                            icon={<Close size={14} />}
                            label={labels.removeLine(i + 1)}
                            onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                          />
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-1.5 text-caption text-muted">{labels.lineTargetHint}</p>
            <div className="mt-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setLines((p) => [...p, blankLine()])}>
                {labels.addLine}
              </Button>
            </div>
          </fieldset>
        </div>
      ) : null}

      {showStep() ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={`${formId}-emirate`} className="mb-1.5 block text-body-sm text-ink">
              {labels.emirate}
            </label>
            <Select
              id={`${formId}-emirate`}
              value={emirate}
              placeholder={labels.emirate}
              options={labels.emirateOptions}
              onChange={(e) => setEmirate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor={`${formId}-area`} className="mb-1.5 block text-body-sm text-ink">
              {labels.area}
            </label>
            <Input
              id={`${formId}-area`}
              value={area}
              aria-describedby={`${formId}-area-hint`}
              onChange={(e) => setArea(e.target.value)}
            />
            <p id={`${formId}-area-hint`} className="mt-1.5 text-caption text-muted">
              {labels.areaHint}
            </p>
          </div>
          <div>
            <label htmlFor={`${formId}-needed`} className="mb-1.5 block text-body-sm text-ink">
              {labels.neededBy}
            </label>
            <Input
              id={`${formId}-needed`}
              type="date"
              value={neededBy}
              aria-describedby={`${formId}-needed-hint`}
              onChange={(e) => setNeededBy(e.target.value)}
            />
            <p id={`${formId}-needed-hint`} className="mt-1.5 text-caption text-muted">
              {labels.neededByHint}
            </p>
          </div>
          <div>
            <label htmlFor={`${formId}-terms`} className="mb-1.5 block text-body-sm text-ink">
              {labels.terms}
            </label>
            <Select
              id={`${formId}-terms`}
              value={terms}
              options={labels.termsOptions}
              aria-describedby={`${formId}-terms-hint`}
              onChange={(e) => setTerms(e.target.value)}
            />
            <p id={`${formId}-terms-hint`} className="mt-1.5 text-caption text-muted">
              {labels.termsHint}
            </p>
          </div>
          <div>
            <label htmlFor={`${formId}-closes`} className="mb-1.5 block text-body-sm text-ink">
              {labels.closes}
            </label>
            <Select
              id={`${formId}-closes`}
              value={closesInDays}
              options={labels.closesOptions}
              aria-describedby={`${formId}-closes-hint`}
              onChange={(e) => setClosesInDays(e.target.value)}
            />
            <p id={`${formId}-closes-hint`} className="mt-1.5 text-caption text-muted">
              {labels.closesHint}
            </p>
          </div>
        </div>
      ) : null}

      {showStep() ? (
        <div className="space-y-4">
          {/*
             `panel` renders no recipient control at all: `/rfq/new` owns the
             picker, with checkboxes per seller, the 1-8 cap and the free-plan
             exclusion. The slider below is Composer A's "also send to N similar
             suppliers", which is a count rather than a choice of sellers.
          */}
          {shape === "single" && recipients.length > 0 ? (
            <div>
              <p className="text-body-sm text-ink">{labels.recipients}</p>
              <p className="mt-1 text-caption text-muted">{labels.recipientsHint}</p>

              <div className="mt-3">
                <label htmlFor={`${formId}-fanout`} className="mb-1.5 block text-body-sm text-ink">
                  {labels.fanout(fanoutTo)}
                </label>
                <input
                  id={`${formId}-fanout`}
                  type="range"
                  min={1}
                  max={maxFanout}
                  step={1}
                  value={fanoutTo}
                  aria-label={labels.fanoutLabel}
                  aria-valuetext={labels.recipientsPreview(fanoutTo)}
                  className="h-11 w-full accent-[var(--moss)] focus-visible:shadow-focus focus-visible:outline-none"
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setFanoutTo(next);
                    onFanoutChange?.(next);
                  }}
                />
                <p className="mt-1 text-caption text-muted">{labels.fanoutNote}</p>
              </div>
            </div>
          ) : null}

          {recipients.length > 0 ? (
            <div className="rounded-card border border-line bg-card">
              <p className="border-b border-line px-3 py-2 text-caption text-muted">
                {labels.recipientsPreview(recipients.length)}
              </p>
              <ul>
                {recipients.map((r) => (
                  <li
                    key={r.businessId}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-3 py-2 last:border-b-0"
                  >
                    <span className="text-body-sm text-ink">
                      {r.displayName}
                      {r.pinned ? (
                        <span className="ms-2">
                          <StatusBadge tone="info" size="sm" shape="chip">
                            {labels.pinned}
                          </StatusBadge>
                        </span>
                      ) : null}
                    </span>
                    <span className="text-caption text-muted">
                      {[r.areaName, r.responseLabel].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {askForContact ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor={`${formId}-name`} className="mb-1.5 block text-body-sm text-ink">
                  {labels.contactName}
                </label>
                <Input
                  id={`${formId}-name`}
                  autoComplete="name"
                  value={contactName}
                  aria-describedby={`${formId}-name-hint`}
                  onChange={(e) => setContactName(e.target.value)}
                />
                <p id={`${formId}-name-hint`} className="mt-1.5 text-caption text-muted">
                  {labels.contactNameHint}
                </p>
              </div>
              <div>
                <label htmlFor={`${formId}-phone`} className="mb-1.5 block text-body-sm text-ink">
                  {labels.contact}
                </label>
                <Input
                  id={`${formId}-phone`}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={contactPhone}
                  aria-describedby={`${formId}-phone-hint`}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
                <p id={`${formId}-phone-hint`} className="mt-1.5 text-caption text-muted">
                  {labels.contactHint}
                </p>
              </div>
            </div>
          ) : null}

          {/* Rule 1, said to the buyer before they commit, not after. */}
          <p className="text-caption text-muted">{labels.privacy}</p>
        </div>
      ) : null}

      {message ? (
        <p role="alert" className="rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink">
          {message}
        </p>
      ) : null}

      {/*
         `panel` has no submit of its own. `/rfq/new` owns Send, because the
         count it carries — "Send to 5 sellers" — comes from the recipient
         picker the page owns, and two submit buttons on one surface is the
         duplicate-composer defect board 1d removed from the storefront.
      */}
      {shape === "single" ? (
        <Button type="submit" loading={busy} block>
          {busy ? labels.sending : labels.submit}
        </Button>
      ) : null}
      </fieldset>
    </form>
  );
}
