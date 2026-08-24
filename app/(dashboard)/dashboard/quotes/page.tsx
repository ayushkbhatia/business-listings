import Link from "next/link";
import { StatusBadge, type StatusTone } from "@/components/display/StatusBadge";
import { Card } from "@/components/structure";
import { getQuotesForBusiness, type QuoteRow } from "@/lib/db/queries/seller";
import { formatAED, formatCountdown, formatDate, formatRelative, isWithinRelativeWindow } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";

/**
 * Board 3k — quotes sent.
 *
 * The pipeline, and the one place a seller sees at a glance how many lines they
 * priced by hand. That count is the signal their catalogue has a gap: every
 * hand-priced line is a line the matcher could not place, and a seller who fixes
 * it quotes faster next time.
 */
export const metadata = { title: "Quotes sent" };
export const dynamic = "force-dynamic";

const STATE_TONE: Record<string, StatusTone> = {
  draft: "neutral",
  sent: "info",
  read: "info",
  accepted: "ok",
  declined: "neutral",
  expired: "warn",
  withdrawn: "neutral",
};

const STATE_LABEL = {
  draft: "quotes.state.draft",
  sent: "quotes.state.sent",
  read: "quotes.state.read",
  accepted: "quotes.state.accepted",
  declined: "quotes.state.declined",
  expired: "quotes.state.expired",
  withdrawn: "quotes.state.withdrawn",
} as const;

export default async function QuotesPage() {
  const seat = await requireSellerSeat();
  const [quotes, badges] = await Promise.all([
    getQuotesForBusiness(seat.businessId),
    getNavBadges(seat.businessId),
  ]);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/quotes"
      title={t("quotes.title")}
      meta={
        <span className="text-caption text-muted">{t("quotes.subtitle", { count: quotes.length })}</span>
      }
    >
      {quotes.length === 0 ? <EmptyQuotes /> : <QuotesTable quotes={quotes} />}
    </SellerPage>
  );
}

function EmptyQuotes() {
  return (
    <Card padded>
      <h2 className="text-h3 text-ink">{t("quotes.empty_title")}</h2>
      <p className="mt-2 max-w-prose text-body-sm text-muted">{t("quotes.empty_body")}</p>
    </Card>
  );
}

function QuotesTable({ quotes }: { quotes: readonly QuoteRow[] }) {
  const now = new Date();
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-left">
          <caption className="sr-only">{t("quotes.caption")}</caption>
          <thead>
            <tr className="bg-paper-sunk">
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("quotes.col.ref")}</th>
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("quotes.col.enquiry")}</th>
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("quotes.col.buyer")}</th>
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("quotes.col.lines")}</th>
              <th scope="col" className="px-3 py-2 text-right text-caption font-normal text-muted">{t("quotes.col.value")}</th>
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("quotes.col.sent")}</th>
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("quotes.col.state")}</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((quote) => (
              <tr key={quote.id} className="border-t border-line align-top">
                <th scope="row" className="px-3 py-3 text-left font-normal">
                  <Link
                    href={`/dashboard/leads/${quote.enquiryId}/thread`}
                    className="rounded-tag font-mono text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                    aria-label={t("quotes.open_named", { ref: quote.ref })}
                  >
                    {quote.ref}
                  </Link>
                  {quote.superseded ? (
                    <span className="mt-0.5 block text-caption text-muted">
                      {t("quotes.superseded", { revision: quote.revision + 1 })}
                    </span>
                  ) : null}
                </th>
                <td className="px-3 py-3 font-mono text-body-sm text-muted">{quote.enquiryRef}</td>
                <td className="px-3 py-3 text-body-sm text-ink">{quote.buyer.firstName}</td>
                <td className="px-3 py-3 text-body-sm text-ink">
                  {quote.lineCount}
                  {quote.manualLineCount > 0 ? (
                    <span className="mt-0.5 block text-caption text-muted">
                      {t("quotes.manual_lines", { count: quote.manualLineCount })}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-body-sm text-ink">
                  {formatAED(quote.totalAed)}
                </td>
                <td className="px-3 py-3 text-body-sm text-muted">
                  {quote.sentAt ? formatRelative(quote.sentAt, { now }) : "—"}
                  {quote.expiresAt ? (
                    <span className="mt-0.5 block text-caption text-muted">
                      {quote.expiresAt.getTime() <= now.getTime()
                        ? t("quotes.expired_on", { when: formatDate(quote.expiresAt) })
                        : isWithinRelativeWindow(quote.expiresAt, { now })
                          ? t("quotes.expires_in", { duration: formatCountdown(quote.expiresAt, { now }) })
                          : t("quotes.expires_on", { when: formatDate(quote.expiresAt) })}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-3">
                  <StatusBadge tone={STATE_TONE[quote.status] ?? "neutral"} size="sm" shape="chip">
                    {t(STATE_LABEL[quote.status as keyof typeof STATE_LABEL] ?? "quotes.state.draft")}
                  </StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-3 py-2 text-caption text-muted">{t("quotes.value_note")}</p>
    </div>
  );
}
