"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/primitives/Button";
import { Input } from "@/components/primitives/Input";
import { Select } from "@/components/primitives/Select";
import { Textarea } from "@/components/primitives/Textarea";
import { StatusBadge } from "@/components/display/StatusBadge";
import { cn } from "@/lib/cn";
import { EN_DASH } from "@/lib/format/locale";
import { filsToAed, lineTotalFils, parseAedToFils } from "@/lib/quote/money";

/**
 * QuoteLineEditor — tier 4, seller side.
 *
 * The README: "Lines matched to catalogue SKUs with stock shown, unmatched
 * lines flagged for manual pricing and never silently blank, per-line unit
 * price and lead time, note, validity days."
 *
 * "Never silently blank" is the requirement with teeth. A line the matcher
 * could not place must look different from a line the seller has not got to
 * yet, and the quote must not send while one is unpriced. The failure this
 * prevents is a seller sending a quote that reads complete and quietly omits
 * the one item the buyer most wanted a price for.
 *
 * A real <table>, per CLAUDE.md. It is tabular data with a total; div rows
 * would cost the row and column association that makes it readable aloud.
 *
 * Every string arrives already translated. This component never calls t().
 */

export type MatchReason = "sku" | "size" | "wording";

export interface QuoteLineCandidate {
  productId: string;
  name: string;
  sku: string | null;
  /** "In stock", "Made to order" — already localised. */
  availabilityLabel: string;
  /** "64 in stock" — already localised. Null when the seller tracks no count. */
  stockLabel: string | null;
  leadTimeDays: number | null;
  reasons: readonly MatchReason[];
}

export interface QuoteLineDraft {
  /** The enquiry line id. Stable across a re-render and submitted back. */
  key: string;
  /** The requirement in the buyer's own words. Read-only here. */
  description: string;
  qty: number;
  unit: string | null;
  size: string | null;
  /** What the buyer said they hope to pay, per unit. Never a supplier price. */
  targetUnitPriceAed: string | null;
  /** Null when nothing in the seller's catalogue matched. */
  suggested: QuoteLineCandidate | null;
  alternatives: readonly QuoteLineCandidate[];
  /** Pre-filled on a revision, so an edit starts from the last price sent. */
  initialUnitPrice?: string;
  initialLeadTimeDays?: number | null;
  initialProductId?: string | null;
}

export interface QuoteLineEditorLabels {
  /**
   * Names the <form> landmark. Distinct per instance where a page holds more
   * than one — the gallery does, and five landmarks called the same thing are
   * five landmarks a screen reader user cannot tell apart.
   */
  formLabel: string;
  caption: string;
  /** Column heads. Mono, so they stay in the case the design system asks for. */
  colLine: string;
  colProduct: string;
  colQty: string;
  colUnitPrice: string;
  colLeadTime: string;
  colTotal: string;

  manualFlag: string;
  manualHelp: string;
  matchedBy: (reasons: readonly MatchReason[]) => string;
  priceByHand: string;
  chooseProduct: string;
  /**
   * Receives the raw amount, not a formatted one. The hint sits in the line
   * column rather than under a currency head, so it needs the currency spelled
   * out — a different decision from the money columns, and the caller owns it.
   */
  targetPrice: (amountAed: string) => string;
  leadTimeSuffix: string;
  unitPriceLabel: (line: string) => string;
  leadTimeLabel: (line: string) => string;
  productLabel: (line: string) => string;
  includeLabel: (line: string) => string;

  excluded: string;
  excludeAction: string;
  includeAction: string;

  totalLabel: string;
  currencyNote: string;

  noteLabel: string;
  notePlaceholder: string;
  validityLabel: string;
  validityHelp: string;
  validityDayOptions: readonly { value: string; label: string }[];

  submit: string;
  submitting: string;
  /** Names the lines that block sending. Never "fix errors". */
  unpricedError: (lines: readonly string[]) => string;
  badPriceError: (line: string) => string;
  nothingIncludedError: string;
}

