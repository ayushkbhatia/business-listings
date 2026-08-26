import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, StatCard } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { vatReturn } from "@/lib/billing/vat";
import { formatAED, formatCount, formatTRN } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { quarterFrom, quarterKey, quarterRange, recentQuarters } from "./period";
import { TaxTable, type TaxRowView } from "./TaxTable";

/**
 * Board 12e — the VAT export.
 *
 * Output VAT on our own invoices only. Nothing a buyer pays a supplier passes
 * through the platform, so there is no VAT position on it here and the scope
 * note on the page says so — an accountant reading a file called "VAT export"
 * from a trade directory will reasonably wonder.
 */

export const dynamic = "force-dynamic";

const QUARTERS = 8;

function aed(fils: number): string {
  return formatAED(fils / 100);
}

export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "revenue.read")) notFound();

  const { period } = await searchParams;
  const quarter = quarterFrom(period ?? null);
  const { from, to } = quarterRange(quarter);

  const [summary, badges] = await Promise.all([
    vatReturn(from, to),
    getAdminNavBadges(seat),
  ]);

  const rows: TaxRowView[] = summary.rows.map((row) => ({
    invoiceRef: row.invoiceRef,
    issued: row.issuedAt.toISOString().slice(0, 10),
    supplier: row.businessName,
    trn: row.trn ? formatTRN(row.trn) : null,
    emirate: row.emirate ? t(`emirate.${row.emirate}` as never) : "—",
    net: aed(row.netFils),
    vat: aed(row.vatFils),
    gross: aed(row.grossFils),
  }));

  const key = quarterKey(quarter);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/tax"
      title={t("admin.tax.title")}
      eyebrow={t("admin.tax.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.tax.meta", { count: formatCount(rows.length), period: key.toUpperCase() })}
        </span>
      }
      actions={
        <a className={buttonClassName({ variant: "primary" })} href={`/admin/tax/export?period=${key}`}>
          {t("admin.tax.download")}
        </a>
      }
    >
      <nav aria-label={t("admin.tax.period")} className="mb-[var(--gutter)] flex flex-wrap gap-2">
        {recentQuarters(QUARTERS).map((candidate) => {
          const candidateKey = quarterKey(candidate);
          const active = candidateKey === key;
          return (
            <Link
              key={candidateKey}
              href={`/admin/tax?period=${candidateKey}`}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-tag border border-ink bg-ink px-2 py-1 font-mono text-eyebrow uppercase text-on-ink"
                  : "rounded-tag border border-line px-2 py-1 font-mono text-eyebrow uppercase text-muted hover:text-ink"
              }
            >
              {candidateKey}
            </Link>
          );
        })}
      </nav>

      {summary.missingTrn > 0 && (
        <Alert tone="warn" live="off" fix={t("admin.tax.missing_trn_fix")}>
          {t("admin.tax.missing_trn", { count: formatCount(summary.missingTrn) })}
        </Alert>
      )}

      <div className="grid gap-[var(--gutter)] sm:grid-cols-3">
        <StatCard face="sans" label={t("admin.tax.net")} value={aed(summary.netFils)} />
        <StatCard face="sans" label={t("admin.tax.vat")} value={aed(summary.vatFils)} />
        <StatCard face="sans" label={t("admin.tax.gross")} value={aed(summary.grossFils)} />
      </div>

      {summary.byEmirate.length > 0 && (
        <div className="mt-[var(--gutter)]">
          <Panel title={t("admin.tax.by_emirate")}>
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {summary.byEmirate.map((entry) => (
                <li key={entry.emirate} className="text-caption">
                  <span className="font-mono text-eyebrow uppercase text-muted">
                    {entry.emirate === "unknown"
                      ? t("admin.tax.no_emirate")
                      : t(`emirate.${entry.emirate}` as never)}
                  </span>{" "}
                  <span className="tabular-nums text-ink">{aed(entry.netFils)}</span>{" "}
                  <span className="text-muted">+{aed(entry.vatFils)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      <div className="mt-[var(--gutter)]">
        <TaxTable
          rows={rows}
          totals={{
            net: aed(summary.netFils),
            vat: aed(summary.vatFils),
            gross: aed(summary.grossFils),
            count: t("admin.tax.total", { count: formatCount(rows.length) }),
          }}
        />
      </div>

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.tax.scope")}
      </p>
    </AdminPage>
  );
}
