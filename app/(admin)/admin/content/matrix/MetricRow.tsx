import { StatCard } from "@/components/display";
import { formatCount } from "@/lib/format";
import type { Metric } from "@/lib/content/metrics";
import { t } from "@/lib/i18n";

/**
 * Board 6f §3 — five cards.
 *
 * Every number on the board's render was hardcoded, and two of them were the
 * same number used for two different conditions. Thin supply and thin copy have
 * different owners and different remedies, so they are two cards here.
 *
 * Two of the five have no source in this product and say so. There is no
 * analytics or Search Console import — nothing that could be summed into
 * "organic sessions vs prior month" without inventing it — so they render the
 * grey "Not recorded" the interface-honesty rules ask for, with the reason
 * underneath. A plausible figure would be the most quietly damaging thing on a
 * screen whose only asset is that its numbers are true.
 *
 * "Below their need" rather than "unindexed": those pages were never generated.
 * There is no URL, no `noindex`, nothing in the sitemap and no crawl budget
 * spent, and "unindexed" would imply a live page being hidden at a scale of
 * a hundred and forty.
 */
export function MetricRow({ metrics }: { metrics: readonly Metric[] }) {
  return (
    <ul className="grid gap-[var(--gutter)] sm:grid-cols-2 xl:grid-cols-5">
      {metrics.map((metric) => (
        <li key={metric.key}>
          <StatCard
            label={t(`matrix.metric.${metric.key}` as never)}
            value={metric.value === null ? t("matrix.metric.not_recorded") : formatCount(metric.value)}
            caption={
              metric.absent === "no_analytics"
                ? t("matrix.metric.no_analytics")
                : metric.delta !== null
                  ? t("matrix.metric.this_month", { count: formatCount(metric.delta) })
                  : undefined
            }
          />
        </li>
      ))}
    </ul>
  );
}
