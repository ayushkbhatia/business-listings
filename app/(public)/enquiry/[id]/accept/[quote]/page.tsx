import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Alert } from "@/components/display/Alert";
import { Input, Label, Textarea } from "@/components/primitives";
import { Card, Panel, PublicShell } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { acceptanceOutlook } from "@/lib/buyer-company/queue";
import { amountWords, requestView } from "@/lib/buyer-company/request-words";
import { reasonLine } from "@/lib/buyer-company/words";
import { filsToAed, quoteTotalFils } from "@/lib/quote/money";
import { toProposalFigure, PROPOSAL_FIGURE_SELECT } from "@/lib/quote/proposal";
import { commitmentFils } from "@/lib/buyer-company/value";
import { formatAED, formatDate, formatList } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter } from "@/app/(public)/_chrome";
import { ViewerNav } from "@/app/(public)/_account-menu";
import { companyError } from "@/app/(public)/account/company/_errors";
import { RequestItem } from "@/app/(public)/account/company/_requests";
import { resolveBuyerId } from "../../../_buyer";
import { actorFor } from "@/lib/auth/actor";
import { mayAcceptQuote } from "@/lib/auth/guards";
import { companyAcceptAction } from "../../../actions";
import { SubmitDecision } from "./_submit";

/**
 * Board `7b` `B1` — accepting a quote on an enquiry raised for a company.
 *
 * Every accept control on a company enquiry — the comparison, the proposal
 * comparison, the thread — leads here, because the company's rule has to be
 * read before the click rather than met after it (`B3`: *the queue must not
 * behave in a way the card does not describe*). The page says which of three
 * things will happen: it is within your authority and is accepted; it goes to
 * named colleagues for approval, with every reason the rule holds it; or
 * nobody on the team can approve it, and why.
 *
 * The PO number and cost code are asked for here when the company requires
 * them, because this is the last platform-side act before money is committed —
 * and they are written with the acceptance, onto the record the supplier sees.
 *
 * An enquiry raised by a person rather than a company has nothing to decide
 * here; it goes back to the comparison, where accepting is one click.
 */
