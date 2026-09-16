import Link from "next/link";
import { notFound } from "next/navigation";
import { ChipLink, StatusBadge } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { formatCount, formatPercent } from "@/lib/format";
import { t } from "@/lib/i18n";
import { loadReportQueue } from "@/lib/reports/queue";
import { reportOutcomes } from "@/lib/reports/outcomes";
import { reportStaff } from "@/lib/reports/decide";
import { incentiveFindings } from "@/lib/reports/service";
import { isReportType, REPORT_TYPES } from "@/lib/reports/taxonomy";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { assign } from "./actions";
import { reportBoardRows } from "./board";
import { IncentiveLogRail, IntegrityRail, OutcomesRail } from "./_rails";
import { ReportQueue } from "./ReportQueue";

/**
 * Board 4h — reports, flags and disputes. One queue for six kinds of complaint.
 *
 * ## One taxonomy (`B3`)
 *
 * The board's header read **14 supplier reports · 23 reviews · 9 listings** —
 * three buckets, 46 items — over a `TYPE` column naming five other things, of
 * which three had no home in the header at all. Here the header, the chips and
 * the rows are all counted off one array, which is board 4b's `B4` and `11c`'s
 * acceptance criterion 5: every count reconciles with the list beneath it.
 *
 * ## What is not on this screen
 *
 * **`Suspend`.** `12c` refused, in writing, to put a second route to a
 * suspension on this board: *a second route to an outcome that already has one
 * keeps none of the first one's guarantees.* `business.suspend` is ops-lead
 * only, audited, reason-coded and honoured across storefronts, search, product
 * counts, the metrics jobs and quote extension. The queue is worked by
 * moderators, who do not hold it. So the row escalates and the suspension is
 * taken where it lives.
 *
 * **`Archive`.** The board draws it on a listing whose licence expired fourteen
 * months ago. Closing a listing is board 11i's `giveLicenceLapseNotice` — a
 * notice period, an email to the owner, a reversal link, a nightly job — and
 * `12e`'s dunning rule is explicit that a lapse never deletes a listing.
 * Archiving a report would not have touched any of that; it would have hidden
 * the report about it.
 *
 * ## What every figure is
 *
 * A query. The board's `61%`, `58%`, `26%`, `16%` and `2.4 days` are design
 * fixtures, and there is nowhere in this build to write one.
 *
 * `report.resolve` is moderator or ops lead; any other staff seat gets a 404.
 */

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; mine?: string; escalated?: string }>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "report.resolve")) notFound();

  const query = await searchParams;
  const type = query.type && isReportType(query.type) ? query.type : null;
  const mine = query.mine === "1";
  const escalated = query.escalated === "1";
  const now = new Date();

  const [view, outcomes, staff, log, badges] = await Promise.all([
    loadReportQueue(
      { type, assigneeId: mine ? seat.actor.id : null, escalated },
      now,
    ),
    reportOutcomes(now),
    reportStaff(),
    incentiveFindings(),
    getAdminNavBadges(seat),
  ]);

  const search = (next: { type?: string | null; mine?: boolean; escalated?: boolean }) => {
    const params = new URLSearchParams();
    const wantType = next.type === undefined ? type : next.type;
    const wantMine = next.mine === undefined ? mine : next.mine;
    const wantEscalated = next.escalated === undefined ? escalated : next.escalated;
    if (wantType) params.set("type", wantType);
    if (wantMine) params.set("mine", "1");
    if (wantEscalated) params.set("escalated", "1");
    const text = params.toString();
    return text ? `/admin/reports?${text}` : "/admin/reports";
  };

  // The filter travels into the row's screen, so Back returns to the same list.
  const carried = search({}).replace("/admin/reports", "");
  /*
     How many of the nine have anything in them, not how many exist. A header
     reading "9 types" over a queue holding three would be the same defect this
     board was corrected for, from the other direction.
  */
  const typesInPlay = REPORT_TYPES.filter((key) => view.counts[key] > 0).length;
  const rows = reportBoardRows(view.rows, { query: carried });

  /*
     Four empty states, not one — design system §05. Nothing waiting is a
     finished morning; nothing under a filter is a filter to clear; and the two
     read differently to the person clearing the queue.
  */
  const empty =
    view.total === 0 ? (
      <div className="text-center">
        <p className="text-body-sm text-body">{t("admin.reports.empty.title")}</p>
        <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
          {t("admin.reports.empty.body")}
        </p>
      </div>
    ) : (
      <div className="text-center">
        <p className="text-body-sm text-body">{t("admin.reports.filtered_empty.title")}</p>
        <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
          {t("admin.reports.filtered_empty.body", {
            count: view.total,
            n: formatCount(view.total),
          })}
        </p>
        <Link
          href="/admin/reports"
          className="mt-2 inline-block text-caption text-moss underline underline-offset-2"
        >
          {t("admin.reports.filtered_empty.back")}
        </Link>
      </div>
    );

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/reports"
      title={t("admin.reports.title")}
      eyebrow={t("admin.reports.eyebrow")}
      meta={
        view.total === 0 ? undefined : (
          <span className="flex flex-wrap items-center gap-3 text-body-sm text-body">
            {/* One taxonomy, counted once. */}
            <span>
              {[
                t("admin.reports.meta.open", { n: formatCount(view.total) }),
                t("admin.reports.meta.types", { count: typesInPlay, n: formatCount(typesInPlay) }),
                t("admin.reports.meta.auto", {
                  auto: formatPercent(view.autoDetected / view.total),
                }),
              ].join(" · ")}
            </span>
            {view.overSla > 0 && (
              <StatusBadge tone="bad">
                {t("admin.reports.over_sla", {
                  count: view.overSla,
                  n: formatCount(view.overSla),
                })}
              </StatusBadge>
            )}
            {view.records > view.total && (
              <span className="text-muted">
                {t("admin.reports.records", {
                  count: view.records,
                  n: formatCount(view.records),
                })}
              </span>
            )}
          </span>
        )
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={search({ mine: !mine })}
            aria-current={mine ? "true" : undefined}
            className={buttonClassName({ variant: "secondary" })}
          >
            {mine ? t("admin.reports.all_rows") : t("admin.reports.assigned_to_me")}
          </Link>
          {can(seat.actor, "report.detectors") && (
            <Link href="/admin/reports/detectors" className={buttonClassName({ variant: "ghost" })}>
              {t("admin.reports.tune")}
            </Link>
          )}
        </div>
      }
    >
      {/*
         The rail comes alongside at the width the board is drawn at, and sits
         under the table below it. At 1280 — the viewport the acceptance run
         uses — a 22rem rail beside the console sidebar leaves about six hundred
         pixels for six columns, and a claim wrapping to six lines is a queue
         nobody can scan. `board` is 90rem, in globals.css, rather than an
         arbitrary `min-[1440px]:`, which sorts before `sm:` and loses.
      */}
      <div className="grid items-start gap-[var(--gutter)] board:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-[var(--gutter)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
            <nav aria-label={t("admin.reports.chips_label")} className="flex flex-wrap items-center gap-2">
              <ChipLink href={search({ type: null })} selected={type === null}>
                {t("admin.reports.chip.all", { n: formatCount(view.total) })}
              </ChipLink>
              {REPORT_TYPES.map((key) => (
                <ChipLink key={key} href={search({ type: key })} selected={type === key}>
                  {t(`admin.reports.chip.${key}` as "admin.reports.chip.closed", {
                    n: formatCount(view.counts[key]),
                  })}
                </ChipLink>
              ))}
              <ChipLink
                href={search({ escalated: !escalated })}
                selected={escalated}
                tone={view.all.some((entry) => entry.escalatedAt) ? "bad" : "default"}
              >
                {t("admin.reports.chip.escalated", {
                  n: formatCount(view.all.filter((entry) => entry.escalatedAt !== null).length),
                })}
              </ChipLink>
            </nav>
            <span className="text-body-sm text-muted">{t("admin.reports.sort")}</span>
          </div>

          <ReportQueue rows={rows} staff={staff.map((person) => ({ id: person.id, name: person.name ?? person.id }))} empty={empty} assign={assign} />

          <p className="max-w-prose text-caption text-muted">{t("admin.reports.note")}</p>
        </div>

        <aside className="flex flex-col gap-[var(--gutter)]" aria-label={t("admin.reports.rail_label")}>
          <OutcomesRail outcomes={outcomes} />
          <IntegrityRail />
          <IncentiveLogRail log={log} mayWrite={can(seat.actor, "review.remove")} />
        </aside>
      </div>
    </AdminPage>
  );
}
