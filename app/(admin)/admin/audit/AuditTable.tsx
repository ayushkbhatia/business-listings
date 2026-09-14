"use client";

import { DataTable, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * Board 4i's log, in full.
 *
 * One sentence per row that says what happened and to what — "R. Haddad removed
 * a review · Gulf Star Auto Spare Parts · affected 3 listings" — and the reason
 * beside it, whole. The reference (`Review:clx…`) stays under the sentence in
 * mono, because the name is for reading and the reference is for grepping, and
 * a log needs to be both.
 *
 * Every string arrives formatted from the server: the timestamp is UAE time and
 * the same text on both sides of hydration.
 */

export interface AuditRowData {
  id: string;
  when: string;
  headline: string;
  subject: string;
  subjectName: string | null;
  blast: string | null;
  reason: string;
  /** `field: from → to`, already cut to the scalar fields that differ. */
  change: readonly { field: string; from: string; to: string }[];
}

export function AuditTable({
  rows,
  filtered,
  scope,
}: {
  rows: readonly AuditRowData[];
  /** Whether a filter is applied, which changes what an empty table means. */
  filtered: boolean;
  /**
   * An empty table of your own rows says nothing about the log. "Nothing has
   * been changed" is true only of the whole of it.
   */
  scope: "all" | "own";
}) {
  const emptyTitle = filtered
    ? t("admin.audit.empty_filtered.title")
    : scope === "own"
      ? t("admin.audit.empty_own.title")
      : t("admin.audit.empty.title");
  const emptyBody = filtered
    ? t("admin.audit.empty_filtered.body")
    : scope === "own"
      ? t("admin.audit.empty_own.body")
      : t("admin.audit.empty.body");
  const columns: Column<AuditRowData>[] = [
    {
      key: "when",
      header: t("admin.audit.col.when"),
      width: "10rem",
      mono: true,
      render: (row) => <span className="text-caption text-body">{row.when}</span>,
    },
    {
      key: "what",
      header: t("admin.audit.col.what"),
      render: (row) => (
        <div className="flex min-w-0 flex-col gap-0.5 py-1">
          <span className="text-body-sm text-ink">
            {row.headline}
            {row.subjectName ? ` · ${row.subjectName}` : ""}
            {row.blast ? ` · ${row.blast}` : ""}
          </span>
          <span className="break-all font-mono text-caption text-body">{row.subject}</span>
          {row.change.length > 0 ? (
            <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
              {row.change.map((line) => (
                <li key={line.field} className="flex flex-wrap items-baseline gap-x-1.5 font-mono text-caption">
                  <span className="text-body">{line.field}</span>
                  <s className="text-body">{line.from}</s>
                  <span aria-hidden="true" className="text-body">
                    →
                  </span>
                  <span className="sr-only">{t("admin.audit.changed_to")}</span>
                  <span className="text-ink">{line.to}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ),
    },
    {
      key: "reason",
      header: t("admin.audit.col.reason"),
      width: "40%",
      hideBelow: "md",
      render: (row) => <span className="text-body-sm text-prose">{row.reason}</span>,
    },
  ];

  return (
    <DataTable
      caption={t("admin.audit.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      stickyHeader
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{emptyTitle}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-body">{emptyBody}</p>
        </div>
      }
    />
  );
}
