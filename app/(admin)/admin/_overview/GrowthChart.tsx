import { useId } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { ChartScreen } from "./present";

/**
 * *Supply and demand*, twelve months — D-CHART, the owner's answer of 1 Oct 2026.
 *
 * The export drew three series stacked into one column: new claims, upgrades
 * and churn. It plotted no demand under a title naming it, added churn to the
 * height of growth, had no axis, and from March overflowed its own plot, so the
 * last six months rendered at an identical 136px. Here:
 *
 *   - **Supply** stacks above the axis: new claims, then upgrades on top.
 *   - **Demand** stands beside it: RFQs that month, its own bar.
 *   - **Churn** hangs below the axis, so a month that lost accounts is drawn
 *     lower rather than taller.
 *   - **One scale**, from `chartGeometry`: both sides of the axis are cut at the
 *     same step, a y-axis prints the values, and no bar can pass its ceiling.
 *
 * Every number is also in the table under the chart, because a chart that is
 * the only carrier of its values is one a screen reader cannot read.
 */

const PLOT_PX = 160;

/** Below this, a tick label under the axis would overlap the zero above it. */
const DOWN_LABEL_MIN_PX = 14;

export function GrowthChart({
  chart,
  legendLabel,
  specimen = false,
}: {
  chart: ChartScreen;
  legendLabel: string;
  /** A gallery specimen: no landmark role, so several can share a page. */
  specimen?: boolean;
}) {
  const titleId = useId();
  const down = 100 - chart.upShare;
  const hasDown = chart.downTicks.length > 0;
  /*
     One scale means a little churn gets a little room — seven cancellations
     under a three-hundred axis is a few pixels — and a label there would sit
     on top of the zero. The bars below the axis are still drawn, and every
     value is in the table under the chart.
  */
  const labelDown = (PLOT_PX * down) / 100 >= DOWN_LABEL_MIN_PX;
  const Region = specimen ? "div" : "section";

  return (
    <Region {...(specimen ? {} : { "aria-labelledby": titleId })} className="rounded-card-lg border border-line bg-card px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={titleId} className="text-h3 font-medium text-ink">
          {chart.title}
        </h2>
        <ul aria-label={legendLabel} className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-1 p-0 text-caption text-body">
          <LegendItem swatch="bg-moss" label={t("overview.chart.claims")} />
          <LegendItem swatch="bg-moss-muted" label={t("overview.chart.upgrades")} />
          <LegendItem swatch="bg-info" label={t("overview.chart.rfqs")} />
          <LegendItem swatch="bg-warn" label={t("overview.chart.churn")} />
        </ul>
      </div>

      <figure className="m-0 mt-4">
        <div className="flex gap-2" aria-hidden="true">
          {/* The y-axis, one scale above and below. */}
          <div className="relative w-9 shrink-0" style={{ height: PLOT_PX }}>
            {chart.ticks.map((tick) => (
              <span
                key={`up-${tick.value}`}
                className="absolute end-0 -translate-y-1/2 font-mono text-eyebrow tabular-nums text-muted"
                style={{ top: `${chart.upShare * (1 - tick.pct / 100)}%` }}
              >
                {tick.value}
              </span>
            ))}
            {(labelDown ? chart.downTicks : []).map((tick) => (
              <span
                key={`down-${tick.value}`}
                className="absolute end-0 -translate-y-1/2 font-mono text-eyebrow tabular-nums text-muted"
                style={{ top: `${chart.upShare + down * (tick.pct / 100)}%` }}
              >
                {`−${tick.value}`}
              </span>
            ))}
          </div>

          <div className="relative min-w-0 flex-1" style={{ height: PLOT_PX }}>
            {/* Grid lines at each tick, and the axis itself heavier. */}
            {chart.ticks.map((tick) => (
              <span
                key={`grid-${tick.value}`}
                className={cn("absolute inset-x-0 border-t", tick.pct === 0 ? "border-line-strong" : "border-fill")}
                style={{ top: `${chart.upShare * (1 - tick.pct / 100)}%` }}
              />
            ))}
            {chart.downTicks.map((tick) => (
              <span
                key={`grid-down-${tick.value}`}
                className="absolute inset-x-0 border-t border-fill"
                style={{ top: `${chart.upShare + down * (tick.pct / 100)}%` }}
              />
            ))}

            <ol className="absolute inset-0 m-0 grid list-none grid-cols-12 gap-[7px] p-0">
              {chart.bars.map((bar) => (
                <li key={bar.key} className="relative h-full min-w-0">
                  <div
                    className="absolute inset-x-0 top-0 flex items-end justify-center gap-[2px]"
                    style={{ height: `${chart.upShare}%` }}
                  >
                    {/* Supply: claims at the foot, upgrades on top of them. */}
                    <div className="flex h-full w-[55%] flex-col-reverse gap-[2px]">
                      {bar.claimsPct > 0 && (
                        <span className="block w-full rounded-t-[2px] bg-moss" style={{ height: `${bar.claimsPct}%` }} />
                      )}
                      {bar.upgradesPct > 0 && (
                        <span className="block w-full rounded-t-[2px] bg-moss-muted" style={{ height: `${bar.upgradesPct}%` }} />
                      )}
                    </div>
                    {/* Demand, beside it on the same scale. */}
                    <span
                      className={cn("block w-[30%] rounded-t-[2px] bg-info", bar.partial && "opacity-60")}
                      style={{ height: `${bar.rfqsPct}%` }}
                    />
                  </div>
                  {hasDown && (
                    <div className="absolute inset-x-0 bottom-0 flex justify-center gap-[2px]" style={{ height: `${down}%` }}>
                      <span className="block w-[55%] self-start rounded-b-[2px] bg-warn" style={{ height: `${bar.churnPct}%` }} />
                      <span className="block w-[30%]" />
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <ol className="m-0 mt-2 ms-11 grid list-none grid-cols-12 gap-[7px] p-0" aria-hidden="true">
          {chart.bars.map((bar) => (
            /*
               Every third month is labelled, so a label may spill into the
               unlabelled columns either side of it rather than be cut short.
            */
            <li key={bar.key} className="flex min-w-0 justify-center overflow-visible font-mono text-eyebrow uppercase text-muted">
              <span className="whitespace-nowrap">{bar.showLabel ? bar.label : ""}</span>
            </li>
          ))}
        </ol>

        <figcaption className="mt-3 text-caption text-body">{chart.caption}</figcaption>
      </figure>

      <details className="mt-3">
        <summary className="cursor-pointer rounded-tag text-caption text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none">
          {t("overview.chart.show_figures")}
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-caption">
            <caption className="pb-1 text-start text-caption text-muted">{chart.tableCaption}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="py-1 pe-3 text-start font-mono text-colhead uppercase text-body">
                  {t("overview.chart.col.month")}
                </th>
                {(["claims", "upgrades", "rfqs", "churn"] as const).map((key) => (
                  <th key={key} scope="col" className="py-1 ps-3 text-end font-mono text-colhead uppercase text-body">
                    {t(`overview.chart.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.bars.map((bar) => (
                <tr key={bar.key} className="border-b border-fill">
                  <th scope="row" className="py-1 pe-3 text-start font-normal text-body">
                    {bar.partial ? t("overview.chart.month_partial", { month: bar.label }) : bar.label}
                  </th>
                  <td className="py-1 ps-3 text-end tabular-nums text-ink">{bar.claims}</td>
                  <td className="py-1 ps-3 text-end tabular-nums text-ink">{bar.upgrades}</td>
                  <td className="py-1 ps-3 text-end tabular-nums text-ink">{bar.rfqs}</td>
                  <td className="py-1 ps-3 text-end tabular-nums text-ink">{bar.churn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Region>
  );
}

function LegendItem({ swatch, label }: { swatch: string; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("inline-block size-[9px] rounded-[2px]", swatch)} />
      {label}
    </li>
  );
}
