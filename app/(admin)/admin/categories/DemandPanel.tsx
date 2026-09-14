import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { RFQ_WINDOW_DAYS, type CategoryEditor } from "@/lib/taxonomy/board";

/**
 * Board 4d — the demand signal: whether a category earns its page.
 *
 * Four figures, every one a query (`B1`): listings (the tree's own figure for
 * this row), what those listings offer, RFQs in the last thirty days, and how
 * many of the listings are paying. *1,104 RFQs a month against 118 paying
 * sellers of 341 is a recruitment brief* — the ratio `12d`'s call list reads.
 *
 * `Searches / month` and `Avg spec completeness` were cut from this panel at the
 * client's request after the first export, and are not drawn.
 *
 * A description list, because that is what it is: four terms, each with its
 * value.
 */
export function DemandPanel({ editor, landmark = true }: { editor: CategoryEditor; landmark?: boolean }) {
  const Frame = landmark ? "section" : "div";
  const rows: { term: string; value: string }[] = [
    { term: t("taxonomy.demand.listings"), value: formatCount(editor.demand.listings) },
    {
      term: t(editor.trade.kind === "services" ? "taxonomy.demand.services" : "taxonomy.demand.products"),
      value: formatCount(editor.demand.offerings),
    },
    { term: t("taxonomy.demand.rfqs"), value: formatCount(editor.demand.rfqsPerMonth) },
    {
      term: t("taxonomy.demand.paid"),
      value: t("taxonomy.demand.paid_value", {
        paid: formatCount(editor.demand.paidSellers),
        listings: formatCount(editor.demand.listings),
      }),
    },
  ];

  return (
    <Frame aria-labelledby={landmark ? `demand-${editor.id}` : undefined} className="rounded-panel border border-line bg-paper-sunk p-5">
      <h3 id={`demand-${editor.id}`} className="font-mono text-eyebrow uppercase text-muted">
        {t("taxonomy.demand.title")}
      </h3>
      <dl className="mt-3 flex flex-col gap-2.5">
        {rows.map((row) => (
          <div key={row.term} className="flex items-baseline justify-between gap-4">
            <dt className="text-body-sm text-body">{row.term}</dt>
            <dd className="font-mono text-body-sm tabular-nums text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-caption text-body">
        {t(editor.isSector ? "taxonomy.demand.note_sector" : "taxonomy.demand.note", { days: RFQ_WINDOW_DAYS })}
      </p>
    </Frame>
  );
}
