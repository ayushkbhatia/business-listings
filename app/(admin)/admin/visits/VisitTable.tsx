"use client";

import { useRouter } from "next/navigation";
import { DataTable, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * Board 12h — visits asked for and not yet made.
 *
 * The tier column is the reason each row is here: a seller asking for a visit
 * is a seller asking for tier 3, and the gap between what they have and what
 * they are asking for is what a route planner needs to see.
 */

export interface VisitRow {
  id: string;
  businessName: string;
  tier: number;
  where: string;
  note: string | null;
  ageDays: number;
}

export function VisitTable({ rows }: { rows: readonly VisitRow[] }) {
  const router = useRouter();
  const columns: Column<VisitRow>[] = [
    {
      key: "business",
      header: t("admin.visits.col.business"),
      render: (row) => row.businessName,
    },
    {
      key: "where",
      header: t("admin.visits.col.where"),
      render: (row) => <span className="text-muted">{row.where}</span>,
    },
    {
      key: "tier",
      header: t("admin.visits.col.tier"),
      width: "8rem",
      /*
       * A mono mark, not the badge. `VerificationBadge` requires what was
       * checked and when — that obligation is the whole point of it, and it is
       * owed to a buyer reading a storefront. In a console column the tier is a
       * data point, and borrowing the trust signal to show a number would
       * weaken it everywhere it means something.
       */
      mono: true,
      render: (row) => `tier ${row.tier}`,
    },
    {
      key: "note",
      header: t("admin.visits.col.note"),
      hideBelow: "lg",
      render: (row) => <span className="text-muted">{row.note ?? "—"}</span>,
    },
    {
      key: "age",
      header: t("admin.visits.col.age"),
      numeric: true,
      width: "6rem",
      render: (row) => t("admin.queue.age_days", { days: String(row.ageDays) }),
    },
  ];

  return (
    <DataTable
      caption={t("admin.visits.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      stickyHeader
      /*
         The way into the report. `recordVisit` had no screen at all, so this
         table listed work nobody could complete — a queue that could only ever
         grow.
      */
      rowAction={(row) => ({
        label: t("admin.visits.file"),
        onSelect: () => router.push(`/admin/visits/${row.id}`),
      })}
      actionsHeader={t("admin.visits.file")}
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.visits.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.visits.empty.body")}
          </p>
        </div>
      }
    />
  );
}
