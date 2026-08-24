import Link from "next/link";
import { StatusBadge, type StatusTone } from "@/components/display/StatusBadge";
import { Card } from "@/components/structure";
import { getLeadsForBusiness, type LeadRow } from "@/lib/db/queries/seller";
import { formatAED, formatDate, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";

/**
 * Board 3j — leads and RFQ inbox.
 *
 * Every row here is masked. A seller sees the requirement and a first name;
 * the phone number, email and company name are not in the payload at all until
 * the buyer accepts. That decision is made in lib/db/queries/seller-visibility.ts
 * and this screen has no way to undo it.
 */
export const metadata = { title: "Leads & RFQ" };
export const dynamic = "force-dynamic";

const STATE_TONE: Record<string, StatusTone> = {
  delivered: "info",
  opened: "warn",
  quoted: "ok",
  declined: "neutral",
  no_response: "neutral",
};

const STATE_LABEL = {
  delivered: "leads.state.delivered",
  opened: "leads.state.opened",
  quoted: "leads.state.quoted",
  declined: "leads.state.declined",
  no_response: "leads.state.no_response",
} as const;

export default async function LeadsPage() {
  const seat = await requireSellerSeat();
  const [leads, badges] = await Promise.all([
    getLeadsForBusiness(seat.businessId),
    getNavBadges(seat.businessId),
  ]);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/leads"
      title={t("leads.title")}
      meta={
        <span className="text-caption text-muted">
          {t("leads.subtitle", { count: leads.length })}
        </span>
      }
    >
      {leads.length === 0 ? <EmptyLeads /> : <LeadsTable leads={leads} />}
    </SellerPage>
  );
}

function EmptyLeads() {
  return (
    <Card padded>
      <h2 className="text-h3 text-ink">{t("leads.empty_title")}</h2>
      <p className="mt-2 max-w-prose text-body-sm text-muted">{t("leads.empty_body")}</p>
    </Card>
  );
}

function LeadsTable({ leads }: { leads: readonly LeadRow[] }) {
  const now = new Date();
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-left">
          <caption className="sr-only">{t("leads.caption")}</caption>
          <thead>
            <tr className="bg-paper-sunk">
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("leads.col.ref")}</th>
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("leads.col.requirement")}</th>
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("leads.col.buyer")}</th>
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("leads.col.received")}</th>
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("leads.col.closes")}</th>
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("leads.col.state")}</th>
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("leads.col.quote")}</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.enquiryId} className="border-t border-line align-top">
                <th scope="row" className="px-3 py-3 text-left font-normal">
                  <Link
                    href={`/dashboard/leads/${lead.enquiryId}/thread`}
                    className="rounded-tag font-mono text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                    aria-label={t("leads.open_named", { ref: lead.ref })}
                  >
                    {lead.ref}
                  </Link>
                </th>
                <td className="max-w-[26rem] px-3 py-3">
                  <span className="line-clamp-2 text-body-sm text-ink">{lead.requirement}</span>
                  <span className="mt-0.5 block text-caption text-muted">
                    {t("leads.lines_and_qty", { count: lead.lineCount, qty: lead.totalQty })}
                    {lead.deliverToArea ? ` · ${lead.deliverToArea}` : ""}
                  </span>
                </td>
                {/* A first name. The rest is released on acceptance, not here. */}
                <td className="px-3 py-3 text-body-sm text-ink">{lead.buyer.firstName}</td>
                <td className="px-3 py-3 text-body-sm text-muted">
                  {formatRelative(lead.createdAt, { now })}
                </td>
                <td className="px-3 py-3 text-body-sm text-muted">
                  {lead.closesAt.getTime() > now.getTime()
                    ? formatRelative(lead.closesAt, { now })
                    : t("leads.closed")}
                </td>
                <td className="px-3 py-3">
                  <StatusBadge tone={STATE_TONE[lead.state] ?? "neutral"} size="sm" shape="chip">
                    {t(STATE_LABEL[lead.state as keyof typeof STATE_LABEL] ?? "leads.state.delivered")}
                  </StatusBadge>
                </td>
                <td className="px-3 py-3 text-body-sm">
                  {lead.latestQuote ? (
                    <span className="font-mono tabular-nums text-ink">
                      {t("leads.quote_summary", {
                        revision: lead.latestQuote.revision,
                        total: formatAED(lead.latestQuote.totalAed),
                      })}
                    </span>
                  ) : (
                    <span className="text-muted">{t("leads.no_quote_yet")}</span>
                  )}
                  {lead.neededBy ? (
                    <span className="mt-0.5 block text-caption text-muted">
                      {formatDate(lead.neededBy)}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