export interface QuoteLineEditorProps {
  lines: readonly QuoteLineDraft[];
  labels: QuoteLineEditorLabels;
  initialNote?: string;
  initialValidityDays?: number;
  /** Formats a fils total for display. Passed in — a server page owns locale. */
  formatTotal: (aed: string) => string;
  onSubmit?: (value: QuoteLineEditorValue) => void | Promise<void>;
  /**
   * Every keystroke's worth of state, unvalidated.
   *
   * Board 3j §5 autosaves line edits as a draft, and a draft is the seller's
   * own workings — a half-typed price, a line not reached yet. `onSubmit`
   * refuses all of that, correctly, because a buyer is about to read it. So
   * this fires with whatever is on screen and the caller decides what to keep.
   *
   * Fired from an effect rather than from each handler, so it cannot miss a
   * path: there are eleven places a row changes.
   */
  onChange?: (value: QuoteLineEditorValue) => void;
  busy?: boolean;
  /** A server-side failure, already localised. */
  error?: string;
}

export interface QuoteLineEditorValue {
  note: string;
  validityDays: number;
  lines: {
    enquiryLineId: string;
    productId: string | null;
    description: string;
    qty: number;
    unitPrice: string;
    leadTimeDays: number | null;
  }[];
}

interface RowState {
  productId: string | null;
  unitPrice: string;
  leadTimeDays: string;
  included: boolean;
}

const PRICE_BY_HAND = "__manual__";

