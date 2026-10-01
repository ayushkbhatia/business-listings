import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { subscriptionList } from "@/lib/billing/subscription-list";
import { formatAED, formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { SubscriptionTable, type SubscriptionRowView } from "./SubscriptionTable";

/**
 * Board 4g — the subscription list the revenue numbers are built from.
 *
 * The query fetched the business id, the start date, the cancellation's end
 * date and the dunning stage, and the page mapped none of them — so a row could
 * not be opened, a cancellation already on its way out read as plain "Active",
 * and an account on day 7 of failed payments read the same as one on day 0. They
 * are on the row now, and the name opens the account (board 4f).
 */

export const dynamic = "force-dynamic";

export default async function SubscriptionsPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "revenue.read")) notFound();

  const [list, badges] = await Promise.all([subscriptionList(), getAdminNavBadges(seat)]);

  const rows: SubscriptionRowView[] = list.rows.map((subscription) => ({
    id: subscription.id,
    businessName: subscription.businessName,
    href: `/admin/businesses/${subscription.businessId}`,
    planName: subscription.planName,
    status: subscription.status,
    statusNote: subscription.endsAt
      ? t("admin.subscriptions.ends", { date: formatDate(subscription.endsAt) })
      : subscription.dunningStage !== "none"
        ? t(`admin.dunning.stage.${subscription.dunningStage}` as never)
        : null,
    monthly: formatAED(subscription.monthlyFils / 100),
    term: subscription.term,
    since: formatDate(subscription.startedAt),
    renews: formatDate(subscription.renewsAt),
    grandfathered: subscription.grandfatheredFields,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/subscriptions"
      title={t("admin.subscriptions.title")}
      eyebrow={t("admin.subscriptions.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {/*
             Both counts are queries over every subscription. They were
             `rows.length` and a filter over the same rows, behind a `take` of
             500 — a count of the page that read as a count of the business.
          */}
          {t("admin.subscriptions.meta", {
            count: formatCount(list.total),
            grandfathered: formatCount(list.grandfathered),
          })}
        </span>
      }
    >
      {list.total > rows.length && (
        <p className="mb-[var(--gutter)] text-caption text-muted">
          {t("admin.subscriptions.truncated", {
            shown: formatCount(rows.length),
            count: formatCount(list.total),
          })}
        </p>
      )}

      <SubscriptionTable rows={rows} />

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.subscriptions.note")}
      </p>
    </AdminPage>
  );
}
