import { requireStaff } from "@/lib/auth/staff";
import { chartPeriods, overviewPeriodFor, PICKER_MONTHS } from "@/lib/console/overview";
import { previousPeriod, type RevenuePeriod } from "@/lib/billing/revenue-period";
import { quotedValueBySector, quotedValueByWindow, type QuotedValue } from "@/lib/quote/quoted-value";
import { sectors as readSectors } from "@/lib/taxonomy/sector";
import { formatAED, formatCount, formatMonth } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { PeriodMenu } from "../revenue/PeriodMenu";

/**
 * `/admin/quotes` — where board 4a's *Quoted value* tile goes.
 *
 * The figure had no owner and no destination: the data model defines
 * `quotedValue` as the sum of accepted quote lines, labelled self-reported, and
 * the overview drew a tile for it without a link, which B1 forbids. This is the
 * smallest honest destination: the same sum, split by the supplier's sector and
 * by month, from the same function the tile reads.
 *
 * **Counts and sums, and nobody named.** No buyer, no supplier, no quote. A
 * list of which supplier quoted whom at what price would be the *see another
 * business's enquiries* row of §07 — possible for staff only with an audit row
 * and a reason — and nothing on this page needs it.
 *
 * Any staff seat may read it, as any may read the overview. It is never money
 * the platform holds, and it says so above the tables rather than in a footnote.
 */

export const dynamic = "force-dynamic";

function money(fils: number): string {
  return formatAED(fils / 100, { style: fils % 100 === 0 ? "display" : "exact" });
}

const TH = "px-3 py-2 font-mono text-colhead font-medium uppercase text-body";

export default async function QuotedValuePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const seat = await requireStaff();
  const { period: requested } = await searchParams;
  const now = new Date();
  const period = overviewPeriodFor(requested ?? null, now);
  const months = chartPeriods(period, now).reverse();

  const [bySector, byMonth, sectorRows, badges] = await Promise.all([
    quotedValueBySector(period.from, period.to),
    quotedValueByWindow(months.map((month) => ({ key: month.key, from: month.from, to: month.to }))),
    readSectors(),
    getAdminNavBadges(seat),
  ]);

  const month = formatMonth(period.from);
  const total: QuotedValue = bySector.reduce(
    (sum, row) => ({ fils: sum.fils + row.fils, quotes: sum.quotes + row.quotes, proposals: sum.proposals + row.proposals }),
    { fils: 0, quotes: 0, proposals: 0 },
  );
  const sectorName = new Map(sectorRows.map((sector) => [sector.id, sector.name]));

  const options: RevenuePeriod[] = [];
  let cursor = overviewPeriodFor(null, now);
  while (options.length < PICKER_MONTHS) {
    options.push(cursor);
    cursor = previousPeriod(cursor, now);
  }

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin"
      title={t("admin.quotes.title")}
      eyebrow={t("admin.quotes.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.quotes.meta", {
            amount: money(total.fils),
            month,
            count: total.quotes,
            n: formatCount(total.quotes),
          })}
        </span>
      }
      actions={
        <PeriodMenu
          current={{ key: period.key, label: month, partial: period.partial }}
          options={options.map((option) => ({ key: option.key, label: formatMonth(option.from), partial: option.partial }))}
          basePath="/admin/quotes"
        />
      }
    >
      <div className="flex flex-col gap-[var(--gutter)]">
        <p className="max-w-prose rounded-panel border border-line bg-paper-sunk px-4 py-3 text-body-sm text-body">
          {t("admin.quotes.what")}
        </p>

        <section aria-labelledby="quotes-by-sector" className="overflow-x-auto rounded-panel border border-line bg-card">
          <h2 id="quotes-by-sector" className="px-4 pt-3 text-h3 font-medium text-ink">
            {period.partial ? t("admin.quotes.by_sector_partial", { month }) : t("admin.quotes.by_sector", { month })}
          </h2>
          {bySector.length === 0 ? (
            <p className="px-4 py-3 text-body-sm text-body">{t("admin.quotes.empty", { month })}</p>
          ) : (
            <table className="mt-2 w-full min-w-[32rem] border-collapse text-body-sm">
              <caption className="sr-only">{t("admin.quotes.by_sector", { month })}</caption>
              <thead>
                <tr className="bg-paper-sunk">
                  <th scope="col" className={`${TH} text-start`}>{t("admin.quotes.col.sector")}</th>
                  <th scope="col" className={`${TH} text-end`}>{t("admin.quotes.col.quotes")}</th>
                  <th scope="col" className={`${TH} text-end`}>{t("admin.quotes.col.proposals")}</th>
                  <th scope="col" className={`${TH} text-end`}>{t("admin.quotes.col.value")}</th>
                </tr>
              </thead>
              <tbody>
                {bySector.map((row) => (
                  <tr key={row.sectorId ?? "unfiled"} className="border-t border-fill">
                    <th scope="row" className="px-3 py-2 text-start font-normal text-ink">
                      {row.sectorId ? (sectorName.get(row.sectorId) ?? t("admin.quotes.unfiled")) : t("admin.quotes.unfiled")}
                    </th>
                    <td className="px-3 py-2 text-end tabular-nums text-ink">{formatCount(row.quotes)}</td>
                    <td className="px-3 py-2 text-end tabular-nums text-ink">{formatCount(row.proposals)}</td>
                    <td className="px-3 py-2 text-end tabular-nums text-ink">{money(row.fils)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line">
                  <th scope="row" className="px-3 py-2 text-start font-medium text-ink">{t("admin.quotes.total")}</th>
                  <td className="px-3 py-2 text-end font-medium tabular-nums text-ink">{formatCount(total.quotes)}</td>
                  <td className="px-3 py-2 text-end font-medium tabular-nums text-ink">{formatCount(total.proposals)}</td>
                  <td className="px-3 py-2 text-end font-medium tabular-nums text-ink">{money(total.fils)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <section aria-labelledby="quotes-by-month" className="overflow-x-auto rounded-panel border border-line bg-card">
          <h2 id="quotes-by-month" className="px-4 pt-3 text-h3 font-medium text-ink">
            {t("admin.quotes.by_month")}
          </h2>
          <table className="mt-2 w-full min-w-[32rem] border-collapse text-body-sm">
            <caption className="sr-only">{t("admin.quotes.by_month")}</caption>
            <thead>
              <tr className="bg-paper-sunk">
                <th scope="col" className={`${TH} text-start`}>{t("admin.quotes.col.month")}</th>
                <th scope="col" className={`${TH} text-end`}>{t("admin.quotes.col.quotes")}</th>
                <th scope="col" className={`${TH} text-end`}>{t("admin.quotes.col.proposals")}</th>
                <th scope="col" className={`${TH} text-end`}>{t("admin.quotes.col.value")}</th>
              </tr>
            </thead>
            <tbody>
              {months.map((entry) => {
                const figure = byMonth.get(entry.key)!;
                return (
                  <tr key={entry.key} className="border-t border-fill">
                    <th scope="row" className="px-3 py-2 text-start font-normal text-ink">
                      {entry.partial
                        ? t("admin.quotes.month_partial", { month: formatMonth(entry.from) })
                        : formatMonth(entry.from)}
                    </th>
                    <td className="px-3 py-2 text-end tabular-nums text-ink">{formatCount(figure.quotes)}</td>
                    <td className="px-3 py-2 text-end tabular-nums text-ink">{formatCount(figure.proposals)}</td>
                    <td className="px-3 py-2 text-end tabular-nums text-ink">{money(figure.fils)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
    </AdminPage>
  );
}