export function QuoteLineEditor({
  lines,
  labels,
  initialNote = "",
  initialValidityDays = 14,
  formatTotal,
  onSubmit,
  onChange,
  busy = false,
  error,
}: QuoteLineEditorProps) {
  const formId = useId();
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      lines.map((line) => [
        line.key,
        {
          productId: line.initialProductId ?? line.suggested?.productId ?? null,
          unitPrice: line.initialUnitPrice ?? "",
          leadTimeDays: String(
            line.initialLeadTimeDays ?? line.suggested?.leadTimeDays ?? "",
          ),
          included: true,
        } satisfies RowState,
      ]),
    ),
  );
  const [note, setNote] = useState(initialNote);
  const [validityDays, setValidityDays] = useState(String(initialValidityDays));
  const [submitError, setSubmitError] = useState<string | null>(null);

  const update = (key: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [key]: { ...prev[key]!, ...patch } }));

  const totalAed = useMemo(() => {
    let fils = 0n;
    for (const line of lines) {
      const row = rows[line.key];
      if (!row?.included) continue;
      try {
        fils += lineTotalFils({ qty: line.qty, unitPrice: row.unitPrice });
      } catch {
        // A half-typed price is not an error yet. It becomes one on submit.
      }
    }
    return filsToAed(fils);
  }, [lines, rows]);

  /**
   * The form's state as a value, with nothing refused.
   *
   * Shared by the draft and the submit so the two cannot describe the same
   * screen differently — the submit adds validation on top rather than building
   * its own shape.
   */
  const currentValue = useMemo<QuoteLineEditorValue>(
    () => ({
      note: note.trim(),
      validityDays: Number(validityDays),
      lines: lines
        .filter((line) => rows[line.key]?.included)
        .map((line) => {
          const row = rows[line.key]!;
          const lead = row.leadTimeDays.trim();
          return {
            enquiryLineId: line.key,
            productId: row.productId,
            description: line.description,
            qty: line.qty,
            unitPrice: row.unitPrice.trim(),
            leadTimeDays: lead === "" ? null : Number(lead),
          };
        }),
    }),
    [lines, rows, note, validityDays],
  );

  /*
     Skip the first run. Mounting is not an edit, and firing here would save a
     draft for every lead a seller merely clicked into — including the ones they
     looked at and left, which would then read as work in progress.
  */
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    onChange?.(currentValue);
  }, [currentValue, onChange]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    const included = lines.filter((line) => rows[line.key]?.included);
    if (included.length === 0) {
      setSubmitError(labels.nothingIncludedError);
      return;
    }

    const unpriced = included
      .filter((line) => (rows[line.key]?.unitPrice ?? "").trim() === "")
      .map((line) => line.description);
    if (unpriced.length > 0) {
      setSubmitError(labels.unpricedError(unpriced));
      return;
    }

    for (const line of included) {
      try {
        // Zero is a real price — a sample, a line absorbed. Negative is not,
        // and the server refuses it too; catching it here saves a round trip.
        if (parseAedToFils(rows[line.key]!.unitPrice) < 0n) throw new RangeError("negative");
      } catch {
        setSubmitError(labels.badPriceError(line.description));
        return;
      }
    }

    void onSubmit?.(currentValue);
  }

  const message = error ?? submitError;

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={labels.formLabel}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-body-sm">
          <caption className="sr-only">{labels.caption}</caption>
          <thead>
            <tr className="bg-paper-sunk">
              <th scope="col" className="px-3 py-2 text-left text-caption font-normal text-muted">
                {labels.colLine}
              </th>
              <th scope="col" className="px-3 py-2 text-left text-caption font-normal text-muted">
                {labels.colProduct}
              </th>
              <th scope="col" className="px-3 py-2 text-right text-caption font-normal text-muted">
                {labels.colQty}
              </th>
              <th scope="col" className="px-3 py-2 text-right text-caption font-normal text-muted">
                {labels.colUnitPrice}
              </th>
              <th scope="col" className="px-3 py-2 text-right text-caption font-normal text-muted">
                {labels.colLeadTime}
              </th>
              <th scope="col" className="px-3 py-2 text-right text-caption font-normal text-muted">
                {labels.colTotal}
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const row = rows[line.key]!;
              const manual = line.suggested === null && row.productId === null;
              /*
               * The flagged row is tinted, and --text-muted on --warn-surface
               * is 4.21:1 against a 4.5 floor. --warn-ink is 4.64:1 and says
               * the same thing better: on a warning row, the secondary text is
               * the warning's colour.
               */
              const secondary = manual && row.included ? "text-warn-ink" : "text-muted";
              const flagId = `${formId}-flag-${line.key}`;
              const selected =
                [line.suggested, ...line.alternatives].find((c) => c?.productId === row.productId) ?? null;

              // Null while the price is half-typed. The dash is rendered
              // directly rather than sent through formatTotal, which is a
              // number formatter and rightly refuses anything that is not one.
              let lineTotal: string | null = null;
              try {
                lineTotal = filsToAed(lineTotalFils({ qty: line.qty, unitPrice: row.unitPrice || "0" }));
              } catch {
                lineTotal = null;
              }

              return (
                <tr
                  key={line.key}
                  className={cn(
                    "border-t border-line align-top",
                    !row.included && "opacity-60",
                    // The flag, as a state and not only as a badge. A seller
                    // scanning six lines should see the odd one out before
                    // they read a word.
                    manual && row.included && "bg-warn-surface",
                  )}
                >
                  <th scope="row" className="px-3 py-3 text-left font-normal">
                    <span className="block text-ink">{line.description}</span>
                    <span className={cn("mt-0.5 block font-mono text-caption", secondary)}>
                      {[line.size, line.unit].filter(Boolean).join(" · ")}
                    </span>
                    {line.targetUnitPriceAed ? (
                      <span className={cn("mt-1 block text-caption", secondary)}>
                        {labels.targetPrice(line.targetUnitPriceAed)}
                      </span>
                    ) : null}
                    {manual && row.included ? (
                      <span id={flagId} className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <StatusBadge tone="warn" size="sm" shape="chip">
                          {labels.manualFlag}
                        </StatusBadge>
                        <span className={cn("text-caption", secondary)}>{labels.manualHelp}</span>
                      </span>
                    ) : null}
                    {!row.included ? (
                      <span className="mt-1.5 block">
                        <StatusBadge tone="neutral" size="sm" shape="chip">
                          {labels.excluded}
                        </StatusBadge>
                      </span>
                    ) : null}
                  </th>

                  <td className="px-3 py-3">
                    {line.suggested || line.alternatives.length > 0 ? (
                      <>
                        <Select
                          aria-label={labels.productLabel(line.description)}
                          size="sm"
                          value={row.productId ?? PRICE_BY_HAND}
                          disabled={!row.included}
                          onChange={(e) =>
                            update(line.key, {
                              productId: e.target.value === PRICE_BY_HAND ? null : e.target.value,
                            })
                          }
                          options={[
                            ...[line.suggested, ...line.alternatives]
                              .filter((c): c is QuoteLineCandidate => c !== null)
                              .map((c) => ({
                                value: c.productId,
                                label: c.sku ? `${c.sku} · ${c.name}` : c.name,
                              })),
                            { value: PRICE_BY_HAND, label: labels.priceByHand },
                          ]}
                        />
                        {selected ? (
                          <span className="mt-1 block text-caption text-muted">
                            {[selected.stockLabel ?? selected.availabilityLabel, labels.matchedBy(selected.reasons)]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className={cn("text-caption", secondary)}>{labels.chooseProduct}</span>
                    )}
                  </td>

                  <td className="px-3 py-3 text-right font-mono tabular-nums">{line.qty}</td>

                  <td className="px-3 py-3 text-right">
                    <Input
                      aria-label={labels.unitPriceLabel(line.description)}
                      {...(manual && row.included ? { "aria-describedby": flagId } : {})}
                      size="sm"
                      mono
                      inputMode="decimal"
                      // Never a placeholder that looks like a value. A grey
                      // 0.00 in an empty price box is exactly the silently
                      // blank line this component exists to prevent.
                      placeholder=""
                      disabled={!row.included}
                      required={row.included}
                      value={row.unitPrice}
                      onChange={(e) => update(line.key, { unitPrice: e.target.value })}
                    />
                  </td>

                  <td className="px-3 py-3 text-right">
                    <Input
                      aria-label={labels.leadTimeLabel(line.description)}
                      size="sm"
                      mono
                      inputMode="numeric"
                      suffix={labels.leadTimeSuffix}
                      disabled={!row.included}
                      value={row.leadTimeDays}
                      onChange={(e) => update(line.key, { leadTimeDays: e.target.value })}
                    />
                  </td>

                  <td className="px-3 py-3 text-right font-mono tabular-nums">
                    {row.included && lineTotal !== null ? formatTotal(lineTotal) : EN_DASH}
                    <span className="mt-1 block">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => update(line.key, { included: !row.included })}
                      >
                        {row.included ? labels.excludeAction : labels.includeAction}
                      </Button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={5} className="px-3 py-3 text-right font-normal text-ink">
                {labels.totalLabel}
              </th>
              <td className="px-3 py-3 text-right font-mono text-body tabular-nums text-ink">
                {formatTotal(totalAed)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-2 px-3 text-caption text-muted">{labels.currencyNote}</p>

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_14rem]">
        <div>
          <label htmlFor={`${formId}-note`} className="mb-1.5 block text-body-sm text-ink">
            {labels.noteLabel}
          </label>
          <Textarea
            id={`${formId}-note`}
            rows={3}
            placeholder={labels.notePlaceholder}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${formId}-validity`} className="mb-1.5 block text-body-sm text-ink">
            {labels.validityLabel}
          </label>
          <Select
            id={`${formId}-validity`}
            value={validityDays}
            onChange={(e) => setValidityDays(e.target.value)}
            options={labels.validityDayOptions}
          />
          <p className="mt-1.5 text-caption text-muted">{labels.validityHelp}</p>
        </div>
      </div>

      {message ? (
        <p role="alert" className="mt-4 rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink">
          {message}
        </p>
      ) : null}

      <div className="mt-5 flex justify-end">
        <Button type="submit" loading={busy}>
          {busy ? labels.submitting : labels.submit}
        </Button>
      </div>
    </form>
  );
}
