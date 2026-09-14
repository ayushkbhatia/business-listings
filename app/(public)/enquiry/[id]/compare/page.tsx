import type { Metadata } from "next";
import { after } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/primitives";
import { Card, PublicShell } from "@/components/structure";
import { StatusBadge } from "@/components/display/StatusBadge";
import { VerificationBadge, tierSpec } from "@/components/domain";
import { getBuyerEnquiry, type BuyerQuote } from "@/lib/db/queries/enquiry";
import { formatAED, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter } from "@/app/(public)/_chrome";
import { ViewerNav } from "@/app/(public)/_account-menu";
import { markQuotesRead } from "@/lib/messaging/receipts";
import { resolveBuyerId, trackingTokenFor } from "../../_buyer";
import { acceptQuoteAction } from "../../actions";
import { acceptErrorMessage } from "../../_errors";
import { getProposalComparison } from "@/lib/db/queries/proposal-comparison";
import { AREA_MAX, VISITS_MAX, readFigure } from "@/lib/quote/proposal-footing";
import { ProposalComparisonView } from "./_proposals";

/**
 * Board 1n — the quotes side by side.
 *
 * A real table: the buyer is comparing numbers down a column, which is what a
 * table is for, and reading one aloud row by row is how somebody without sight
 * does the same comparison.
 *
 * The accept button names the revision and the amount, because "Accept" alone
 * on a screen with four columns is a button that does not say what it does.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("compare.quotes_title"),
  // Private to the buyer: a comparison of prices sent to them alone.
  robots: { index: false, follow: false },
};

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const one = (key: string) => (typeof query[key] === "string" ? query[key] : undefined);

  const buyerId = await resolveBuyerId(one("t"));
  if (!buyerId) notFound();

  /*
     Board `1n-s`: an enquiry for work is compared as proposals — each fee in its
     own unit, one labelled row of our arithmetic, and nothing ranked. It renders
     with no replies yet too: the brief and who it went to, not a 404.
  */
  const comparison = await getProposalComparison(buyerId, id);
  if (comparison) {
    const token = await trackingTokenFor(buyerId);
    if (comparison.columns.length > 0) after(() => markQuotesRead(comparison.enquiryId, buyerId));
    return (
      <PublicShell nav={<ViewerNav />} footer={<DirectoryFooter />}>
        <ProposalComparisonView
          comparison={comparison}
          now={new Date()}
          token={token}
          figures={{
            areaSqFt: readFigure(one("area"), AREA_MAX),
            visitsPerYear: readFigure(one("visits"), VISITS_MAX),
          }}
          error={acceptErrorMessage(one("error"))}
          acceptAction={acceptQuoteAction}
        />
      </PublicShell>
    );
  }

  const enquiry = await getBuyerEnquiry(buyerId, id);
  if (!enquiry) notFound();

  const token = await trackingTokenFor(buyerId);
  const quotes = enquiry.quotes.filter((q) => q.status !== "lost");
  if (quotes.length === 0) notFound();

  /*
     Board 11b §6, the buyer's half of the receipt. A read should not block on a
     write, and `readAt` is not part of what this page renders — the seller's
     inbox is where it surfaces.

     This is the first writer the column has ever had. It was declared in the
     init migration, set by the seed and read by the dashboard, so the seller's
     "Buyer opened your quote" line was true on a seeded database and silently
     false everywhere else.
  */
  after(() => markQuotesRead(id, buyerId));

  const error = acceptErrorMessage(one("error"));
  const accepted = enquiry.contactReleasedToBusinessId;
  /*
     Board `10e` `B3` and `10h`'s states: closed with nothing accepted is
     terminal, and `acceptQuote` refuses it. The buttons were live on a closed
     enquiry, so a buyer met the refusal only after pressing.
  */
  const closed = !accepted && enquiry.closesAt.getTime() <= new Date().getTime();
  const carry = token ? `?t=${encodeURIComponent(token)}` : "";

  const lowest = quotes.reduce((min, q) => (Number(q.totalAed) < Number(min.totalAed) ? q : min), quotes[0]!);
  const fastest = quotes.reduce((best, q) => {
    if (q.maxLeadTimeDays === null) return best;
    if (best.maxLeadTimeDays === null) return q;
    return q.maxLeadTimeDays < best.maxLeadTimeDays ? q : best;
  }, quotes[0]!);

  return (
    <PublicShell nav={<ViewerNav />} footer={<DirectoryFooter />}>
      <div className="mx-auto w-full max-w-[64rem] px-[var(--section-pad)] py-8">
      <p className="font-mono text-eyebrow uppercase text-faint">{t("enquiry.ref", { ref: enquiry.ref })}</p>
      <h1 className="mt-2 font-serif text-h1-serif text-ink">{t("compare.quotes_title")}</h1>

      {quotes.length === 1 ? (
        <p className="mt-2 text-body-sm text-muted">{t("compare.only_one")}</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-4 rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink">
          {error}
        </p>
      ) : null}

      {closed && !error ? (
        <p className="mt-4 rounded-ctl border border-line bg-paper-sunk px-3 py-2 text-body-sm text-body">
          {t("compare.error_enquiry_closed")}
        </p>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full min-w-[48rem] border-collapse text-left">
          <caption className="sr-only">{t("compare.quotes_caption")}</caption>
          <thead>
            <tr className="bg-paper-sunk">
              <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                {t("compare.supplier")}
              </th>
              {quotes.map((quote) => (
                <th key={quote.id} scope="col" className="px-3 py-2 align-top">
                  <SupplierHead
                    quote={quote}
                    lowest={quote.id === lowest.id}
                    fastest={quote.id === fastest.id && quote.maxLeadTimeDays !== null}
                    threadHref={`/enquiry/${encodeURIComponent(enquiry.ref)}/thread/${quote.business.slug}${carry}`}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {enquiry.lines.map((line) => (
              <tr key={line.id} className="border-t border-line">
                <th scope="row" className="px-3 py-2 text-left font-normal">
                  <span className="block text-body-sm text-ink">{line.description}</span>
                  <span className="block font-mono text-caption text-muted">
                    {/* A line with no quantity contributes nothing here rather
                        than a `1` the buyer never asked for. */}
                    {[
                      line.size,
                      line.qty === null ? null : `${line.qty}${line.unit ? ` ${line.unit}` : ""}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </th>
                {quotes.map((quote) => {
                  const match = quote.lines.find((l) => sameLine(l.description, line.description));
                  return (
                    <td key={quote.id} className="px-3 py-2 font-mono tabular-nums text-body-sm text-ink">
                      {match ? (
                        <>
                          {formatAED(match.unitPrice, { style: "quote" })}
                          {match.leadTimeDays !== null ? (
                            <span className="mt-0.5 block text-caption text-muted">
                              {t("quote.validity_days", { count: match.leadTimeDays })}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted">{t("compare.no_quote_for_line")}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong">
              <th scope="row" className="px-3 py-3 text-left font-normal text-ink">
                {t("compare.total")}
              </th>
              {quotes.map((quote) => (
                <td key={quote.id} className="px-3 py-3 font-mono text-body tabular-nums text-ink">
                  {formatAED(quote.totalAed)}
                  {quote.expiresAt ? (
                    <span className="mt-0.5 block text-caption font-sans text-muted">
                      {t("compare.validity")} {formatDate(quote.expiresAt)}
                    </span>
                  ) : null}
                </td>
              ))}
            </tr>
            {/*
               Board `7c`: the terms each supplier quoted, beside the total and
               before the accept button. The accepted record shows these as
               *payment agreed*, and they are only agreed if the buyer could read
               them at the moment of accepting. Not stated is shown, grey.
            */}
            <tr className="border-t border-line">
              <th scope="row" className="px-3 py-2 text-left text-body-sm font-normal text-ink">
                {t("quote.terms.label")}
              </th>
              {quotes.map((quote) => (
                <td
                  key={quote.id}
                  className={quote.paymentTerms ? "px-3 py-2 text-body-sm text-ink" : "px-3 py-2 text-body-sm text-muted"}
                >
                  {quote.paymentTerms
                    ? t(`terms.${quote.paymentTerms}` as "terms.net_30")
                    : t("accepted.not_stated")}
                </td>
              ))}
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="px-3 py-2 text-left text-body-sm font-normal text-ink">
                {t("quote.delivery.label")}
              </th>
              {quotes.map((quote) => (
                <td
                  key={quote.id}
                  className={quote.delivery ? "px-3 py-2 text-body-sm text-ink" : "px-3 py-2 text-body-sm text-muted"}
                >
                  {quote.delivery
                    ? t(`compare.delivery.${quote.delivery}` as "compare.delivery.included")
                    : t("accepted.not_stated")}
                </td>
              ))}
            </tr>
            <tr className="border-t border-line">
              <th scope="row" className="px-3 py-3 text-left font-normal">
                <span className="sr-only">{t("compare.accept", { ref: "", total: "" })}</span>
              </th>
              {quotes.map((quote) => (
                <td key={quote.id} className="px-3 py-3 align-top">
                  {accepted ? (
                    accepted === quote.business.id ? (
                      <StatusBadge tone="ok" shape="chip">
                        {t("quotes.state.accepted")}
                      </StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral" shape="chip">
                        {t("quotes.state.lost")}
                      </StatusBadge>
                    )
                  ) : closed ? (
                    <Button type="button" size="sm" block disabled>
                      {t("compare.accept", {
                        ref: `r${quote.revision}`,
                        total: formatAED(quote.totalAed),
                      })}
                    </Button>
                  ) : (
                    <form action={acceptQuoteAction}>
                      <input type="hidden" name="quoteId" value={quote.id} />
                      <input type="hidden" name="enquiryId" value={enquiry.id} />
                      {token ? <input type="hidden" name="token" value={token} /> : null}
                      <Button type="submit" size="sm" block>
                        {t("compare.accept", {
                          ref: `r${quote.revision}`,
                          total: formatAED(quote.totalAed),
                        })}
                      </Button>
                    </form>
                  )}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Said before the button is pressed, not after. */}
      <Card padded>
        <p className="max-w-[var(--measure-prose)] text-body-sm text-muted">
          {t("compare.what_accepting_means")}
        </p>
      </Card>

      <p className="mt-4">
        <Link
          href={token ? `/enquiry/${enquiry.id}?t=${token}` : `/enquiry/${enquiry.id}`}
          className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("enquiry.track")}
        </Link>
      </p>
      </div>
    </PublicShell>
  );
}

function SupplierHead({
  quote,
  lowest,
  fastest,
  threadHref,
}: {
  quote: BuyerQuote;
  lowest: boolean;
  fastest: boolean;
  /** Board `10h`: push on this supplier before choosing between them. */
  threadHref: string;
}) {
  const spec = tierSpec(quote.business.verificationTier);
  return (
    <span className="block">
      <Link
        href={`/b/${quote.business.slug}`}
        className="rounded-tag text-body-sm font-normal text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
      >
        {quote.business.displayName}
      </Link>
      <span className="mt-1 block">
        <VerificationBadge
          tier={quote.business.verificationTier}
          label={t(spec.labelKey as never)}
          checked={t(spec.checkedKey as never)}
          tierLabel={t("verify.tier", { tier: quote.business.verificationTier })}
          size="sm"
          compact
        />
      </span>
      <a
        href={threadHref}
        aria-label={t("track.thread_named", { supplier: quote.business.displayName })}
        className="mt-1 inline-block rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
      >
        {t("track.thread")}
      </a>
      <span className="mt-1 flex flex-wrap gap-1">
        {lowest ? (
          <StatusBadge tone="ok" size="sm" shape="chip">
            {t("compare.lowest")}
          </StatusBadge>
        ) : null}
        {fastest ? (
          <StatusBadge tone="info" size="sm" shape="chip">
            {t("compare.fastest")}
          </StatusBadge>
        ) : null}
      </span>
    </span>
  );
}

/**
 * Does this quote line answer that enquiry line?
 *
 * Sellers rewrite a description in their own words, so an exact match finds
 * almost nothing. Comparing the significant words is enough to line a column
 * up, and a miss shows "not quoted" rather than a wrong price against the
 * wrong row — which is the failure that matters here.
 */
function sameLine(quoteLine: string, enquiryLine: string): boolean {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9"]+/)
        .filter((w) => w.length > 2),
    );
  const a = words(quoteLine);
  const b = words(enquiryLine);
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const word of b) if (a.has(word)) shared += 1;
  return shared / b.size >= 0.5;
}
