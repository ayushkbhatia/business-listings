"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import { DataTable, type Column } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "../actions";
import { ReasonModal } from "../ReasonModal";

/**
 * Board 12a B5 — the decisions staging will apply to the next file.
 *
 * Listed because a remembered decision is invisible otherwise: a wrong one
 * files every future record with that activity under the wrong category, and
 * nothing on the run screen would say why. Forgetting is audited like the
 * decision was, and changes only what the next import does.
 */

export interface MappingRow {
  id: string;
  activity: string;
  categoryName: string;
  decidedLabel: string;
  reason: string;
}

export function MappingsTable({
  rows,
  forget,
}: {
  rows: readonly MappingRow[];
  forget: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<MappingRow | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  const columns: Column<MappingRow>[] = [
    {
      key: "activity",
      header: t("admin.mappings.col.activity"),
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-ink">{row.activity}</span>
          <span className="text-caption text-body">{row.reason}</span>
        </span>
      ),
    },
    {
      key: "category",
      header: t("admin.mappings.col.category"),
      width: "14rem",
      render: (row) => row.categoryName,
    },
    {
      key: "by",
      header: t("admin.mappings.col.by"),
      width: "14rem",
      hideBelow: "md",
      render: (row) => <span className="text-body">{row.decidedLabel}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live={result.ok ? "polite" : "assertive"}>
          {result.ok ? result.message : result.error}
        </Alert>
      )}
      <DataTable
        caption={t("admin.mappings.caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        rowAction={(row) => ({
          label: t("admin.mappings.forget"),
          onSelect: () => {
            setResult(null);
            setOpen(row);
          },
        })}
        actionsHeader={t("admin.mappings.forget")}
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("admin.mappings.empty.title")}</p>
            <p className="mx-auto mt-1 max-w-prose text-caption text-body">{t("admin.mappings.empty.body")}</p>
          </div>
        }
      />
      <ReasonModal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={t("admin.mappings.forget_title", { activity: open?.activity ?? "" })}
        description={t("admin.mappings.forget_description", { category: open?.categoryName ?? "" })}
        confirmLabel={t("admin.mappings.forget")}
        destructive
        fields={{ mappingId: open?.id ?? "" }}
        action={forget}
        onDone={(outcome) => {
          setOpen(null);
          setResult(outcome);
          router.refresh();
        }}
      />
    </div>
  );
}
