"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  QuoteLineEditor,
  type QuoteLineDraft,
  type QuoteLineEditorLabels,
  type QuoteLineEditorValue,
} from "@/components/domain/QuoteLineEditor";
import { formatAED, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { saveDraftAction, sendQuote } from "./actions";

/**
 * Board 3j §5 — the quote composer, and the autosave the board asks for.
 *
 * The client half. Several of the editor's labels are functions — "Unit price
 * for {line}", "Buyer's target {amount}" — and a function cannot cross from a
 * server component to a client one. They are built here: `t()` and `formatAED`
 * are pure and run identically on either side, so the locale is the constant
 * rather than the environment.
 *
 * ## Autosave
 *
 * "Line edits autosave as a draft. Send quote is the only commit." Debounced,
 * because the alternative is a write per keystroke on a page where somebody is
 * typing eleven prices; and skipped while a send is in flight, so a draft
 * cannot land on top of the row that send is promoting.
 *
 * The saved label sits in this panel rather than the page header.
 * `docs/design-system.md` puts "Saved 20 seconds ago" in the header, and
 * `PageHeader` has the slot — but `SellerPage` renders on the server and this
 * value changes as the seconds pass, so a header version would be frozen at the
 * moment of the request. It is beside the thing it describes instead.
 */

export const VALIDITY_CHOICES = [7, 10, 14, 21, 30, 45, 60] as const;

/** Long enough that a price is finished being typed, short enough to be a save. */
const AUTOSAVE_MS = 1_200;

export interface ComposerProps {
  enquiryId: string;
  lines: readonly QuoteLineDraft[];
  initialNote?: string;
  initialValidityDays?: number;
  /** True when a draft was restored, so the panel can say where it came from. */
  restored?: boolean;
  /** When that draft was last written, for the first "Saved" label. */
  restoredAt?: number;
}

export function Composer({
  enquiryId,
  lines,
  initialNote = "",
  initialValidityDays = 14,
  restored = false,
  restoredAt,
}: ComposerProps) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [savedAt, setSavedAt] = useState<number | null>(restoredAt ?? null);
  const [saving, setSaving] = useState(false);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendingRef = useRef(false);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const handleChange = useCallback(
    (value: QuoteLineEditorValue) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        // A send in flight owns the row. A draft write landing on top of the
        // promotion would resurrect lines the seller had just removed.
        if (sendingRef.current) return;
        setSaving(true);
        void saveDraftAction({ enquiryId, ...value }).then((result) => {
          setSaving(false);
          if (result.ok && result.savedAt) setSavedAt(result.savedAt);
        });
      }, AUTOSAVE_MS);
    },
    [enquiryId],
  );

  function handleSubmit(value: QuoteLineEditorValue) {
    setError(undefined);
    setSending(true);
    sendingRef.current = true;
    if (timer.current) clearTimeout(timer.current);

    void sendQuote({ enquiryId, ...value }).then((result) => {
      setSending(false);
      sendingRef.current = false;
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="space-y-3">
      {restored ? (
        <p className="rounded-ctl border border-line bg-paper-sunk px-3 py-2 text-caption text-muted">
          {t("lead.draft_restored")}
        </p>
      ) : null}

      <p aria-live="polite" className="text-right text-caption text-muted">
        {saving
          ? t("lead.draft_saving")
          : savedAt
            ? t("lead.draft_saved", { when: formatRelative(new Date(savedAt)) })
            : ""}
      </p>

      <QuoteLineEditor
        lines={lines}
        labels={editorLabels()}
        // Quote style: two decimals, no currency prefix. The column heads and
        // the note under the table carry the currency, and a buyer comparing
        // three quotes needs the digits to line up.
        formatTotal={(aed) => formatAED(aed, { style: "quote" })}
        initialNote={initialNote}
        initialValidityDays={initialValidityDays}
        onChange={handleChange}
        onSubmit={handleSubmit}
        busy={sending}
        {...(error ? { error } : {})}
      />
    </div>
  );
}

function editorLabels(): QuoteLineEditorLabels {
  return {
    formLabel: t("quote.editor.form"),
    caption: t("quote.editor.caption"),
    colLine: t("quote.col.line"),
    colProduct: t("quote.col.product"),
    colQty: t("quote.col.qty"),
    colUnitPrice: t("quote.col.unit_price"),
    colLeadTime: t("quote.col.lead_time"),
    colTotal: t("quote.col.total"),

    manualFlag: t("quote.manual_flag"),
    manualHelp: t("quote.manual_help"),
    matchedBy: (reasons) => {
      if (reasons.includes("sku")) return t("quote.matched_by.sku");
      const size = reasons.includes("size");
      const wording = reasons.includes("wording");
      if (size && wording) return t("quote.matched_by.size_and_wording");
      if (size) return t("quote.matched_by.size");
      return t("quote.matched_by.wording");
    },
    priceByHand: t("quote.price_by_hand"),
    chooseProduct: t("quote.choose_product"),
    targetPrice: (amountAed) => t("quote.target_price", { amount: formatAED(amountAed) }),
    leadTimeSuffix: t("quote.lead_time_suffix"),
    unitPriceLabel: (line) => t("quote.unit_price_for", { line }),
    leadTimeLabel: (line) => t("quote.lead_time_for", { line }),
    productLabel: (line) => t("quote.product_for", { line }),
    includeLabel: (line) => t("quote.product_for", { line }),

    excluded: t("quote.excluded"),
    excludeAction: t("quote.exclude"),
    includeAction: t("quote.include"),

    totalLabel: t("quote.total"),
    currencyNote: t("quote.currency_note"),

    noteLabel: t("quote.note_label"),
    notePlaceholder: t("quote.note_placeholder"),
    validityLabel: t("quote.validity_label"),
    validityHelp: t("quote.validity_help"),
    validityDayOptions: VALIDITY_CHOICES.map((days) => ({
      value: String(days),
      label: t("quote.validity_days", { count: days }),
    })),

    submit: t("quote.send"),
    submitting: t("quote.sending"),
    unpricedError: (lines) =>
      t("quote.error.unpriced", { count: lines.length, lines: lines.join("; ") }),
    badPriceError: (line) => t("quote.error.bad_price", { line }),
    nothingIncludedError: t("quote.error.nothing_included"),
  };
}
