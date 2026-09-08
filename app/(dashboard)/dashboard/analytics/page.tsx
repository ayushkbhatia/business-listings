import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonClassName } from "@/components/primitives";
import { Card, Panel } from "@/components/structure";
import { analyticsSummary, type AnalyticsSummary, type ProductRow, type QueryRow } from "@/lib/analytics/summary";
import type { FunnelStage } from "@/lib/analytics/model";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { mayReadAnalytics } from "@/lib/auth/guards";
import { formatCount, formatDateShort, formatPercent } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { Delta } from "./Delta";

/**
 * Board `3l` — analytics.
 *
 * ## Two rules, and every correction follows from them
 *
 * **Every number is a comparison or it is decoration.** A count with nothing
 * beside it cannot answer the only question a seller opens this page to ask:
 * did what I did last month work. So every stage, product row and region
 * carries its change, and `Delta` renders *no comparison yet* where there is
 * none rather than nothing at all.
 *
 * **It has to be worth the click from `3a`.** The shipped dashboard card
 * already shows a position, a movement and a cause. A seller who clicks it and
 * lands on a page with position alone has been sent backwards.
 *
 * ## The bars are the share carried from the stage above
 *
 * The board's largest correction, and criterion 1. It drew 4,182 at 38% of the
 * width when it is 14.7% of the stage above, and 109 at 5% when it is 0.4% of
 * the top — every bar below the first overstating its stage by 3 to 13 times,
 * on the one page whose whole job is to be accurate about proportions. Drawn
 * against the top of the funnel instead, the last two bars are four pixels
 * wide and unreadable.
 *
 * The arithmetic is in `lib/analytics/model.ts`, which is pure and unit-tested
 * against the board's own stated rates.
 */
export const metadata = { title: t("analytics.title") };
export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const seat = await requireSellerSeat();

  /*
     Two gates, and they refuse differently on purpose.

     A seat without `analytics.read` is a finance seat, for whom this screen
     does not exist — `notFound`, the same answer `11f` gives. A seller on a
     plan without analytics is a different case entirely: the feature exists,
     they are being asked to pay for it, and the honest destination is the
     screen that sells it with the reason named. Board `3l` states the redirect;
     `11f`'s tier table is what decides, and it says Basic.
  */
  if (!mayReadAnalytics(seat.actor)) notFound();

  const caps = await effectiveFor(seat.businessId);
  if (caps && !caps.analytics) redirect("/dashboard/billing/change?locked=analytics");

  const [summary, badges] = await Promise.all([
    analyticsSummary(seat.actor, seat.businessId),
    getNavBadges(seat.businessId),
  ]);
  if (!summary) notFound();

  const window = t("analytics.window", {
    from: `${formatDateShort(summary.window.from)}–${formatDateShort(new Date(summary.window.to.getTime() - 86_400_000))}`,
    previous: `${formatDateShort(summary.window.previousFrom)}–${formatDateShort(new Date(summary.window.previousTo.getTime() - 86_400_000))}`,
  });

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/analytics"
      eyebrow={t("analytics.eyebrow")}
      title={t("analytics.title")}
      meta={<span className="font-mono text-caption text-muted">{window}</span>}
      actions={
        /*
           The button says what it writes. It read `Export CSV` on the board
           with no scope at all, leaving a seller to guess whether they were
           about to download five rows or five hundred thousand — spec Q5, whose
           answer is the aggregates on this page and never the raw events.
        */
        <Link
          href="/dashboard/analytics/export"
          prefetch={false}
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          {t("analytics.export")}
        </Link>
      }
    >
      {summary.noData ? (
        <NoData />
      ) : (
        <div className="flex flex-col gap-[var(--gutter)]">
          {/*
             Week one is a normal page with its comparisons suppressed, and the
             spec is explicit that it is **not an error state**. It is the state
             this board will spend its first month in.
          */}
          {summary.weekOne && (
            <Card surface="paper" padded>
              <p className="max-w-prose text-caption leading-relaxed text-body-ink">
                {t("analytics.week_one")}
              </p>
            </Card>
          )}

          <div className="grid gap-4 xl:grid-cols-2">
            <FunnelPanel summary={summary} />
            <QueriesPanel summary={summary} />
            <ProductsPanel summary={summary} />
            <RegionsPanel summary={summary} />
          </div>
        </div>
      )}
    </SellerPage>
  );
}

