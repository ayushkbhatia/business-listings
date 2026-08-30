import { notFound } from "next/navigation";
import { StatCard } from "@/components/display";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { invoiceList } from "@/lib/billing/invoice-list";
import { formatAED, formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { InvoiceTable, type InvoiceRowView } from "./InvoiceTable";
import { CreditPanel, type CreditableBusiness } from "./CreditPanel";
import { issueCredit } from "./actions";

/**
 * Board 12e — invoices and credits.
 *
 * Subscription and placement lines. There is no buyer money here and nothing to
 * refund: a correction is a subscription credit on the next invoice, which is
 * why `InvoiceLineKind` has `subscription_credit` and no `refund`.
 */

export const dynamic = "force-dynamic";

function aed(fils: number): string {
  return formatAED(fils / 100);
}

export default async function InvoicesPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "revenue.read") && !can(seat.actor, "subscription.credit")) notFound();

  const [list, badges] = await Promise.all([invoiceList(), getAdminNavBadges(seat)]);

  const rows: InvoiceRowView[] = list.rows.map((row) => ({
    id: row.id,
    ref: row.ref,
    businessName: row.businessName,
    issued: row.issuedAt ? row.issuedAt.toISOString().slice(0, 10) : "—",
    status: row.status,
    lines: formatCount(row.lines),
    total: aed(row.totalFils),
    hasCredit: row.hasCredit,
  }));

  const issuedFils = list.rows.reduce((sum, row) => sum + row.totalFils, 0);

  /*
     The credit panel is gated on `subscription.credit` alone, and not on the
     `revenue.read || subscription.credit` that opens the page.

     §07 gives that row to finance and puts a dash against ops lead — the most
     senior role does not hold every capability, and this is the row that
     proves it. Reusing the page's OR would show the panel to an ops lead and
     have the service refuse them.
  */
  const mayCredit = can(seat.actor, "subscription.credit");

  const creditable: CreditableBusiness[] = mayCredit
    ? [
        ...new Map(
          list.rows.map((row) => [row.businessId, { id: row.businessId, name: row.businessName }]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/invoices"
      title={t("admin.invoices.title")}
      eyebrow={t("admin.invoices.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.invoices.meta", {
            count: formatCount(rows.length),
            outstanding: aed(list.outstandingFils),
          })}
        </span>
      }
    >
      <div className="grid gap-[var(--gutter)] sm:grid-cols-2">
        <StatCard
          face="sans"
          label={t("admin.invoices.total_issued")}
          value={aed(issuedFils)}
          caption={t("admin.invoices.lines", { count: formatCount(rows.length) })}
        />
        <StatCard
          face="sans"
          label={t("admin.invoices.outstanding")}
          value={aed(list.outstandingFils)}
        />
      </div>

      <div className="mt-[var(--gutter)]">
        <InvoiceTable rows={rows} />
      </div>

      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("admin.invoices.credit_note")}
      </p>

      {mayCredit && (
        <div className="mt-[var(--section-gap)]">
          <CreditPanel businesses={creditable} issueCredit={issueCredit} />
        </div>
      )}
    </AdminPage>
  );
}
