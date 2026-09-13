"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert } from "@/components/display";
import { Button, SearchField } from "@/components/primitives";
import { DataTable, SelectionBar, type Column } from "@/components/structure";
import { EMIRATES } from "@/lib/uae";
import { formatCount, formatList } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { CategoryOption } from "@/lib/ingest/queue";
import type { ActionResult } from "../actions";
import { CategorisePanel, type PanelTarget } from "./CategorisePanel";

/**
 * Board 12a — the queue, one row per activity phrase.
 *
 * Selectable, because the same trade arrives worded three ways by three
 * registries — "Marine Equipment Trading", "Trading in Marine Equipment",
 * "Ship Chandlers" — and one decision should file all three. The selection bar
 * replaces nothing and adds one verb; there is no destructive action on this
 * table to separate from it.
 */

export interface QueueRow {
  key: string;
  activity: string | null;
  records: number;
  runNumbers: number[];
  emirates: { emirate: string; count: number }[];
  authorities: string[];
}

const EMIRATE_LABEL = new Map<string, string>(EMIRATES.map((e) => [e.value, e.label]));

export interface QueueTableProps {
  rows: readonly QueueRow[];
  page: number;
  pageSize: number;
  totalGroups: number;
  runId: string | null;
  query: string;
  options: readonly CategoryOption[];
  categorise: (formData: FormData) => Promise<ActionResult>;
}

export function QueueTable({
  rows,
  page,
  pageSize,
  totalGroups,
  runId,
  query,
  options,
  categorise,
}: QueueTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState<PanelTarget | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [search, setSearch] = useState(query);

  const labelOf = (row: QueueRow) => row.activity ?? t("admin.categorise.no_activity");

  function go(next: Record<string, string | null>) {
    const merged = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") merged.delete(key);
      else merged.set(key, value);
    }
    router.push(`${pathname}${merged.size > 0 ? `?${merged.toString()}` : ""}`);
  }

  function applySearch() {
    setSelected([]);
    go({ q: search.trim() || null, page: null });
  }

  function open(keys: string[]) {
    const chosen = rows.filter((row) => keys.includes(row.key));
    if (chosen.length === 0) return;
    setResult(null);
    setTarget({
      kind: "activities",
      keys: chosen.map((row) => row.key),
      labels: chosen.map(labelOf),
      records: chosen.reduce((sum, row) => sum + row.records, 0),
      runId,
    });
  }

  const columns: Column<QueueRow>[] = [
    {
      key: "activity",
      header: t("admin.categorise.col.activity"),
      render: (row) =>
        row.activity ? (
          <span className="text-ink">{row.activity}</span>
        ) : (
          <span className="text-body">{t("admin.categorise.no_activity")}</span>
        ),
    },
    {
      key: "records",
      header: t("admin.categorise.col.records"),
      numeric: true,
      width: "6rem",
      render: (row) => formatCount(row.records),
    },
    {
      key: "where",
      header: t("admin.categorise.col.where"),
      hideBelow: "md",
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-body">
            {formatList(row.emirates.map((item) => EMIRATE_LABEL.get(item.emirate) ?? item.emirate))}
          </span>
          <span className="font-mono text-eyebrow text-body">{row.authorities.join(" · ")}</span>
        </span>
      ),
    },
    {
      key: "runs",
      header: t("admin.categorise.col.runs"),
      width: "8rem",
      hideBelow: "lg",
      render: (row) => (
        <span className="font-mono text-caption text-body">
          {t("admin.categorise.runs", { numbers: row.runNumbers.join(", ") })}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {/*
         A filter over this table, not a search of the site, so neither a
         `search` landmark nor a <form> — both are landmarks, and the gallery
         draws this queue three times under one name. Enter in the field and
         the button do the same thing.
      */}
      <div className="flex max-w-xl items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchField
            size="sm"
            label={t("admin.categorise.search")}
            clearLabel={t("admin.categorise.clear")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                applySearch();
              }
            }}
            onClear={() => {
              setSearch("");
              go({ q: null, page: null });
            }}
          />
        </div>
        <Button size="sm" variant="secondary" onClick={applySearch}>
          {t("admin.categorise.search_action")}
        </Button>
      </div>

      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live={result.ok ? "polite" : "assertive"}>
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <div>
        {selected.length > 0 && (
          <SelectionBar
            count={selected.length}
            countLabel={(count) => t("admin.categorise.selected", { count, n: formatCount(count) })}
            actions={[{ key: "categorise", label: t("admin.categorise.action"), onSelect: () => open(selected) }]}
            onClear={() => setSelected([])}
            clearLabel={t("admin.categorise.clear_selection")}
          />
        )}
        <DataTable
          caption={t("admin.categorise.caption")}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          selectable
          selected={selected}
          onSelectedChange={setSelected}
          selectAllLabel={t("admin.categorise.select_all")}
          selectRowLabel={(row) => t("admin.categorise.select_row", { activity: labelOf(row) })}
          rowAction={(row) => ({ label: t("admin.categorise.action"), onSelect: () => open([row.key]) })}
          actionsHeader={t("admin.categorise.action")}
          rowTone={(row) => (selected.includes(row.key) ? "selected" : "default")}
          empty={
            <div className="text-center">
              <p className="text-body-sm text-body">
                {query ? t("admin.categorise.filtered_empty.title") : t("admin.categorise.empty.title")}
              </p>
              <p className="mx-auto mt-1 max-w-prose text-caption text-body">
                {query ? t("admin.categorise.filtered_empty.body") : t("admin.categorise.empty.body")}
              </p>
            </div>
          }
          {...(totalGroups > pageSize
            ? {
                pagination: {
                  page,
                  pageSize,
                  total: totalGroups,
                  onPageChange: (to: number) => {
                    setSelected([]);
                    go({ page: to > 1 ? String(to) : null });
                  },
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

      <CategorisePanel
        key={target ? target.kind === "activities" ? target.keys.join("|") : target.ids.join("|") : "none"}
        open={target !== null}
        onClose={() => setTarget(null)}
        target={target}
        options={options}
        categorise={categorise}
        onDone={(outcome) => {
          setTarget(null);
          setSelected([]);
          setResult(outcome);
          router.refresh();
        }}
      />
    </div>
  );
}