/**
 * Nothing measured at all.
 *
 * Every cause of an empty analytics page is a setup gap, which is why this
 * sends the seller to `8a` rather than explaining a chart they cannot fill.
 * It also says the thing a seller would otherwise discover a month later: the
 * first three stages are counted from the day tracking starts and cannot be
 * filled in backwards.
 */
function NoData() {
  return (
    <Card padded>
      <h2 className="text-h3 text-ink">{t("analytics.no_data")}</h2>
      <p className="mt-2 max-w-prose text-body-sm leading-relaxed text-muted">
        {t("analytics.no_data_body")}
      </p>
      <Link href="/dashboard/setup" className={`${buttonClassName({ size: "sm" })} mt-3.5`}>
        {t("analytics.no_data_action")}
      </Link>
    </Card>
  );
}

/** 1 · Where buyers drop off. */
function FunnelPanel({ summary }: { summary: AnalyticsSummary }) {
  return (
    <Panel
      title={t("analytics.funnel.title")}
      description={t("analytics.funnel.bars")}
      padded
    >
      {/*
         Stages, not one path. A buyer can send an enquiry without ever
         revealing a phone number, so a strict funnel reading of these five rows
         is wrong — and the two were one bucket on the board, in the step where
         the difference decides what a seller should fix.
      */}
      <p className="max-w-prose text-caption leading-relaxed text-muted">
        {t("analytics.funnel.note")}
      </p>

      <ul className="mt-4 flex flex-col gap-3.5">
        {summary.stages.map((stage) => (
          <Stage key={stage.key} stage={stage} />
        ))}
      </ul>

      {summary.median && (
        <p className="mt-4 border-t border-line-soft pt-3.5 text-caption leading-relaxed text-body-ink">
          {t("analytics.median", {
            yours: formatPercent(summary.median.yours, { decimals: 1 }),
            median: formatPercent(summary.median.median, { decimals: 1 }),
            category: "",
            emirate: "",
          })}{" "}
          <span className="text-muted">
            {t("analytics.median_cohort", { count: formatCount(summary.median.cohortSize) })}
          </span>
        </p>
      )}
    </Panel>
  );
}

function Stage({ stage }: { stage: FunnelStage }) {
  /*
     The bar width **is** the carried share. The first stage has nothing above
     it, so it is full width — it is the population every rate below is measured
     against, not a proportion of anything.

     A share **above** 100% is real and not a bug. These are stages and not one
     path: a buyer can send an enquiry without ever revealing a number, so more
     people can do a later thing than the earlier one above it. The bar cannot
     draw past full, so where that happens it is drawn full and the row says
     `over` beside the figure — the number stays true and the bar stops being
     asked to express something it cannot.
  */
  const over = stage.carried !== null && stage.carried > 1;
  const width = stage.carried === null ? 1 : Math.min(1, stage.carried);

  return (
    <li>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-caption text-body-ink">
          {t(`analytics.stage.${stage.key}` as "analytics.stage.clicks")}{" "}
          {stage.carried !== null && (
            <>
              <span className="font-medium text-ink">
                {formatPercent(stage.carried, { decimals: 1 })}
              </span>
              {over && <span className="text-muted"> {t("analytics.funnel.over")}</span>}
            </>
          )}
        </span>
        <span className="shrink-0 text-caption tabular-nums text-ink">
          {formatCount(stage.count)} <Delta delta={stage.delta} />
        </span>
      </div>
      {/*
         `aria-hidden`, because the bar carries nothing the line above does not
         already say in words. A progressbar role here would make a screen
         reader announce the same proportion twice.
      */}
      <div aria-hidden="true" className="mt-1.5 h-2.5 w-full rounded-pill bg-track">
        <div
          className="h-full rounded-pill bg-moss"
          style={{ width: `${Math.max(0.5, width) * 100}%` }}
        />
      </div>
    </li>
  );
}

