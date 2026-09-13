"use client";

import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/display";
import { DataTable, Tabs, type Column } from "@/components/structure";
import { EMIRATES } from "@/lib/uae";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { RecordFilter, RecordRow } from "@/lib/ingest/read";

/**
 * Every record a run staged, fifty at a time, in file order.
 *
 * File order rather than by outcome, because the person reading this usually
 * has the source spreadsheet open beside it and is looking for row 4,812. The
 * filter tabs are links, so a filtered view can be sent to somebody.
 *
 * Unfilled data stays visible: a record the registry sent with no licence
 * number shows "Not provided" in that column rather than a blank, which is the
 * difference between an empty cell and an unanswered question.
 */

const FILTERS: RecordFilter[] = ["all", "queued", "ready", "published", "duplicate", "rejected"];

const OUTCOME_TONE: Record<string, "ok" | "warn" | "bad" | "neutral" | "info"> = {
  ready: "info",
  needs_category: "warn",
  published: "ok",
  duplicate: "neutral",
  rejected: "bad",
};

const EMIRATE_LABEL = new Map<string, string>(EMIRATES.map((e) => [e.value, e.label]));

export interface RecordsTableProps {
  runId: string;
  runNumber: number;
  show: RecordFilter;
  page: number;
  pageSize: number;
  total: number;
  counts: Record<RecordFilter, number>;
  rows: readonly RecordRow[];
}

export function RecordsTable({ runId, runNumber, show, page, pageSize, total, counts, rows }: RecordsTableProps) {
  const router = useRouter();
  const href = (filter: RecordFilter, to = 1) =>
    `/admin/ingest/${runId}?show=${filter}${to > 1 ? `&page=${to}` : ""}#run-records`;
  const missing = <span className="text-body">{t("admin.records.not_provided")}</span>;

  const columns: Column<RecordRow>[] = [
    {
      key: "row",
      header: t("admin.records.col.row"),
      numeric: true,
      mono: true,
      width: "5rem",
      render: (row) => formatCount(row.rowNumber),
    },
    {
      key: "name",
      header: t("admin.records.col.name"),
      render: (row) => (row.licenceName ? <span className="text-ink">{row.licenceName}</span> : missing),
    },
    {
      key: "licence",
      header: t("admin.records.col.licence"),
      mono: true,
      width: "10rem",
      hideBelow: "md",
      render: (row) => row.licenceNumber ?? missing,
    },
    {
      key: "activity",
      header: t("admin.records.col.activity"),
      hideBelow: "lg",
      render: (row) => row.activity ?? missing,
    },
    {
      key: "emirate",
      header: t("admin.records.col.emirate"),
      width: "8rem",
      hideBelow: "lg",
      render: (row) => (row.emirate ? (EMIRATE_LABEL.get(row.emirate) ?? row.emirate) : missing),
    },
    {
      key: "outcome",
      header: t("admin.records.col.outcome"),
      width: "16rem",
      render: (row) => (
        <span className="flex flex-col items-start gap-0.5">
          <StatusBadge tone={OUTCOME_TONE[row.disposition] ?? "neutral"} shape="chip">
            {t(`admin.records.outcome.${row.disposition as "ready"}`)}
          </StatusBadge>
          {row.listingLive === false && (
            <span className="text-caption text-body">{t("admin.records.not_live")}</span>
          )}
          {row.ground && (
            <span className="text-caption text-body">{t(`admin.run.ground.${row.ground}`)}</span>
          )}
          {row.categoryName && row.disposition !== "rejected" && (
            <span className="text-caption text-body">{row.categoryName}</span>
          )}
          {row.held.filter((reason) => reason !== "needs_category").length > 0 && (
            <span className="text-caption text-warn-ink">
              {t("admin.records.held_label", {
                reasons: row.held
                  .filter((reason) => reason !== "needs_category")
                  .map((reason) => t(`admin.records.held.${reason}`))
                  .join(", "),
              })}
            </span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        as="a"
        variant="enclosed"
        label={t("admin.records.filters")}
        active={show}
        items={FILTERS.map((filter) => ({
          key: filter,
          label: t(`admin.records.filter.${filter}`),
          href: href(filter),
          badge: counts[filter],
        }))}
      />
      <DataTable
        caption={t("admin.records.caption", { number: runNumber })}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        onRowClick={(row) => router.push(`/admin/ingest/records/${row.id}`)}
        rowAction={(row) => ({
          label: t("admin.records.open"),
          onSelect: () => router.push(`/admin/ingest/records/${row.id}`),
        })}
        actionsHeader={t("admin.records.open")}
        rowTone={(row) =>
          row.disposition === "needs_category" || row.held.length > 0 ? "attention" : "default"
        }
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("admin.records.empty.title")}</p>
            <p className="mx-auto mt-1 max-w-prose text-caption text-body">
              {t("admin.records.empty.body")}
            </p>
          </div>
        }
        {...(total > pageSize
          ? {
              pagination: {
                page,
                pageSize,
                total,
                onPageChange: (to: number) => router.push(href(show, to)),
                rangeLabel: (from: number, to: number, of: number) =>
                  t("table.range", { from: formatCount(from), to: formatCount(to), total: formatCount(of) }),
                previousLabel: t("table.previous"),
                nextLabel: t("table.next"),
                pageLabel: (value: number) => t("table.page", { page: value }),
              },
            }
          : {})}
      />
    </div>
  );
}
