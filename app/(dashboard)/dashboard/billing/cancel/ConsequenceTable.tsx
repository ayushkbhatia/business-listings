import { Card } from "@/components/structure";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { ConsequenceMark, ConsequenceRow } from "@/lib/billing/cancel-table";

/**
 * Board 11h's consequence table. Twelve areas, three columns, one date.
 *
 * A real `<table>` with a real `<caption>` and `<th scope>`, because it is one.
 * The design draws tables with divs for layout reasons and the build must not —
 * a reader on a screen reader gets the row header with every cell, which is the
 * only way the third column means anything.
 *
 * ## Meaning never rests on colour
 *
 * Criterion 4. The board's own correction was three colours with no legend, so
 * the mark is three things at once: a **distinct shape**, a **colour**, and a
 * **word** — the word carried in the row's accessible text and spelled out in a
 * legend under the table. Take the colour away and the table still reads.
 *
 * ## Every figure arrives resolved
 *
 * This renders `ConsequenceRow`s and computes nothing. The arithmetic is in
 * `lib/billing/cancel-table.ts`, which is pure and unit-tested — including the
 * part that decides whether a row is `reduced` at all. A seller with four
 * products is told their products are unchanged, because on Free they are.
 */

/** The three marks. Distinct shapes, not three colours of one shape. */
const MARK: Record<ConsequenceMark, { glyph: string; tone: string; label: string }> = {
  unchanged: { glyph: "✓", tone: "text-ok-ink", label: "cancel.mark.unchanged" },
  reduced: { glyph: "▪", tone: "text-warn-ink", label: "cancel.mark.reduced" },
  ends: { glyph: "✕", tone: "text-bad-ink", label: "cancel.mark.ends" },
};

const ORDER: ConsequenceMark[] = ["unchanged", "reduced", "ends"];

export interface ConsequenceTableProps {
  rows: readonly ConsequenceRow[];
  /** The plan the seller is on, for the second column head. */
  planName: string;
  /** The day Free starts, already formatted. The third column is headed by it. */
  freeStartsOn: string;
}

export function ConsequenceTable({ rows, planName, freeStartsOn }: ConsequenceTableProps) {
  return (
    <Card surface="card" padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[42rem] border-collapse text-left">
          <caption className="sr-only">{t("cancel.table_caption")}</caption>
          <thead>
            <tr className="border-b border-line bg-paper-sunk">
              {/*
                 The mark column has a head like any other. An empty `<th>` over
                 a column that carries the table's meaning is a column a screen
                 reader announces as nothing at all.
              */}
              <th scope="col" className="w-9 px-4 py-3">
                <span className="sr-only">{t("cancel.legend_label")}</span>
              </th>
              <th
                scope="col"
                className="px-1 py-3 font-mono text-eyebrow uppercase tracking-[0.09em] font-normal text-muted"
              >
                {t("cancel.col.area")}
              </th>
              <th
                scope="col"
                className="px-3 py-3 font-mono text-eyebrow uppercase tracking-[0.09em] font-normal text-muted"
              >
                {t("cancel.col.now", { plan: planName })}
              </th>
              <th
                scope="col"
                className="px-4 py-3 font-mono text-eyebrow uppercase tracking-[0.09em] font-normal text-muted"
              >
                {t("cancel.col.free", { when: freeStartsOn })}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const mark = MARK[row.mark];
              return (
                <tr key={row.key} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-3 align-top">
                    <span aria-hidden="true" className={cn("text-caption", mark.tone)}>
                      {mark.glyph}
                    </span>
                    {/*
                       The word, for anyone who cannot see the shape. It is the
                       same word the legend spells out, so the two cannot drift.
                    */}
                    <span className="sr-only">{t(mark.label as "cancel.mark.unchanged")}</span>
                  </td>
                  <th
                    scope="row"
                    className="px-1 py-3 text-left align-top text-caption font-normal text-ink"
                  >
                    {row.area}
                  </th>
                  <td className="px-3 py-3 align-top text-caption text-body-ink">{row.now}</td>
                  <td className="px-4 py-3 align-top text-caption text-body-ink">
                    {row.freeLead && (
                      <span className="font-medium text-ink">{row.freeLead}</span>
                    )}
                    {row.freeLead ? ` · ${row.free}` : row.free}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/*
         The legend is part of the table, not a footnote beside it. Without it
         the marks are three colours and colour is the only cue — which is the
         board's own eleventh correction and criterion 4.
      */}
      <ul
        aria-label={t("cancel.legend_label")}
        className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-line bg-paper-sunk px-4 py-2.5"
      >
        {ORDER.map((key) => (
          <li key={key} className="flex items-center gap-1.5 text-caption text-body-ink">
            <span aria-hidden="true" className={MARK[key].tone}>
              {MARK[key].glyph}
            </span>
            {t(MARK[key].label as "cancel.mark.unchanged")}
          </li>
        ))}
      </ul>
    </Card>
  );
}
