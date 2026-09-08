import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { planLibrary } from "@/lib/billing/entitlements-service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { saveEntitlements } from "./actions";
import { PlanEditor, type PlanRowView } from "./PlanEditor";

/**
 * Board 12e — plans and entitlements.
 *
 * Readable by anybody with `revenue.read`; editable by ops lead and finance.
 * Two capabilities on one screen rather than two screens, because "what does
 * Basic allow" is a question a moderator answers on a support call and hiding
 * the answer behind the write capability would send them to ask somebody.
 */

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "revenue.read") && !can(seat.actor, "plan.entitlements.write")) notFound();

  const [plans, badges] = await Promise.all([planLibrary(), getAdminNavBadges(seat)]);

  const rows: PlanRowView[] = plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    monthlyPriceAed: plan.monthlyPriceAed,
    enquiriesPerMonth: plan.enquiriesPerMonth,
    productLimit: plan.productLimit,
    locationLimit: plan.locationLimit,
    photoLimit: plan.photoLimit,
    storageMb: plan.storageMb,
    teamSeats: plan.teamSeats,
    subscriptions: plan.subscriptions,
    grandfathered: plan.grandfathered,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/plans"
      title={t("admin.plans.title")}
      eyebrow={t("admin.plans.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.plans.meta", { count: formatCount(rows.length) })}
        </span>
      }
    >
      <PlanEditor
        plans={rows}
        save={saveEntitlements}
        canEdit={can(seat.actor, "plan.entitlements.write")}
      />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.plans.note")}
      </p>
    </AdminPage>
  );
}
