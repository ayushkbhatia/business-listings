import { ShareBars } from "@/components/display";
import { Panel } from "@/components/structure";
import { formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SeatPerformance } from "@/lib/team/roster";

/**
 * Board 7d §5 — last 30 days by seat.
 *
 * Three corrections from the board, and each one was a number saying something
 * other than what its label claimed.
 *
 * **The window.** The board read `this month`, which is a window nothing else
 * in the product uses — board 3a's card is thirty days, and two cards on two
 * screens counting different stretches of time is how a seller comes to trust
 * neither.
 *
 * **What the bar encodes.** The board put leads in the bar and reply time in
 * the value slot with no label saying so. Both are here, and the legend says
 * which is which.
 *
 * **The total.** The board summed 86 leads against an inbox of 53. The rows
 * here sum to the stated figure by construction, including the row for the
 * leads nobody has answered — a stated count that is not the sum of what is
 * under it is the completeness header that read `18 OF 22` over sixteen rows.
 *
 * The closing line reads the seller's own record back to them, including when
 * it is unflattering. No claim about any other seller appears on this screen.
 */
export function SeatPerformancePanel({
  rows,
  total,
  windowDays,
  ownerIsSlowest,
}: {
  rows: readonly SeatPerformance[];
  total: number;
  windowDays: number;
  ownerIsSlowest: boolean;
}) {
  if (rows.length === 0) {
    return (
      <Panel title={t("team.performance_heading", { days: String(windowDays) })}>
        <p className="max-w-prose text-body-sm text-muted">
          {t("team.performance_none", { days: String(windowDays) })}
        </p>
      </Panel>
    );
  }

  return (
    <Panel title={t("team.performance_heading", { days: String(windowDays) })}>
      <div className="flex flex-col gap-3">
        <ShareBars
          label={t("team.performance_caption")}
          rows={rows.map((row) => ({
            key: row.userId ?? "unanswered",
            label: row.name ?? t("team.performance_unanswered"),
            value: row.leads,
            /*
               The figure beside the bar is the median, not the lead count —
               that is what the bar is. On the unanswered row there is no median
               to state, and the lead count goes in the slot instead, because a
               blank there would read as "measured, and zero".
            */
            valueLabel:
              row.medianReplyMs === null
                ? row.userId === null
                  ? t("team.performance_leads", { count: row.leads })
                  : t("team.unmeasured")
                : formatDuration(row.medianReplyMs),
          }))}
        />

        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <p className="max-w-prose text-caption text-muted">
            {t("team.performance_total", { count: total, days: String(windowDays) })}
          </p>
          <p className="max-w-prose text-caption text-muted">{t("team.performance_legend")}</p>
          {/*
             Said once here and once in the data layer. 7d §5 asks for it because
             somebody will eventually try to reconcile these against the business
             median on the storefront, and there is no weighting that makes them
             reconcile.
          */}
          <p className="max-w-prose text-caption text-muted">{t("team.performance_compose")}</p>
          {/*
             Only when it is true. A line that appears whether or not the owner
             is slowest would be a slogan rather than a finding, and with one
             measured seat the owner is trivially the slowest.
          */}
          {ownerIsSlowest && (
            <p className="max-w-prose text-caption text-muted">{t("team.owner_slowest")}</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
