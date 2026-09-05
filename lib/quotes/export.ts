import "server-only";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { LeadScope } from "@/lib/leads/inbox";
import { getPipeline, PAGE_SIZE, type PipelineRow, type PipelineTab } from "./pipeline";

/**
 * Board 3k §9 — the pipeline as a CSV.
 *
 * The current tab, the current scope, and nothing wider. It carries prices, so
 * it is the seller's own commercial data: no cross-seller aggregate, no admin
 * view of line totals, and a `staff` seat exports exactly what a `staff` seat can
 * see. Board 3j's price rule is that a price is private to one buyer and one
 * seller, and a file is not an exception to it.
 *
 * ## The caveat travels with the numbers
 *
 * A spreadsheet outlives the screen it came from. The won and lost columns are
 * what the seller marked — we take no payment and never see the order — so the
 * first line of the file says so, before any reader gets to a column head. §8.3
 * requires the caption on screen; a file that dropped it would be the same claim
 * with the qualification removed.
 *
 * ## Buyer identity
 *
 * A first name, exactly as the screen shows, unless the buyer accepted this
 * supplier and released their details. Rule 1 does not relax because the rows
 * are leaving in a file — that is precisely when it would matter most.
 */

/** Excel reads a bare UTF-8 CSV as Windows-1252 and mangles the dirham sign. */
const BOM = "﻿";

/**
 * One CSV field.
 *
 * Quotes everything rather than deciding per value. A requirement is free text a
 * buyer typed, so it can contain a comma, a quote mark or a newline, and a
 * clever escaper is a thing that gets one of those wrong.
 *
 * The leading apostrophe on anything starting `=`, `+`, `-` or `@` is the
 * formula-injection guard: a buyer who writes `=HYPERLINK(...)` into a
 * requirement must not have it evaluated when a seller opens the file.
 */
function field(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '""';
  const text = String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

const STATE_KEY = {
  awaiting: "quotes.state.awaiting",
  won: "quotes.state.won",
  lost: "quotes.state.lost",
  expired: "quotes.state.expired",
} as const;

export interface PipelineExport {
  filename: string;
  csv: string;
  rows: number;
}

/**
 * Every row of a tab, not the page on screen.
 *
 * The table paginates because a screen has to; a file has no reason to, and an
 * export that silently stopped at the first twenty-five would be a file whose
 * totals disagree with the tab it came from.
 */
export async function exportPipeline(input: {
  businessId: string;
  tab: PipelineTab;
  scope: LeadScope;
  now?: Date;
}): Promise<PipelineExport> {
  const now = input.now ?? new Date();

  const rows: PipelineRow[] = [];
  for (let page = 1; ; page += 1) {
    const chunk = await getPipeline({ ...input, page, now });
    rows.push(...chunk.rows);
    if (rows.length >= chunk.total || chunk.rows.length < PAGE_SIZE) break;
  }

  const lines: string[] = [
    // Before any column head, so a reader meets it first.
    field(t("quotes.export.caveat")),
    [
      field(t("quotes.col.ref")),
      field(t("quotes.col.enquiry")),
      field(t("quotes.col.buyer")),
      field(t("quotes.export.requirement_head")),
      field(t("quotes.col.lines")),
      field(t("quotes.export.total_head")),
      field(t("quotes.col.sent")),
      field(t("quotes.col.valid_until")),
      field(t("quotes.col.status")),
      field(t("quotes.export.extended_head")),
      field(t("quotes.export.reason_head")),
    ].join(","),
  ];

  for (const row of rows) {
    lines.push(
      [
        field(row.ref),
        field(row.enquiryRef),
        field(
          row.buyer.released && row.buyer.companyName
            ? row.buyer.companyName
            : row.buyer.firstName,
        ),
        field(row.summary),
        field(row.lineCount),
        field(row.totalAed),
        field(row.sentAt ? formatDate(row.sentAt) : null),
        field(row.expiresAt ? formatDate(row.expiresAt) : null),
        field(t(STATE_KEY[row.state])),
        field(row.extensionCount),
        field(row.outcomeReason),
      ].join(","),
    );
  }

  return {
    filename: `quotes-${input.tab}-${formatDate(now).replace(/\s+/g, "-").toLowerCase()}.csv`,
    csv: BOM + lines.join("\r\n") + "\r\n",
    rows: rows.length,
  };
}
