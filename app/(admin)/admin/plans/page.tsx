import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/display";
import { Panel } from "@/components/structure";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { dunningSummary } from "@/lib/billing/dunning-queue";
import { planLibrary } from "@/lib/billing/entitlements-service";
import { annualPriceAed } from "@/lib/billing/pricing";
import { FILS_PER_AED } from "@/lib/billing/proration";
import { formatAED, formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { PLAN_FIELDS, type PlanEditableField } from "@/lib/plan/plan-fields";
import type { PlanFieldValue } from "@/lib/billing/plan-diff";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { CommerceTabs } from "../CommerceTabs";
import { addPlan, commitChanges, previewChanges } from "./actions";
import { AddPlan } from "./AddPlan";
import { PlanMatrix, type PlanColumn } from "./PlanMatrix";

/**
 * Board 12e — plan config.
 *
 * *"The table that decides what every paying account on the platform gets."*
 * Readable by anybody with `revenue.read`; editable by ops lead and finance,
 * which answers the board's Q2 — *"who may edit plan config?"* — out of
 * `docs/permissions.md` §3 rather than leaving it open: **Edit plans &
 * entitlements** is ops lead and finance, the one commercial row the two share,
 * and it is `plan.entitlements.write` in `lib/auth/capabilities.ts`.
 *
 * Two capabilities on one screen rather than two screens, because "what does
 * Basic allow" is a question a moderator answers on a support call and hiding
 * the answer behind the write capability would send them to ask somebody.
 *
 * ## The failed-payments panel is a count and a link
 *
 * Board 12e Q1, answered as the spec recommends. The board drew a third table
 * of the same failed payments — *"64 · AED 12,880 at risk"* over three
 * businesses, against `12i`'s *"12 in sequence"* over four different ones. Two
 * counts and no shared row set is how a directory stops being believed, so
 * there is one query, one list at `/admin/dunning`, and a card here that links
 * to it.
 */

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const seat = await requireStaff();
  const mayEdit = can(seat.actor, "plan.entitlements.write");
  if (!can(seat.actor, "revenue.read") && !mayEdit) notFound();

  const [plans, dunning, badges] = await Promise.all([
    planLibrary(),
    dunningSummary(),
    getAdminNavBadges(seat),
  ]);

  const now = new Date();
  const columns: PlanColumn[] = plans.map((plan) => {
    const values = {} as Record<PlanEditableField, PlanFieldValue>;
    for (const spec of PLAN_FIELDS) values[spec.field] = plan[spec.field] as PlanFieldValue;
    const annual = annualPriceAed(plan);
    return {
      id: plan.id,
      name: plan.name,
      values,
      onSale: plan.withdrawnAt === null || plan.withdrawnAt > now,
      // Serialised, because the matrix is a client component and a Date is not
      // the thing to send across that boundary for a value it only renders.
      withdrawnOn: plan.withdrawnAt ? formatDate(plan.withdrawnAt) : null,
      subscriptions: plan.subscriptions,
      grandfathered: plan.grandfathered,
      annualPrice: annual === null ? null : formatAED(annual),
    };
  });

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/plans"
      title={t("admin.plans.title")}
      eyebrow={t("admin.plans.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.plans.meta", { count: formatCount(columns.length) })}
        </span>
      }
    >
      <CommerceTabs actor={seat.actor} active="/admin/plans" />

      <PlanMatrix
        plans={columns}
        canEdit={mayEdit}
        preview={previewChanges}
        commit={commitChanges}
        {...(mayEdit
          ? {
              /* The board draws `+ Add plan` in the table header; that is where it is. */
              addPlan: (
                <AddPlan
                  sources={columns.map((plan) => ({ id: plan.id, name: plan.name }))}
                  add={addPlan}
                />
              ),
            }
          : {})}
      />

      {can(seat.actor, "revenue.read") && (
        <div className="mt-[var(--gutter)]">
          <Panel title={t("admin.dunning.title")} description={t("admin.plans.dunning_note")}>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge tone={dunning.inSequence === 0 ? "ok" : "bad"}>
                {dunning.inSequence === 0
                  ? t("admin.plans.dunning_none")
                  : t("admin.plans.dunning_at_risk", {
                      count: formatCount(dunning.inSequence),
                      amount: formatAED(dunning.atRiskFils / FILS_PER_AED, { style: "exact" }),
                    })}
              </StatusBadge>
              {dunning.count > dunning.inSequence && (
                /*
                   Said rather than folded into the count. An account that has
                   already dropped is on Free with its listing live; it is not
                   past due and nothing on it is at risk, so it is not in the
                   figure beside it.
                */
                <span className="text-caption text-muted">
                  {t("admin.plans.dunning_dropped", {
                    count: formatCount(dunning.count - dunning.inSequence),
                  })}
                </span>
              )}
              {dunning.droppingSoon > 0 && (
                <span className="text-caption text-warn-ink">
                  {t("admin.plans.dunning_dropping", {
                    count: formatCount(dunning.droppingSoon),
                  })}
                </span>
              )}
              <Link
                href="/admin/dunning"
                className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
              >
                {t("admin.plans.dunning_link")}
              </Link>
            </div>
          </Panel>
        </div>
      )}

      <div className="mt-[var(--gutter)] flex flex-col gap-2">
        <p className="max-w-prose text-caption text-muted">{t("admin.plans.note")}</p>
        {/*
           Board 12e correction 1 and `B2`, said rather than silently missing.

           `Ranking weight multiplier` was drawn on this board as three editable
           numbers — 1.0×, 1.5×, 3.0×. There is no multiplier in the shipped
           model: `12c` runs six integers that always total 100, plan tier is one
           of them, `PLAN_TIER_CEILING = 10` is enforced server-side, and boost
           points are added to that scale rather than multiplied. An editable
           field here would be a second writer for a model whose single source is
           `lib/search/ranking.ts`, so the row is not on this screen and this
           line says where it went.
        */}
        <p className="max-w-prose text-caption text-muted">{t("admin.plans.ranking_note")}</p>
        <p className="max-w-prose text-caption text-muted">{t("admin.plans.buyer_side_note")}</p>
      </div>
    </AdminPage>
  );
}