/** 2 · What buyers searched to reach you. */
function QueriesPanel({ summary }: { summary: AnalyticsSummary }) {
  return (
    <Panel
      title={t("analytics.queries.title")}
      description={t("analytics.queries.note", { days: formatCount(summary.window.days) })}
      padded={summary.queries.length === 0}
    >
      {summary.queries.length === 0 ? (
        <p className="text-caption text-muted">{t("analytics.queries.none")}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-caption">
              <caption className="sr-only">{t("analytics.queries.caption")}</caption>
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2.5 font-mono text-eyebrow uppercase tracking-[0.09em] font-normal text-muted">
                    {t("analytics.queries.col.query")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-mono text-eyebrow uppercase tracking-[0.09em] font-normal text-muted">
                    {t("analytics.queries.col.volume")}
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-mono text-eyebrow uppercase tracking-[0.09em] font-normal text-muted">
                    {t("analytics.queries.col.position")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {summary.queries.map((row) => (
                  <QueryLine key={row.query} row={row} />
                ))}
              </tbody>
            </table>
          </div>

          {/*
             Demand only. "88 buyers searched X and you have no product listed
             for it" is ours to say; "you stock them" was not — nothing in the
             product knows a seller's unlisted inventory, and the board asserted
             it anyway. Build note `B6`.
          */}
          {summary.demandGap && (
            <p className="mt-3.5 rounded-ctl border border-warn-line bg-warn-surface px-3.5 py-2.5 text-caption leading-relaxed text-warn-ink">
              {t("analytics.gap", {
                count: formatCount(summary.demandGap.volume),
                query: summary.demandGap.query,
              })}{" "}
              <Link
                href="/dashboard/products/new"
                className="rounded-tag font-medium underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("analytics.gap_action")}
              </Link>{" "}
              {t("analytics.gap_if")}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

function QueryLine({ row }: { row: QueryRow }) {
  return (
    <tr className="border-b border-line-soft last:border-0">
      <th scope="row" className="px-4 py-2.5 text-left font-normal text-ink">
        {row.query}
      </th>
      <td className="px-3 py-2.5 text-right tabular-nums text-body-ink">
        {formatCount(row.volume)}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums">
        {row.position === null ? (
          /*
             Not ranked is a state, not a bad rank. The board coloured `n/a` the
             same red as `#14`, which reads as the worst position on the page
             rather than as an absence — criterion 4.
          */
          <span className="text-muted">{t("analytics.queries.not_ranked")}</span>
        ) : (
          <span className="text-ink">
            #{formatCount(row.position)} <Delta delta={row.movement} better="down" />
          </span>
        )}
      </td>
    </tr>
  );
}

/** 3 · Top products by enquiry. */
function ProductsPanel({ summary }: { summary: AnalyticsSummary }) {
  return (
    <Panel
      title={t("analytics.products.title")}
      description={t("analytics.products.note", { days: formatCount(summary.window.days) })}
      padded={summary.products.length === 0}
    >
      {summary.products.length === 0 ? (
        <p className="text-caption text-muted">{t("analytics.products.none")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-caption">
            <caption className="sr-only">{t("analytics.products.caption")}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-2.5 font-mono text-eyebrow uppercase tracking-[0.09em] font-normal text-muted">
                  {t("analytics.products.col.product")}
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-mono text-eyebrow uppercase tracking-[0.09em] font-normal text-muted">
                  {t("analytics.products.col.views")}
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-mono text-eyebrow uppercase tracking-[0.09em] font-normal text-muted">
                  {t("analytics.products.col.enquiries")}
                </th>
                <th scope="col" className="px-4 py-2.5 text-right font-mono text-eyebrow uppercase tracking-[0.09em] font-normal text-muted">
                  {t("analytics.products.col.conversion")}
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.products.map((row) => (
                <ProductLine key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function ProductLine({ row }: { row: ProductRow }) {
  return (
    <tr className="border-b border-line-soft last:border-0">
      <th scope="row" className="px-4 py-2.5 text-left font-normal text-ink">
        <Link
          href={`/dashboard/products/${row.id}`}
          className="rounded-tag underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {row.name}
        </Link>
        {/*
           Two flags, both carried from elsewhere in the product rather than
           invented here — no cover photo is `3i`'s, the stock duration is
           `3g`'s. Both are causes a seller can act on, which is the only reason
           a flag belongs on an analytics row.
        */}
        {row.noCoverPhoto && (
          <span className="text-warn-ink"> · {t("analytics.products.no_cover")}</span>
        )}
        {row.outOfStockDays !== null && (
          <span className="text-bad-ink">
            {" "}
            · {t("analytics.products.out_of_stock", { days: formatCount(row.outOfStockDays) })}
          </span>
        )}
      </th>
      <td className="px-3 py-2.5 text-right tabular-nums text-body-ink">
        {formatCount(row.views)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-body-ink">
        {formatCount(row.enquiries)}
      </td>
      <td className="px-4 py-2.5 text-right tabular-nums text-ink">
        {row.conversion === null ? "—" : formatPercent(row.conversion, { decimals: 1 })}{" "}
        <Delta delta={row.delta} />
      </td>
    </tr>
  );
}

/** 4 · Where enquiries come from, and what they arrived on. */
function RegionsPanel({ summary }: { summary: AnalyticsSummary }) {
  const devices = summary.devices;

  return (
    <Panel title={t("analytics.regions.title")} padded>
      {summary.regions.length === 0 ? (
        <p className="text-caption text-muted">{t("analytics.regions.none")}</p>
      ) : (
        <ul aria-label={t("analytics.regions.label")} className="flex flex-col gap-3">
          {summary.regions.map((row) => (
            <li key={row.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-caption text-body-ink">
                  {/*
                     `Not stated` is a row, not a hidden remainder. Suppressing
                     it would make the shares above add to 100% of a number that
                     is not the total — the padding rule at its quietest.
                  */}
                  {row.key === "not_stated"
                    ? t("analytics.regions.not_stated")
                    : t(`emirate.${row.key}` as "emirate.dubai")}
                </span>
                <span className="shrink-0 text-caption tabular-nums text-ink">
                  {formatPercent(row.share, { decimals: 1 })} <Delta delta={row.delta} />
                </span>
              </div>
              <div aria-hidden="true" className="mt-1.5 h-2 w-full rounded-pill bg-track">
                <div
                  className="h-full rounded-pill bg-moss"
                  style={{ width: `${Math.max(0.5, row.share * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/*
         The device split stays on the page, deliberately. 68% mobile against a
         buyer web designed at 1440px is uncomfortable, and it is the strongest
         argument in the product for the mobile pass named on the flow map. It
         is true, it is measured, and taking it off the page would be the only
         reason to.
      */}
      <div className="mt-4 border-t border-line-soft pt-3.5">
        <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
          {t("analytics.device")}
        </p>
        {devices.total === 0 ? (
          <p className="mt-2 text-caption text-muted">{t("analytics.device.none")}</p>
        ) : (
          <dl className="mt-2.5 flex flex-wrap gap-x-8 gap-y-2">
            {(["mobile", "desktop", "tablet"] as const).map((kind) => (
              <div key={kind}>
                <dd className="text-h2 font-medium tracking-[-0.02em] tabular-nums text-ink">
                  {formatPercent(devices[kind] / devices.total)}
                </dd>
                <dt className="text-caption text-muted">{t(`analytics.device.${kind}` as "analytics.device.mobile")}</dt>
              </div>
            ))}
          </dl>
        )}
      </div>
    </Panel>
  );
}
