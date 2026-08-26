import { notFound } from "next/navigation";
import { Alert, StatCard, Waterfall, type WaterfallStep } from "@/components/display";
import { Panel } from "@/components/structure";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { MRR_KINDS, mrrNow, reconcile, waterfall } from "@/lib/billing/revenue";
import { formatAED, formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { PlanMixTable, type PlanMixRow } from "./PlanMixTable";

/**
 * Board 4g — revenue.
 *
 * Two numbers on this page could be invented and neither is. MRR is a query
 * over the subscription table; the waterfall is a `GROUP BY` over a ledger
 * written by the four places that change what an account pays. The
 * reconciliation between them is on the page whether it agrees or not, because
 * a check that only shows itself when it passes is not a check.
 */

export const dynamic = "force-dynamic";

const MONTHS = 12;

function aed(fils: number): string {
  return formatAED(fils / 100);
}

function signed(fils: number): string {
  const body = formatAED(Math.abs(fils) / 100);
  if (fils === 0) return body;
  return fils > 0 ? `+${body}` : `−${body}`;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

export default async function RevenuePage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "revenue.read")) notFound();

  const to = new Date();
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - MONTHS + 1, 1));

  const [now, movement, reconciliation, badges] = await Promise.all([
    mrrNow(),
    waterfall(from, to),
    reconcile(),
    getAdminNavBadges(seat),
  ]);

  const steps: WaterfallStep[] = [
    {
      key: "opening",
      label: t("admin.revenue.step.opening"),
      value: movement.openingFils,
      valueLabel: aed(movement.openingFils),
      total: true,
    },
    ...MRR_KINDS.map((kind) => ({
      key: kind,
      label: t(`admin.revenue.step.${kind}` as never),
      value: movement.movement[kind],
      valueLabel: signed(movement.movement[kind]),
    })),
    {
      key: "closing",
      label: t("admin.revenue.step.closing"),
      value: movement.closingFils,
      valueLabel: aed(movement.closingFils),
      total: true,
    },
  ];

  const planRows: PlanMixRow[] = now.byPlan.map((plan) => ({
    planId: plan.planId,
    planName: plan.planName,
    accounts: formatCount(plan.accounts),
    mrr: aed(plan.mrrFils),
    share: now.mrrFils === 0 ? "—" : percent(plan.mrrFils / now.mrrFils),
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/revenue"
      title={t("admin.revenue.title")}
      eyebrow={t("admin.revenue.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.revenue.meta", { accounts: formatCount(now.payingAccounts) })}
        </span>
      }
    >
      {!reconciliation.agrees && (
        <Alert
          tone="warn"
          title={t("admin.revenue.unreconciled", {
            ledger: aed(reconciliation.ledgerFils),
            live: aed(reconciliation.liveFils),
            difference: signed(reconciliation.differenceFils),
          })}
        >
          {t("admin.revenue.unreconciled_body")}
        </Alert>
      )}

      <div className="grid gap-[var(--gutter)] sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          face="sans"
          label={t("admin.revenue.mrr")}
          value={aed(now.mrrFils)}
          caption={t("admin.revenue.reconciled", { amount: aed(reconciliation.ledgerFils) })}
        />
        <StatCard
          face="sans"
          label={t("admin.revenue.annualised")}
          value={aed(now.annualisedFils)}
          caption={t("admin.revenue.annualised_caption")}
        />
        <StatCard
          face="sans"
          label={t("admin.revenue.accounts")}
          value={formatCount(now.payingAccounts)}
        />
        <StatCard face="sans" label={t("admin.revenue.arpa")} value={aed(now.arpaFils)} />
      </div>

      <div className="mt-[var(--gutter)]">
        <Panel title={t("admin.revenue.waterfall")}>
          <Waterfall steps={steps} label={t("admin.revenue.waterfall_label")} />
          <p className="mt-3 text-caption text-muted">
            {movement.grossChurnRate === null
              ? t("admin.revenue.no_rate")
              : `${t("admin.revenue.churn_rate", {
                  rate: percent(movement.grossChurnRate),
                  count: formatCount(movement.churnedAccounts),
                })} · ${t("admin.revenue.nrr", {
                  rate: percent(movement.netRevenueRetention ?? 0),
                })}`}
          </p>
        </Panel>
      </div>

      <div className="mt-[var(--gutter)]">
        <Panel title={t("admin.revenue.by_plan")}>
          <PlanMixTable rows={planRows} />
        </Panel>
      </div>

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.revenue.definition")}
      </p>
    </AdminPage>
  );
}
