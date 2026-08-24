import { ShareBars, StatCard } from "@/components/display";
import { Card, Panel } from "@/components/structure";
import { getAnalytics } from "@/lib/db/queries/analytics";
import { assertCanReadAnalytics } from "@/lib/auth/guards";
import { formatCount, formatPercent } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";

/**
 * Board 3l — analytics.
 *
 * Everything here is counted from rows over the same ninety-day window the
 * response-time job uses. Nothing is estimated, so an empty period renders as
 * an empty state that says so rather than a flat line that looks like data.
 *
 * Not visible to the sales seat. The per-person response stats next door
 * include the uncomfortable one, and a seat being measured is not the seat that
 * should choose what the measurement says.
 */
export const metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const seat = await requireSellerSeat();
  assertCanReadAnalytics(seat.actor);

  const [analytics, badges] = await Promise.all([
    getAnalytics(seat.businessId),
    getNavBadges(seat.businessId),
  ]);

  const empty = analytics.received === 0;

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/analytics"
      eyebrow={t("analytics.eyebrow")}
      title={t("analytics.title")}
      meta={<span className="font-mono text-caption text-muted">{t("analytics.window")}</span>}
    >
      <div className="flex flex-col gap-5">
        <p className="max-w-prose text-body-sm text-muted">{t("analytics.intro")}</p>

        {empty ? (
          <Card padded>
            <h2 className="text-h3 text-ink">{t("analytics.no_data")}</h2>
            <p className="mt-2 max-w-prose text-body-sm text-muted">{t("analytics.no_data_body")}</p>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatCard label={t("analytics.enquiries")} value={formatCount(analytics.received)} hero />
              <StatCard
                label={t("analytics.quoted")}
                value={formatCount(analytics.quoted)}
                caption={`${formatPercent(analytics.quoted / analytics.received)} ${t("analytics.quote_rate")}`}
                hero
              />
              <StatCard
                label={t("analytics.accepted")}
                value={formatCount(analytics.accepted)}
                caption={
                  analytics.quoted > 0
                    ? `${formatPercent(analytics.accepted / analytics.quoted)} ${t("analytics.accept_rate")}`
                    : undefined
                }
                hero
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Panel title={t("analytics.by_area")}>
                {analytics.byArea.length === 0 ? (
                  <p className="text-body-sm text-muted">{t("analytics.no_data")}</p>
                ) : (
                  <ShareBars
                    label={t("analytics.by_area")}
                    rows={analytics.byArea.map((slice) => ({
                      key: slice.label,
                      label: slice.label,
                      value: slice.count,
                      valueLabel: formatCount(slice.count),
                    }))}
                  />
                )}
              </Panel>

              <Panel title={t("analytics.by_category")}>
                {analytics.byCategory.length === 0 ? (
                  <p className="text-body-sm text-muted">{t("analytics.no_data")}</p>
                ) : (
                  <ShareBars
                    label={t("analytics.by_category")}
                    rows={analytics.byCategory.map((slice) => ({
                      key: slice.label,
                      label: slice.label,
                      value: slice.count,
                      valueLabel: formatCount(slice.count),
                    }))}
                  />
                )}
              </Panel>
            </div>
          </>
        )}
      </div>
    </SellerPage>
  );
}
