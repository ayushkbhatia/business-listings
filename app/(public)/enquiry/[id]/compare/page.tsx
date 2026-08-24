import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/primitives";
import { Card, PublicShell } from "@/components/structure";
import { StatusBadge } from "@/components/display/StatusBadge";
import { VerificationBadge, tierSpec } from "@/components/domain";
import { getBuyerEnquiry, type BuyerQuote } from "@/lib/db/queries/enquiry";
import { formatAED, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { resolveBuyerId, trackingTokenFor } from "../../_buyer";
import { acceptQuoteAction } from "../../actions";
import { acceptErrorMessage } from "../../_errors";

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

  const enquiry = await getBuyerEnquiry(buyerId, id);
  if (!enquiry) notFound();

  const token = await trackingTokenFor(buyerId);
  const quotes = enquiry.quotes.filter((q) => q.status !== "lost");
  if (quotes.length === 0) notFound();

  const error = acceptErrorMessage(one("error"));
  const accepted = enquiry.contactReleasedToBusinessId;

  const lowest = quotes.reduce((min, q) => (Number(q.totalAed) < Number(min.totalAed) ? q : min), quotes[0]!);
  const fastest = quotes.reduce((best, q) => {
    if (q.maxLeadTimeDays === null) return best;
    if (best.maxLeadTimeDays === null) return q;
    return q.maxLeadTimeDays < best.maxLeadTimeDays ? q : best;
  }, quotes[0]!);

  return (
    <PublicShell nav={<DirectoryNav />} footer={<DirectoryFooter />}>
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
                  <SupplierHead quote={quote} lowest={quote.id === lowest.id} fastest={quote.id === fastest.id && quote.maxLeadTimeDays !== null} />
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
                    {[line.size, `${line.qty}${line.unit ? ` ${line.unit}` : ""}`].filter(Boolean).join(" · ")}
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
}: {
  quote: BuyerQuote;
  lowest: boolean;
  fastest: boolean;
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
