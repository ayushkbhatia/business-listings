import type { Metadata } from "next";
import { after } from "next/server";
import { notFound, redirect } from "next/navigation";
import { PublicShell } from "@/components/structure";
import { PageEvent } from "@/components/telemetry";
import { accountCounts } from "@/lib/account/overview";
import { signInHref } from "@/lib/auth/next-path";
import { getViewer } from "@/lib/auth/viewer";
import { comparisonOutlook, openRequestOn } from "@/lib/buyer-company/queue";
import { getProposalComparison } from "@/lib/db/queries/proposal-comparison";
import { getQuoteComparison } from "@/lib/db/queries/quote-comparison";
import { t } from "@/lib/i18n";
import { markQuotesRead } from "@/lib/messaging/receipts";
import { buildComparison, readSort, type QuotedRow } from "@/lib/quote/comparison";
import { AREA_MAX, VISITS_MAX, readFigure } from "@/lib/quote/proposal-footing";
import { isVerified } from "@/lib/verification";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { AccountTabs } from "@/app/(public)/account/_tabs";
import { resolveBuyerId, trackingTokenFor } from "../../_buyer";
import { acceptQuoteAction } from "../../actions";
import { acceptErrorMessage } from "../../_errors";
import { ApprovalNotice } from "../../_approval-notice";
import { ProposalComparisonView } from "./_proposals";
import { QuoteComparisonView } from "./_quotes";
import { messageAllAction } from "./actions";

/**
 * Board `1n` — comparing the quotes received. Board `1n-s` when the enquiry is
 * a brief for work.
 *
 * `/enquiry/:id/compare`, a reference or an id, as every route under the
 * enquiry has been since handoff 2. The handoff's `/account/rfq/:id` and
 * `/account/enquiries/:id/compare` redirect here (`next.config.ts`): the
 * tracking page, the thread, the accept screen and the accepted record all live
 * under `/enquiry/:id`, and one enquiry under two namespaces is one record with
 * two addresses a buyer can bookmark differently.
 *
 * Private to the buyer — a signed-in one, or one with no account carrying the
 * claim token their enquiry was created with. Nobody else resolves: an unknown
 * reference and somebody else's enquiry are the same 404. A visitor who is
 * neither is sent to sign in and brought back here (`7a` B9), which says
 * nothing about whether the enquiry exists.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("compare.quotes_title"),
  // Private to the buyer: prices sent to them alone, behind a bearer token.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
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
  if (!buyerId) redirect(signInHref(`/enquiry/${encodeURIComponent(id)}/compare`));

  const viewer = await getViewer();
  const counts = viewer ? await accountCounts(buyerId) : null;
  const tabs = viewer && counts ? <AccountTabs active="enquiries" counts={counts} /> : null;
  const error = acceptErrorMessage(one("error"));

  /*
     Board `1n-s`: an enquiry for work is compared as proposals — each fee in its
     own unit, one labelled row of our arithmetic, and nothing ranked.
  */
  const proposals = await getProposalComparison(buyerId, id);
  if (proposals) {
    const token = await trackingTokenFor(buyerId);
    if (proposals.columns.length > 0) after(() => markQuotesRead(proposals.enquiryId, buyerId));
    return (
      <PublicShell bleed nav={<DirectoryNav viewer={viewer} />} footer={<DirectoryFooter />}>
        {tabs}
        <ProposalComparisonView
          comparison={proposals}
          now={new Date()}
          token={token}
          figures={{
            areaSqFt: readFigure(one("area"), AREA_MAX),
            visitsPerYear: readFigure(one("visits"), VISITS_MAX),
          }}
          error={error}
          acceptAction={acceptQuoteAction}
        />
      </PublicShell>
    );
  }

  const data = await getQuoteComparison(buyerId, id);
  if (!data) notFound();

  const now = new Date();
  const model = buildComparison(data.input, now, readSort(one("sort")));
  const quoted = model.rows.filter((row): row is QuotedRow => row.kind === "quoted");

  const [token, outlook, openRequest] = await Promise.all([
    trackingTokenFor(buyerId),
    /*
       Board `7b` `B7`: the company's rule read once for every quote on the page,
       so each row can say whether accepting it goes to a colleague first. The
       value is the same one the gate holds against a limit — the quote's total,
       excluding VAT — and the supplier's tier is the one the gate reads.
    */
    comparisonOutlook(
      buyerId,
      data.enquiry,
      quoted
        .filter((row) => row.state === "open")
        .map((row) => ({
          id: row.quote.id,
          valueFils: row.totalFils,
          supplierVerified: isVerified(row.supplier.verificationTier),
        })),
      now,
    ),
    model.phase === "accepted" ? null : openRequestOn(buyerId, data.enquiry, now),
  ]);

  /*
     Board 11b §6, the buyer's half of the receipt. A read should not block on a
     write, and `readAt` is not part of what this page renders.
  */
  if (quoted.length > 0) after(() => markQuotesRead(data.enquiry.id, buyerId));

  return (
    <PublicShell bleed nav={<DirectoryNav viewer={viewer} />} footer={<DirectoryFooter />}>
      {tabs}
      <PageEvent
        name="quotes_compared"
        props={{ quotes: model.quoted, lines: model.lines.length, sort: model.sort, phase: model.phase }}
      />
      <QuoteComparisonView
        data={data}
        model={model}
        now={now}
        token={token}
        outlook={outlook}
        approvalNotice={openRequest ? <ApprovalNotice card={openRequest} /> : null}
        error={error}
        acceptAction={acceptQuoteAction}
        messageAllAction={messageAllAction}
      />
    </PublicShell>
  );
}
