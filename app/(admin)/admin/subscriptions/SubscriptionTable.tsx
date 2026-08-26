"use client";

import { StatusBadge, Tag } from "@/components/display";
import { DataTable, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * Every subscription, newest first.
 *
 * The grandfathered column names the caps rather than counting them. "3" tells
 * a support call nothing; "products, photos" answers the question the seller
 * actually asked, which is why they cannot add a fourteenth photo.
 */

export interface SubscriptionRowView {
  id: string;
  businessName: string;
  planName: string;
  status: string;
  monthly: string;
  renews: string;
  grandfathered: readonly string[];
}

const TONE: Record<string, "ok" | "warn" | "bad" | "neutral"> = {
  active: "ok",
  trialing: "neutral",
  past_due: "bad",
  cancelled: "warn",
  expired: "neutral",
};

export function SubscriptionTable({ rows }: { rows: readonly SubscriptionRowView[] }) {
  const columns: Column<SubscriptionRowView>[] = [
    {
      key: "business",
      header: t("admin.subscriptions.col.business"),
      render: (row) => row.businessName,
    },
    {
      key: "plan",
      header: t("admin.subscriptions.col.plan"),
      width: "7rem",
      render: (row) => row.planName,
    },
    {
      key: "status",
      header: t("admin.subscriptions.col.status"),
      width: "8rem",
      render: (row) => (
        <StatusBadge tone={TONE[row.status] ?? "neutral"}>
          {t(`subscription.status.${row.status}` as never)}
        </StatusBadge>
      ),
    },
    {
      key: "monthly",
      header: t("admin.subscriptions.col.monthly"),
      numeric: true,
      width: "8rem",
      render: (row) => row.monthly,
    },
    {
      key: "renews",
      header: t("admin.subscriptions.col.renews"),
      mono: true,
      width: "8rem",
      hideBelow: "md",
      render: (row) => row.renews,
    },
    {
      key: "grandfathered",
      header: t("admin.subscriptions.col.grandfathered"),
      hideBelow: "lg",
      render: (row) =>
        row.grandfathered.length === 0 ? (
          <span className="text-faint">{t("admin.subscriptions.on_plan")}</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.grandfathered.map((field) => (
              <Tag key={field}>{t(`admin.subscriptions.cap.${field}` as never)}</Tag>
            ))}
          </span>
        ),
    },
  ];

  return (
    <DataTable
      caption={t("admin.subscriptions.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      stickyHeader
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.subscriptions.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.subscriptions.empty.body")}
          </p>
        </div>
      }
    />
  );
}
