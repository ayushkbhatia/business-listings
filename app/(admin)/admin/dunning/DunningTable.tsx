"use client";

import { StatusBadge } from "@/components/display";
import { DataTable, type Column } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Criterion 10, read from the far end.
 *
 * The stage column says where an account is; the next column says what happens
 * to it and when. Neither of them says "suspended", "unpublished" or "badge
 * removed", because the sequence cannot do any of those — the whole of what it
 * may do to an account is enumerated in `PERMITTED_ACCOUNT_EFFECTS` and it has
 * one entry.
 */

export interface DunningRowView {
  subscriptionId: string;
  businessName: string;
  planName: string;
  stage: string;
  daysPastDue: number;
  next: string;
  attempts: number;
}

/**
 * Stage tones.
 *
 * A dropped account is `neutral`, not `bad`. It is on Free, its listing is
 * live, and painting it red would say something happened to the listing.
 */
const TONE: Record<string, "neutral" | "warn" | "bad" | "ok"> = {
  none: "warn",
  retry: "warn",
  emailed: "warn",
  messaged: "bad",
  final: "bad",
  dropped: "neutral",
};

export function DunningTable({ rows }: { rows: readonly DunningRowView[] }) {
  const columns: Column<DunningRowView>[] = [
    {
      key: "business",
      header: t("admin.dunning.col.business"),
      render: (row) => row.businessName,
    },
    {
      key: "plan",
      header: t("admin.dunning.col.plan"),
      width: "7rem",
      hideBelow: "md",
      render: (row) => row.planName,
    },
    {
      key: "stage",
      header: t("admin.dunning.col.stage"),
      width: "10rem",
      render: (row) => (
        <StatusBadge tone={TONE[row.stage] ?? "neutral"}>
          {t(`admin.dunning.stage.${row.stage}` as never)}
        </StatusBadge>
      ),
    },
    {
      key: "days",
      header: t("admin.dunning.col.days"),
      numeric: true,
      width: "7rem",
      render: (row) => formatCount(row.daysPastDue),
    },
    {
      key: "next",
      header: t("admin.dunning.col.next"),
      render: (row) => <span className="text-muted">{row.next}</span>,
    },
    {
      key: "attempts",
      header: t("admin.dunning.col.attempts"),
      numeric: true,
      width: "7rem",
      hideBelow: "lg",
      render: (row) =>
        row.attempts === 0 ? (
          <span className="text-faint">{t("admin.dunning.no_attempts")}</span>
        ) : (
          t("admin.dunning.attempts", { count: formatCount(row.attempts) })
        ),
    },
  ];

  return (
    <DataTable
      caption={t("admin.dunning.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.subscriptionId}
      stickyHeader
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.dunning.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.dunning.empty.body")}
          </p>
        </div>
      }
    />
  );
}
