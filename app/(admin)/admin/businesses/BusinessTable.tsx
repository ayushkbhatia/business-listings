"use client";

import { DataTable, type Column } from "@/components/structure";
import { StatusBadge } from "@/components/display";
import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 4f — account health.
 *
 * Every column is measured. Reply time comes from enquiry-to-first-reply
 * timestamps and profile strength from a pure function over what the seller
 * filled in — neither has a seller-writable path, and neither is invented here.
 */

export interface BusinessRow {
  id: string;
  displayName: string;
  plan: string;
  tier: number;
  replyMs: number | null;
  strength: number | null;
  state: "suspended" | "merged" | "unclaimed" | "live";
}

const TONE = {
  suspended: "bad",
  merged: "neutral",
  unclaimed: "warn",
  live: "ok",
} as const;

export function BusinessTable({ rows }: { rows: readonly BusinessRow[] }) {
  const columns: Column<BusinessRow>[] = [
    {
      key: "business",
      header: t("admin.businesses.col.business"),
      render: (row) => row.displayName,
    },
    {
      key: "plan",
      header: t("admin.businesses.col.plan"),
      width: "7rem",
      mono: true,
      render: (row) => row.plan,
    },
    {
      key: "tier",
      header: t("admin.businesses.col.tier"),
      numeric: true,
      width: "5rem",
      mono: true,
      render: (row) => String(row.tier),
    },
    {
      key: "reply",
      header: t("admin.businesses.col.reply"),
      numeric: true,
      width: "9rem",
      hideBelow: "md",
      // Measured, never claimed. A dash means not enough replies to say.
      render: (row) => (row.replyMs === null ? "—" : formatDuration(row.replyMs)),
    },
    {
      key: "strength",
      header: t("admin.businesses.col.strength"),
      numeric: true,
      width: "7rem",
      hideBelow: "lg",
      render: (row) => (row.strength === null ? "—" : `${formatCount(row.strength)}%`),
    },
    {
      key: "state",
      header: t("admin.businesses.col.state"),
      width: "9rem",
      render: (row) => (
        <StatusBadge tone={TONE[row.state]}>
          {t(`admin.businesses.state.${row.state}` as never)}
        </StatusBadge>
      ),
    },
  ];

  return (
    <DataTable
      caption={t("admin.businesses.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      stickyHeader
      rowTone={(row) => (row.state === "suspended" ? "blocked" : "default")}
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.businesses.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.businesses.empty.body")}
          </p>
        </div>
      }
    />
  );
}
