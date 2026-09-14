import { notFound } from "next/navigation";
import { Alert } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { reconcile } from "@/lib/billing/revenue";
import { revenueBoard } from "@/lib/billing/revenue-board";
import { periodFor, recentPeriods } from "@/lib/billing/revenue-period";
import { formatAED, formatMonth } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { PeriodMenu } from "./PeriodMenu";
import { RevenueBoardView } from "./RevenueBoardView";
import { presentRevenue } from "./present";

/**
 * Board 4g — subscriptions and revenue, one Dubai month at a time.
 *
 * Five figures, the waterfall, why the month's cancellations said they left,
 * and where the money is licensed. Every number is a query over the ledger in
 * `lib/billing/revenue-board.ts`, every ratio has one formula in
 * `lib/billing/revenue-period.ts`, and each card prints that formula with the
 * inputs it used — B2, and the correction the handoff made to the design: a
 * retention ratio that disagreed with the waterfall above it.
 *
 * Opens on the last whole month, as the render does. The month in progress is
 * one click away and labelled as partial, because its movement is not
 * comparable with a whole month's.
 *
 * The reconciliation between the ledger and the live subscription table stays
 * at the top, shown whenever they disagree. A board built on a ledger is only
 * as good as the ledger, and a silent reconciliation is no reconciliation.
 */

export const dynamic = "force-dynamic";

const MONTHS = 13;

export default async function RevenuePage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const seat = await requireStaff();
  if (!can(seat.actor, "revenue.read")) notFound();

  const now = new Date();
  const { period: requested } = await searchParams;
  const period = periodFor(requested ?? null, now);

  const [board, reconciliation, badges] = await Promise.all([
    revenueBoard(period, now),
    reconcile(),
    getAdminNavBadges(seat),
  ]);
  const view = presentRevenue(board);

  const options = recentPeriods(MONTHS, now).map((option) => ({
    key: option.key,
    label: formatMonth(option.from),
    partial: option.partial,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/revenue"
      title={t("admin.revenue.title")}
      eyebrow={t("admin.revenue.eyebrow")}
      meta={<span className="text-caption text-muted">{view.periodMeta}</span>}
      actions={
        <>
          <PeriodMenu
            current={{ key: view.periodKey, label: view.periodLabel, partial: view.partial }}
            options={options}
            basePath="/admin/revenue"
          />
          <a
            className={buttonClassName({ variant: "secondary" })}
            href={`/admin/revenue/export?period=${view.periodKey}`}
            download
          >
            {t("admin.revenue.export")}
          </a>
        </>
      }
    >
      {!reconciliation.agrees && (
        <div className="mb-[var(--gutter)]">
          <Alert
            tone="warn"
            live="off"
            title={t("admin.revenue.unreconciled", {
              ledger: formatAED(reconciliation.ledgerFils / 100, { style: "exact" }),
              live: formatAED(reconciliation.liveFils / 100, { style: "exact" }),
              difference: formatAED(reconciliation.differenceFils / 100, { style: "exact" }),
            })}
            fix={t("admin.revenue.unreconciled_fix")}
          >
            {t("admin.revenue.unreconciled_body")}
          </Alert>
        </div>
      )}

      {period.partial && (
        <div className="mb-[var(--gutter)]">
          <Alert tone="info" live="off">
            {t("admin.revenue.partial_notice", {
              month: view.periodLabel,
              elapsed: String(period.daysElapsed),
              days: String(period.daysInMonth),
            })}
          </Alert>
        </div>
      )}

      <RevenueBoardView view={view} />
    </AdminPage>
  );
}
