"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/display";
import { DataTable, type Column, type RowTone } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * Board 4f — the accounts table. A CRM row, led by reply rate.
 *
 * Every string arrives formatted from the server: the percentages, the medians,
 * the AED and the dates are the same text on both sides of hydration, and no
 * number is computed here.
 *
 * `B10`: the row opens the account; nothing on the row changes it.
 */

export type HealthTone = "ok" | "warn" | "bad" | "info" | "neutral";

export interface AccountTableRow {
  id: string;
  displayName: string;
  /** `DED-618402 · JEBEL ALI FZ · SINCE FEB 2026`, or `… · UNCLAIMED`. */
  subtitle: string;
  /** `PRO`, or null for a dash — B2. */
  plan: string | null;
  /** `Tier 2`, or null for a dash. */
  tier: string | null;
  /** `1,204 products`, `6 services`, or null when there is nothing to count. */
  catalogue: string | null;
  /** `AED 214,380`, `3 proposals`, or null. */
  quoted: string | null;
  /** `96% · 54 min`, `n/a`, or `Not enough enquiries`. */
  reply: string;
  replyTone: "ok" | "warn" | "bad" | "muted";
  healthLabel: string;
  healthTone: HealthTone;
  /** The dated event behind an upgrade candidate: `Hit product cap · 9 Sep`. */
  healthNote: string | null;
  rowTone: RowTone;
}

const REPLY_CLASS: Record<AccountTableRow["replyTone"], string> = {
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  bad: "text-bad-ink",
  muted: "text-body",
};

export function AccountsTable({
  rows,
  caption,
  filtered,
}: {
  rows: readonly AccountTableRow[];
  caption: string;
  filtered: boolean;
}) {
  const columns: Column<AccountTableRow>[] = [
    {
      key: "business",
      header: t("admin.businesses.col.business"),
      render: (row) => (
        <div className="flex min-w-0 max-w-[26rem] flex-col gap-0.5 py-1">
          <Link
            href={`/admin/businesses/${row.id}`}
            className="truncate rounded-tag text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {row.displayName}
          </Link>
          <span className="truncate font-mono text-eyebrow uppercase text-body">{row.subtitle}</span>
        </div>
      ),
    },
    {
      key: "plan",
      header: t("admin.businesses.col.plan"),
      width: "6rem",
      render: (row) =>
        row.plan ? (
          <StatusBadge tone="neutral" shape="chip" size="sm">
            {row.plan}
          </StatusBadge>
        ) : (
          <span aria-label={t("admin.businesses.no_plan")}>—</span>
        ),
    },
    {
      key: "tier",
      header: t("admin.businesses.col.tier"),
      width: "5.5rem",
      hideBelow: "sm",
      render: (row) => row.tier ?? "—",
    },
    {
      key: "catalogue",
      header: t("admin.businesses.col.catalogue"),
      width: "9rem",
      numeric: true,
      hideBelow: "md",
      render: (row) => row.catalogue ?? "—",
    },
    {
      key: "quoted",
      header: t("admin.businesses.col.quoted"),
      width: "8.5rem",
      numeric: true,
      hideBelow: "lg",
      render: (row) => row.quoted ?? "—",
    },
    {
      key: "reply",
      header: t("admin.businesses.col.reply_rate"),
      width: "10rem",
      render: (row) => <span className={REPLY_CLASS[row.replyTone]}>{row.reply}</span>,
    },
    {
      key: "health",
      header: t("admin.businesses.col.health"),
      width: "11rem",
      render: (row) => (
        <span className="flex flex-col items-start gap-0.5 py-1">
          <StatusBadge tone={row.healthTone} size="sm">
            {row.healthLabel}
          </StatusBadge>
          {row.healthNote ? <span className="text-caption text-body">{row.healthNote}</span> : null}
        </span>
      ),
    },
    {
      key: "open",
      header: t("admin.businesses.col.open"),
      width: "4.5rem",
      render: (row) => (
        <Link
          href={`/admin/businesses/${row.id}`}
          aria-label={t("admin.businesses.open_named", { business: row.displayName })}
          className="rounded-tag text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("admin.businesses.open")}
        </Link>
      ),
    },
  ];

  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      rowTone={(row) => row.rowTone}
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">
            {filtered ? t("admin.businesses.empty_filtered.title") : t("admin.businesses.empty.title")}
          </p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-body">
            {filtered ? t("admin.businesses.empty_filtered.body") : t("admin.businesses.empty.body")}
          </p>
        </div>
      }
    />
  );
}
