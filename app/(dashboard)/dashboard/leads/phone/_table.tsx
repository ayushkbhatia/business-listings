import Link from "next/link";
import { formatCount, formatDate, formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ContactLeadPage, ContactLeadRow } from "@/lib/contact/leads";

/**
 * Board `1d` amendment — the phone leads a landline reveal records, as a table.
 *
 * One table for two readers. The seller reads their own listing's leads on
 * `/dashboard/leads/phone`; staff read every listing's on `/admin/leads`, with a
 * supplier column. The row is the same lead either way, worded once.
 *
 * Real table markup — `<caption>`, `<th scope>` — and a name cell that is a
 * row header, because a lead is read by who it is.
 */

type Audience = "seller" | "staff";

function sourceWords(row: ContactLeadRow, audience: Audience): { words: string; path: string | null } {
  const { source } = row;
  switch (source.kind) {
    case "direct":
      return { words: t("phoneleads.source.direct"), path: null };
    case "home":
      return { words: t("phoneleads.source.home"), path: null };
    case "search":
      return {
        words: source.query
          ? t("phoneleads.source.search", { query: source.query })
          : t("phoneleads.source.search_blank"),
        path: audience === "staff" ? source.path : null,
      };
    case "category":
      return { words: t("phoneleads.source.category"), path: source.path };
    case "storefront":
      return {
        words: t(audience === "seller" ? "phoneleads.source.storefront" : "phoneleads.source.storefront_staff"),
        path: source.path,
      };
    case "other_storefront":
      /*
         Which competitor a buyer read first is that competitor's business as
         much as this seller's. The seller is told the buyer came from another
         storefront; only staff see which.
      */
      return { words: t("phoneleads.source.other_storefront"), path: audience === "staff" ? source.path : null };
    default:
      return { words: t("phoneleads.source.page"), path: source.path };
  }
}

const HEAD = "border-b border-line bg-paper-sunk px-3 py-2 text-start font-mono text-eyebrow uppercase text-muted";
const CELL = "border-b border-line px-3 py-2.5 align-top";

export function ContactLeadTable({
  page,
  audience,
  caption,
}: {
  page: ContactLeadPage;
  audience: Audience;
  caption: string;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-card">
      <table className="w-full min-w-[46rem] border-collapse text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {audience === "staff" && (
              <th scope="col" className={HEAD}>
                {t("phoneleads.col.supplier")}
              </th>
            )}
            <th scope="col" className={HEAD}>
              {t("phoneleads.col.name")}
            </th>
            <th scope="col" className={HEAD}>
              {t("phoneleads.col.email")}
            </th>
            <th scope="col" className={HEAD}>
              {t("phoneleads.col.mobile")}
            </th>
            <th scope="col" className={HEAD}>
              {t("phoneleads.col.source")}
            </th>
            <th scope="col" className={HEAD}>
              {t("phoneleads.col.created")}
            </th>
            <th scope="col" className={`${HEAD} text-end`}>
              {t("phoneleads.col.visits")}
            </th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row) => {
            const source = sourceWords(row, audience);
            return (
              <tr key={row.id} className="hover:bg-paper">
                {audience === "staff" && (
                  <td className={CELL}>
                    <Link
                      href={`/b/${row.business.slug}`}
                      className="font-medium text-ink underline-offset-2 hover:underline"
                    >
                      {row.business.displayName}
                    </Link>
                  </td>
                )}
                <th scope="row" className={`${CELL} text-start font-medium text-ink`}>
                  {row.name}
                </th>
                <td className={CELL}>
                  <a href={`mailto:${row.email}`} className="text-ink underline-offset-2 [overflow-wrap:anywhere] hover:underline">
                    {row.email}
                  </a>
                </td>
                <td className={`${CELL} whitespace-nowrap`}>
                  <a href={`tel:${row.mobileTel}`} className="font-mono tabular-nums text-ink hover:underline">
                    {row.mobile}
                  </a>
                </td>
                <td className={CELL}>
                  <span className="text-body">{source.words}</span>
                  {source.path && (
                    <span className="mt-0.5 block max-w-[16rem] truncate font-mono text-caption text-muted" title={source.path}>
                      {source.path}
                    </span>
                  )}
                </td>
                <td className={`${CELL} whitespace-nowrap tabular-nums text-body`}>
                  {formatDateTime(row.createdAt)}
                </td>
                <td className={`${CELL} text-end tabular-nums`}>
                  <span className="text-ink">{formatCount(row.reveals)}</span>
                  {row.reveals > 1 && row.lastRevealedAt && (
                    <span className="mt-0.5 block whitespace-nowrap text-caption text-muted">
                      {t("phoneleads.last_visit", { date: formatDate(row.lastRevealedAt) })}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Previous and next as links — the table is a server render, and a page is a URL. */
export function LeadPager({ page, hrefFor }: { page: ContactLeadPage; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  if (page.total <= page.pageSize) return null;
  const from = (page.page - 1) * page.pageSize + 1;
  const to = Math.min(page.total, page.page * page.pageSize);
  const link = "rounded-ctl border border-line-strong bg-card px-3 py-1.5 text-body-sm font-medium text-ink hover:bg-fill";
  return (
    <nav aria-label={t("phoneleads.pages_label")} className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-caption tabular-nums text-muted">
        {t("phoneleads.range", { from: formatCount(from), to: formatCount(to), total: formatCount(page.total) })}
      </p>
      <div className="flex gap-2">
        {page.page > 1 && (
          <Link href={hrefFor(page.page - 1)} className={link}>
            {t("phoneleads.previous")}
          </Link>
        )}
        {page.page < pages && (
          <Link href={hrefFor(page.page + 1)} className={link}>
            {t("phoneleads.next")}
          </Link>
        )}
      </div>
    </nav>
  );
}
