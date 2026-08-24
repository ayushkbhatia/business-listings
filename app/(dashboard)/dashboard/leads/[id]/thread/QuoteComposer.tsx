"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  QuoteLineEditor,
  type QuoteLineDraft,
  type QuoteLineEditorLabels,
  type QuoteLineEditorValue,
} from "@/components/domain/QuoteLineEditor";
import { formatAED } from "@/lib/format";
import { t } from "@/lib/i18n";
import { sendQuote } from "./actions";

/**
 * The client half of the composer.
 *
 * Several of the editor's labels are functions — "Unit price for {line}",
 * "Buyer's target {amount}" — and a function cannot cross from a server
 * component to a client one. Rather than flatten them into pre-rendered
 * strings per line, which would put a formatting decision in the page, the
 * labels are built here. `t()` and `formatAED` are pure and run identically on
 * either side; the locale is the constant, not the environment.
 */
export const VALIDITY_CHOICES = [7, 10, 14, 21, 30, 45, 60] as const;

export interface QuoteComposerProps {
  enquiryId: string;
  lines: readonly QuoteLineDraft[];
  initialValidityDays?: number;
}

export function QuoteComposer({ enquiryId, lines, initialValidityDays = 14 }: QuoteComposerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);

  function handleSubmit(value: QuoteLineEditorValue) {
    setError(undefined);
    startTransition(async () => {
      const result = await sendQuote({ enquiryId, ...value });
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <QuoteLineEditor
      lines={lines}
      labels={editorLabels()}
      // Quote style: two decimals, no currency prefix. The column heads and
      // the note under the table carry the currency, and a buyer comparing
      // three quotes needs the digits to line up.
      formatTotal={(aed) => formatAED(aed, { style: "quote" })}
      initialValidityDays={initialValidityDays}
      onSubmit={handleSubmit}
      busy={pending}
      {...(error ? { error } : {})}
    />
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
