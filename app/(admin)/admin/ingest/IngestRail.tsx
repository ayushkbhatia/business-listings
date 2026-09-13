import Link from "next/link";
import { Panel } from "@/components/structure";
import { cn } from "@/lib/cn";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { CoverageRow, HistoryRow } from "@/lib/ingest/read";
import { EMIRATES } from "@/lib/uae";

/**
 * Board 12a's right rail: where supply comes from, and what each run did.
 *
 * **Sources (B10).** The board's rows carried a posture — "Monthly · auto" —
 * that nothing in the product implements. This panel says what is true: every
 * source is uploaded by hand, and per emirate, when it last was. An emirate
 * nothing has been imported from is listed and says so, because "the sources
 * panel is the coverage map for supply and must not hide an empty row".
 *
 * **Run history.** The net figure per run: listings created, or listings a
 * rollback withdrew, in red with the word beside it — never colour alone.
 */

const EMIRATE_LABEL = new Map<string, string>(EMIRATES.map((e) => [e.value, e.label]));

const cell = "py-1.5 align-baseline";

export function SourcesPanel({ rows }: { rows: readonly CoverageRow[] }) {
  return (
    <Panel eyebrow={t("admin.ingest.sources.title")} description={t("admin.ingest.sources.description")}>
      <table className="w-full border-collapse text-body-sm">
        <caption className="sr-only">{t("admin.ingest.sources.caption")}</caption>
        {/*
           Heads for a screen reader, laid out as real columns and drawn at no
           height. An `sr-only` thead is taken out of the table's layout, and
           its heads stop lining up with the cells they name.
        */}
        <thead>
          <tr>
            <th scope="col" className="p-0">
              <span className="sr-only">{t("admin.ingest.sources.col.emirate")}</span>
            </th>
            <th scope="col" className="p-0">
              <span className="sr-only">{t("admin.ingest.sources.col.last")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.emirate} className="border-t border-line first:border-t-0">
              <th scope="row" className={cn(cell, "pe-3 text-start font-normal")}>
                <span className="block text-ink">{EMIRATE_LABEL.get(row.emirate) ?? row.emirate}</span>
                <span className="block font-mono text-eyebrow text-body">
                  {t("admin.ingest.sources.authorities", {
                    count: row.authorities,
                    n: formatCount(row.authorities),
                    imported: formatCount(row.imported.length),
                  })}
                </span>
              </th>
              <td className={cn(cell, "text-end")}>
                {row.lastRunAt && row.lastSource ? (
                  <span className="text-ok-ink">
                    {t("admin.ingest.sources.last", {
                      date: formatDate(row.lastRunAt),
                      source: row.lastSource,
                    })}
                  </span>
                ) : (
                  <span className="text-body">{t("admin.ingest.sources.never")}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function RunHistory({ rows, reversibleDays }: { rows: readonly HistoryRow[]; reversibleDays: number }) {
  return (
    <Panel eyebrow={t("admin.ingest.history.title")}>
      {rows.length === 0 ? (
        <p className="text-caption text-body">{t("admin.ingest.history.empty")}</p>
      ) : (
        <table className="w-full border-collapse text-body-sm">
          <caption className="sr-only">{t("admin.ingest.history.caption")}</caption>
          <thead>
            <tr>
              <th scope="col" className="p-0">
                <span className="sr-only">{t("admin.ingest.history.col.run")}</span>
              </th>
              <th scope="col" className="p-0">
                <span className="sr-only">{t("admin.ingest.history.col.net")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rolledBack = row.status === "rolled_back";
              return (
                <tr key={row.id} className="border-t border-line first:border-t-0">
                  <th scope="row" className={cn(cell, "pe-3 text-start font-normal")}>
                    <Link
                      href={`/admin/ingest/${row.id}`}
                      className={cn(
                        // Underlined at rest: the status word beside it makes this a link
                        // in a block of text, and colour alone cannot mark it.
                        "rounded-tag underline decoration-line-strong underline-offset-2 hover:decoration-current focus-visible:shadow-focus focus-visible:outline-none",
                        rolledBack ? "text-bad-ink" : "text-ink",
                      )}
                    >
                      {t("admin.ingest.history.row", { number: row.number, source: row.source })}
                    </Link>
                    {row.status !== "approved" && (
                      <span className={cn("ms-1.5 text-caption", rolledBack ? "text-bad-ink" : "text-body")}>
                        {row.status === "staged" || row.status === "parsing"
                          ? t("admin.ingest.history.waiting")
                          : rolledBack
                            ? t("admin.ingest.history.rolled_back")
                            : t("admin.ingest.history.discarded")}
                      </span>
                    )}
                  </th>
                  <td
                    className={cn(
                      cell,
                      "text-end font-mono tabular-nums",
                      rolledBack ? "text-bad-ink" : "text-body",
                    )}
                  >
                    {row.net === null
                      ? ""
                      : row.net < 0
                        ? t("admin.ingest.history.withdrawn", { n: formatCount(-row.net) })
                        : t("admin.ingest.history.added", { n: formatCount(row.net) })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-caption text-body">
        {t("admin.ingest.history.note", { days: reversibleDays })}
      </p>
    </Panel>
  );
}