export const metadata: Metadata = {
  title: t("company.accept.title"),
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function AcceptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; quote: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, quote: quoteId } = await params;
  const query = await searchParams;
  const one = (key: string) => (typeof query[key] === "string" ? query[key] : undefined);

  const buyerId = await resolveBuyerId(one("t"));
  if (!buyerId) notFound();

  const enquiry = await prisma.enquiry.findFirst({
    where: { OR: [{ ref: id }, { id }], buyerId },
    select: { id: true, ref: true, buyerCompanyId: true, closesAt: true, contactReleasedToBusinessId: true },
  });
  if (!enquiry) notFound();
  const tokenCarry = one("t") ? `?t=${encodeURIComponent(one("t")!)}` : "";
  if (!enquiry.buyerCompanyId) redirect(`/enquiry/${enquiry.id}/compare${tokenCarry}`);

  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, enquiryId: enquiry.id, status: { not: "draft" } },
    select: {
      id: true,
      ref: true,
      revision: true,
      status: true,
      expiresAt: true,
      business: { select: { displayName: true, slug: true } },
      lines: { select: { qty: true, unitPrice: true } },
      proposal: { select: PROPOSAL_FIGURE_SELECT },
    },
  });
  if (!quote) notFound();

  const now = new Date();
  const outlook = await acceptanceOutlook(buyerId, enquiry, quote.id, now);
  const proposal = toProposalFigure(quote.proposal);
  const valueFils = commitmentFils({
    lines: quote.lines.map((line) => ({ qty: line.qty, unitPrice: line.unitPrice.toString() })),
    proposal: quote.proposal
      ? {
          feeBasis: quote.proposal.feeBasis,
          feeAed: quote.proposal.feeAed?.toString() ?? null,
          mobilisationAed: quote.proposal.mobilisationAed?.toString() ?? null,
        }
      : null,
  });
  const amount = amountWords({ valueAed: valueFils === null ? null : filsToAed(valueFils), proposal });
  const linesTotal = filsToAed(quoteTotalFils(quote.lines.map((line) => ({ qty: line.qty, unitPrice: line.unitPrice.toString() }))));

  const closed = enquiry.closesAt.getTime() <= now.getTime();
  const expired = quote.expiresAt !== null && quote.expiresAt.getTime() < now.getTime();
  const acceptable = !enquiry.contactReleasedToBusinessId && !closed && !expired && (quote.status === "sent" || quote.status === "read");
  // Build plan 9.4: `acceptQuote` and `requestApproval` both ask `quote.accept`
  // first, so neither form is offered to a person they would refuse.
  const mayAccept = mayAcceptQuote(await actorFor(buyerId));
  const compareHref = `/enquiry/${enquiry.id}/compare`;

  const error = one("error");
  const requested = one("requested") === "1";

  return (
    <PublicShell nav={<ViewerNav />} footer={<DirectoryFooter />}>
      <div className="mx-auto w-full max-w-[48rem] space-y-5 px-[var(--section-pad)] py-8">
        <header>
          <p className="text-caption">
            <Link
              href={compareHref}
              className="rounded-tag text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("company.accept.back")}
            </Link>
          </p>
          <p className="mt-3 font-mono text-eyebrow uppercase tracking-eyebrow text-muted">
            {t("enquiry.ref", { ref: enquiry.ref })}
          </p>
          <h1 className="mt-1 font-serif text-h1-serif text-ink">{t("company.accept.heading", { quote: quote.ref })}</h1>
        </header>

        <Card padded>
          <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-3">
            <div>
              <dt className="text-caption text-body">{t("company.approval_page.supplier")}</dt>
              <dd className="mt-0.5 text-body-sm text-ink">
                <Link
                  href={`/b/${quote.business.slug}`}
                  className="rounded-tag underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {quote.business.displayName}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-caption text-body">{proposal ? t("company.accept.fee") : t("accepted.total")}</dt>
              <dd className="mt-0.5 font-mono text-body-sm tabular-nums text-ink">
                {proposal ? amount : formatAED(linesTotal, { style: "exact" })}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-body">{t("company.approval_page.valid")}</dt>
              <dd className="mt-0.5 text-body-sm text-ink">
                {quote.expiresAt
                  ? t("company.approval_page.valid_until", { date: formatDate(quote.expiresAt) })
                  : t("accepted.not_stated")}
              </dd>
            </div>
          </dl>
        </Card>

        {requested ? (
          <Alert tone="ok" live="polite">
            {t("company.accept.requested")}
          </Alert>
        ) : null}
        {error ? (
          <Alert tone="bad" live="assertive" fix={companyError(error)}>
            {t("company.error.not_done")}
          </Alert>
        ) : null}

        {outlook.kind === "personal" ? null : outlook.kind === "not_member" ? (
          <Alert tone="warn" live="off" fix={t("company.accept.not_member_fix")}>
            {t("company.accept.not_member", { company: outlook.companyName })}
          </Alert>
        ) : !acceptable ? (
          <Alert tone="neutral" live="off">
            {enquiry.contactReleasedToBusinessId
              ? t("compare.error_already_accepted")
              : closed
                ? t("compare.error_enquiry_closed")
                : expired
                  ? t("compare.error_expired")
                  : t("compare.error_not_open")}
          </Alert>
        ) : !mayAccept ? (
          // The alert above already carries this sentence when a post was refused for it.
          error === "not_permitted" ? null : (
            <Alert tone="neutral" live="off">
              {t("compare.error_not_permitted")}
            </Alert>
          )
        ) : outlook.openRequest && outlook.openRequest.quoteId === quote.id ? (
          <Panel eyebrow={t("company.accept.open_eyebrow")}>
            <RequestItem
              view={requestView(outlook.openRequest, {
                thresholdAed: outlook.thresholdAed,
                raiserLimit:
                  outlook.role === "procurement" && outlook.limitAed !== null
                    ? { usedAed: outlook.usedAed, limitAed: outlook.limitAed }
                    : null,
                viewerIsAdmin: outlook.role === "company_admin",
              })}
            />
          </Panel>
        ) : (
          <Panel
            title={
              !outlook.need.required
                ? t("company.accept.within_title")
                : outlook.approverNames.length > 0
                  ? t("company.accept.approval_title", { names: formatList(outlook.approverNames) })
                  : t("company.accept.nobody_title")
            }
          >
            {outlook.openRequest ? (
              <div className="mb-4">
                <Alert tone="info" live="off">
                  {outlook.need.required
                    ? t("company.accept.replaces", { quote: outlook.openRequest.quoteRef })
                    : t("company.accept.closes_request", { quote: outlook.openRequest.quoteRef })}
                </Alert>
              </div>
            ) : null}

            {!outlook.need.required ? (
              <p className="max-w-[var(--measure-prose)] text-body-sm text-body">
                {outlook.role === "company_admin"
                  ? t("company.accept.within_admin", { company: outlook.companyName })
                  : t("company.accept.within_limit", {
                      remaining: formatAED(outlook.remainingAed ?? "0"),
                      limit: formatAED(outlook.limitAed ?? 0),
                    })}{" "}
                {t("company.accept.releases", { supplier: quote.business.displayName })}
              </p>
            ) : (
              <>
                <ul className="space-y-1 text-body-sm text-body">
                  {outlook.need.reasons.map((reason) => (
                    <li key={reason}>
                      {reasonLine(reason, {
                        thresholdAed: outlook.thresholdAed,
                        raiserName: t("company.accept.you"),
                        usedAed: outlook.usedAed,
                        limitAed: outlook.limitAed,
                      })}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 max-w-[var(--measure-prose)] text-caption text-body">
                  {outlook.approverNames.length > 0
                    ? t("company.accept.approval_body", { supplier: quote.business.displayName })
                    : outlook.gap
                      ? t("company.accept.nobody_gap")
                      : t("company.accept.nobody_body")}
                </p>
              </>
            )}

            {!outlook.need.required || outlook.approverNames.length > 0 ? (
              <form action={companyAcceptAction} className="mt-5 space-y-4">
                <input type="hidden" name="quoteId" value={quote.id} />
                <input type="hidden" name="enquiryId" value={enquiry.id} />
                <input type="hidden" name="intent" value={outlook.need.required ? "request" : "accept"} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <Label
                      htmlFor="accept-po"
                      requirement={outlook.policy.requirePoNumber ? "required" : "optional"}
                      requirementLabel={outlook.policy.requirePoNumber ? t("company.field.required_marker") : t("company.field.optional_marker")}
                      hint={t("company.accept.po_hint")}
                    >
                      {t("company.approval_page.po")}
                    </Label>
                    <Input id="accept-po" name="poNumber" mono maxLength={40} required={outlook.policy.requirePoNumber} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label
                      htmlFor="accept-cost"
                      requirement={outlook.policy.requireCostCode ? "required" : "optional"}
                      requirementLabel={outlook.policy.requireCostCode ? t("company.field.required_marker") : t("company.field.optional_marker")}
                      hint={t("company.accept.cost_hint")}
                    >
                      {t("company.approval_page.cost_code")}
                    </Label>
                    <Input id="accept-cost" name="costCode" mono maxLength={40} required={outlook.policy.requireCostCode} />
                  </div>
                </div>
                {outlook.need.required ? (
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="accept-note" requirement="optional" requirementLabel={t("company.field.optional_marker")}>
                      {t("company.accept.note")}
                    </Label>
                    <Textarea id="accept-note" name="note" rows={3} limit={1000} />
                  </div>
                ) : null}
                <SubmitDecision
                  label={
                    outlook.need.required
                      ? t("company.accept.send_for_approval")
                      : t("company.accept.submit", { quote: `r${quote.revision}`, amount })
                  }
                />
              </form>
            ) : null}
          </Panel>
        )}
      </div>
    </PublicShell>
  );
}
