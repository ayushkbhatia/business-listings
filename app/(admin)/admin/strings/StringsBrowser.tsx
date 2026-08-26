"use client";

import { useMemo, useState } from "react";
import { Tag } from "@/components/display";
import { SearchField } from "@/components/primitives";
import { DataTable, type Column } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Every string in the catalogue, searchable.
 *
 * Read-only, and the page says why. A translator quoting for Arabic needs to
 * know what they are quoting for; that is what this is.
 */

export interface StringRowView {
  key: string;
  text: string;
  plural: boolean;
  interpolated: boolean;
}

const PAGE_SIZE = 50;

export function StringsBrowser({ rows }: { rows: readonly StringRowView[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.key.toLowerCase().includes(needle) || row.text.toLowerCase().includes(needle),
    );
  }, [rows, query]);

  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns: Column<StringRowView>[] = [
    { key: "key", header: t("strings.col.key"), mono: true, render: (row) => row.key },
    {
      key: "text",
      header: t("strings.col.text"),
      render: (row) => (
        <span className="flex flex-col gap-1">
          <span className="text-caption text-ink">{row.text}</span>
          <span className="flex flex-wrap gap-1">
            {row.plural && <Tag size="sm">{t("strings.plural")}</Tag>}
            {row.interpolated && <Tag size="sm">{t("strings.interpolated")}</Tag>}
          </span>
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      <div className="max-w-md">
        <SearchField
          label={t("strings.search")}
          clearLabel={t("strings.clear")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          onClear={() => {
            setQuery("");
            setPage(1);
          }}
          placeholder={t("strings.search_placeholder")}
        />
      </div>

      <DataTable
        caption={t("strings.caption")}
        columns={columns}
        rows={shown}
        rowKey={(row) => row.key}
        stickyHeader
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: filtered.length,
          onPageChange: setPage,
          rangeLabel: (from, to, total) =>
            t("table.range", {
              from: formatCount(from),
              to: formatCount(to),
              total: formatCount(total),
            }),
          previousLabel: t("table.previous"),
          nextLabel: t("table.next"),
          pageLabel: (n) => t("table.page", { page: formatCount(n) }),
        }}
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("strings.no_match")}</p>
          </div>
        }
      />
    </div>
  );
}
