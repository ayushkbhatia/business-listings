import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { subscriptionList } from "@/lib/billing/subscription-list";
import { formatAED, formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { SubscriptionTable, type SubscriptionRowView } from "./SubscriptionTable";

/** Board 4g — the subscription list the revenue numbers are built from. */

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "revenue.read")) notFound();

  const [subscriptions, badges] = await Promise.all([
    subscriptionList(),
    getAdminNavBadges(seat),
  ]);

  const rows: SubscriptionRowView[] = subscriptions.map((subscription) => ({
    id: subscription.id,
    businessName: subscription.businessName,
    planName: subscription.planName,
    status: subscription.status,
    monthly: formatAED(subscription.monthlyFils / 100),
    renews: subscription.renewsAt.toISOString().slice(0, 10),
    grandfathered: subscription.grandfatheredFields,
  }));

  const grandfathered = rows.filter((row) => row.grandfathered.length > 0).length;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/subscriptions"
      title={t("admin.subscriptions.title")}
      eyebrow={t("admin.subscriptions.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.subscriptions.meta", {
            count: formatCount(rows.length),
            grandfathered: formatCount(grandfathered),
          })}
        </span>
      }
    >
      <SubscriptionTable rows={rows} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.subscriptions.note")}
      </p>
    </AdminPage>
  );
}
