import { MovementBars, StatCard } from "@/components/display";
import { Panel } from "@/components/structure";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { PlanMixTable } from "./PlanMixTable";
import type { RevenueView } from "./present";

/**
 * Board 4g — the board itself, from strings `present.ts` already wrote.
 *
 * No arithmetic and no data access, so the page and the gallery render the
 * same markup for the same month, and a state drawn in the gallery is a state
 * the page can reach.
 */

const REASON_BAR = {
  bad: "bg-bad",
  warn: "bg-warn",
  neutral: "bg-moss-muted",
} as const;

export function RevenueCards({ cards }: { cards: RevenueView["cards"] }) {
  return (
    <div className="grid gap-[var(--gutter)] sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((card) => (
        <StatCard
          key={card.key}
          face="sans"
          label={card.label}
          value={card.value}
          caption={card.caption}
          delta={card.delta}
          note={card.note}
        />
      ))}
    </div>
  );
}

export function WaterfallBody({ waterfall }: { waterfall: RevenueView["waterfall"] }) {
  if (waterfall.empty) {
    return (
      <div className="py-8 text-center">
        <p className="text-body-sm text-body">{t("admin.revenue.empty.title")}</p>
        <p className="mx-auto mt-1 max-w-prose text-caption text-muted">{t("admin.revenue.empty.body")}</p>
      </div>
    );
  }
  return (
    <MovementBars rows={waterfall.rows} label={t("admin.revenue.waterfall_label")} scaleNote={t("admin.revenue.waterfall_scale")} />
  );
}

export function ReasonsBody({ reasons }: { reasons: RevenueView["reasons"] }) {
  return (
    <>
      {reasons.clear ? (
        <p className="text-body-sm text-body">{reasons.clear}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {reasons.rows.map((row) => (
            <li key={row.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-body-sm text-ink">{row.label}</span>
                <span className="text-body-sm tabular-nums text-ink">{row.count}</span>
              </div>
              <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-pill bg-track" aria-hidden="true">
                <span className={cn("block h-full rounded-pill", REASON_BAR[row.tone])} style={{ width: `${row.share}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {reasons.finding ? <p className="mt-4 rounded-card bg-fill p-3 text-body-sm text-body">{reasons.finding}</p> : null}

      {reasons.lapsed || reasons.closures ? (
        <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0">
          {reasons.lapsed ? <li className="text-caption text-muted">{reasons.lapsed}</li> : null}
          {reasons.closures ? <li className="text-caption text-muted">{reasons.closures}</li> : null}
        </ul>
      ) : null}
    </>
  );
}

export function EmiratesBody({ emirates, caption }: { emirates: RevenueView["emirates"]; caption?: string }) {
  if (emirates.empty) return <p className="text-body-sm text-body">{t("admin.revenue.emirates.empty")}</p>;
  return (
    <table className="w-full border-collapse text-body-sm">
      <caption className="sr-only">{caption ?? emirates.title}</caption>
      {/*
         Visible, in the console's column-head style. A visually hidden thead is
         laid out apart from the body, so its cells sit nowhere near the columns
         they name — which the gallery's alignment check measures and refuses.
      */}
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className="pb-1.5 text-start font-mono text-eyebrow font-normal uppercase text-faint">
            {t("admin.revenue.emirates.col.emirate")}
          </th>
          <th scope="col" className="pb-1.5 text-end font-mono text-eyebrow font-normal uppercase text-faint">
            {t("admin.revenue.emirates.col.mrr")}
          </th>
          <th scope="col" className="pb-1.5 text-end font-mono text-eyebrow font-normal uppercase text-faint">
            {t("admin.revenue.emirates.col.share")}
          </th>
        </tr>
      </thead>
      <tbody>
        {emirates.rows.map((row) => (
          <tr key={row.key}>
            <th scope="row" className="py-1.5 text-start font-normal text-ink">
              {row.label}
            </th>
            <td className="py-1.5 text-end font-mono tabular-nums text-ink">{row.amount}</td>
            <td className="w-16 py-1.5 text-end font-mono tabular-nums text-muted">{row.share}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The whole board, with its titled panels. Page chrome, so the page renders it
 * once; the gallery renders the bodies above instead, because a titled panel is
 * a landmark and the gallery shows every state of it.
 */
export function RevenueBoardView({ view }: { view: RevenueView }) {
  return (
    <>
      <RevenueCards cards={view.cards} />

      <div className="mt-[var(--gutter)] grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <Panel
          title={view.waterfall.title}
          description={t("admin.revenue.waterfall_description")}
          footer={<p className="max-w-prose text-body-sm text-body">{view.waterfall.nrr}</p>}
        >
          <WaterfallBody waterfall={view.waterfall} />
        </Panel>

        <div className="flex min-w-0 flex-col gap-[var(--gutter)]">
          <Panel title={view.reasons.title}>
            <ReasonsBody reasons={view.reasons} />
          </Panel>
          <Panel title={view.emirates.title} description={t("admin.revenue.emirates.description")}>
            <EmiratesBody emirates={view.emirates} />
          </Panel>
        </div>
      </div>

      <div className="mt-[var(--gutter)]">
        <Panel title={view.plans.title}>
          <PlanMixTable rows={view.plans.rows} caption={view.plans.title} />
        </Panel>
      </div>

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">{t("admin.revenue.definition")}</p>
    </>
  );
}
