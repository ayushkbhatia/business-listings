import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel, PublicShell } from "@/components/structure";
import { StatusBadge } from "@/components/display/StatusBadge";
import { accountCounts } from "@/lib/account/overview";
import { requireBuyerSeat } from "@/lib/auth/buyer";
import { getViewer } from "@/lib/auth/viewer";
import { historyWords } from "@/lib/buyer-company/history-words";
import { approvalDetail } from "@/lib/buyer-company/queue";
import { amountWords, requestView } from "@/lib/buyer-company/request-words";
import { formatAED, formatDate, formatDateTime } from "@/lib/format";
import { feeOnBasis } from "@/lib/quote/proposal-words";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { AccountTabs } from "../../../_tabs";
import { RequestItem } from "../../_requests";

/**
 * Board `7b` — one request for approval, with everything an approver needs to
 * decide it and nothing they would have to open the raiser's inbox for.
 *
 * The quote as it was asked about — supplier, lines, total, validity, terms,
 * PO and cost code — the reasons the rule held it, who may approve it now, and
 * its history. Visible to the raiser, to whoever may approve it, and to the
 * company's admins; to anybody else it does not exist.
 */
export const metadata: Metadata = { title: t("company.approval_page.title") };
export const dynamic = "force-dynamic";

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireBuyerSeat(`/account/company/approvals/${encodeURIComponent(id)}`);
  const [detail, counts, viewer] = await Promise.all([approvalDetail(actor.id, id), accountCounts(actor.id), getViewer()]);
  if (!detail) notFound();

  const card = detail.card;
  const view = requestView(card, {
    thresholdAed: detail.thresholdAed,
    raiserLimit: detail.raiserLimit,
    viewerIsAdmin: detail.viewerIsAdmin,
  });

  return (
    <PublicShell bleed nav={<DirectoryNav viewer={viewer} />} footer={<DirectoryFooter />}>
      <AccountTabs active="company" counts={counts} />
      <div className="mx-auto grid w-full max-w-6xl gap-[var(--gutter)] px-5 py-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-[var(--gutter)]">
          <header>
            <p className="text-caption">
              <Link
                href="/account/company/approvals"
                className="rounded-tag text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("company.approval_page.back")}
              </Link>
            </p>
            <p className="mt-3 font-mono text-eyebrow uppercase tracking-eyebrow text-muted">
              {t("company.approval_page.eyebrow", { ref: card.enquiryRef, quote: card.quoteRef })}
            </p>
            <h1 className="mt-1 font-serif text-h1-serif text-ink">
              {t("company.approval_page.heading", { supplier: card.supplierName, amount: amountWords(card) })}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-body-sm text-body">
              <StatusBadge tone={view.stateTone} shape="chip">
                {view.stateLabel}
              </StatusBadge>
              <span>{view.stateLine}</span>
            </p>
          </header>

          <Panel title={t("company.approval_page.quote_title")}>
            <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-caption text-body">{t("company.approval_page.supplier")}</dt>
                <dd className="mt-0.5 flex flex-wrap items-center gap-2 text-body-sm text-ink">
                  <Link
                    href={`/b/${detail.quote.supplierSlug}`}
                    className="rounded-tag underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {card.supplierName}
                  </Link>
                  <span className="text-caption text-body">
                    {detail.quote.supplierVerified
                      ? t("company.approval_page.licence_verified")
                      : t("company.approval_page.licence_unverified")}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-caption text-body">{t("company.approval_page.requirement")}</dt>
                <dd className="mt-0.5 text-body-sm text-ink">{detail.requirement}</dd>
              </div>
              <div>
                <dt className="text-caption text-body">{t("company.approval_page.valid")}</dt>
                <dd className="mt-0.5 text-body-sm text-ink">
                  {detail.quote.expiresAt
                    ? t("company.approval_page.valid_until", { date: formatDate(detail.quote.expiresAt) })
                    : t("company.approval_page.valid_days", { days: detail.quote.validityDays })}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-body">{t("company.approval_page.terms")}</dt>
                <dd className="mt-0.5 text-body-sm text-ink">
                  {detail.quote.paymentTerms
                    ? t(`terms.${detail.quote.paymentTerms}` as "terms.net_30")
                    : t("accepted.not_stated")}
                  {" · "}
                  {detail.quote.delivery
                    ? t(`accepted.delivery.${detail.quote.delivery}` as "accepted.delivery.included")
                    : t("accepted.not_stated")}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-body">{t("company.approval_page.po")}</dt>
                <dd className={card.poNumber ? "mt-0.5 font-mono text-body-sm text-ink" : "mt-0.5 text-body-sm text-muted"}>
                  {card.poNumber ?? t("table.not_provided")}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-body">{t("company.approval_page.cost_code")}</dt>
                <dd className={card.costCode ? "mt-0.5 font-mono text-body-sm text-ink" : "mt-0.5 text-body-sm text-muted"}>
                  {card.costCode ?? t("table.not_provided")}
                </dd>
              </div>
            </dl>

            {card.proposal ? (
              <div className="mt-4 border-t border-line pt-4">
                <p className="text-body-sm text-ink">{feeOnBasis(card.proposal)}</p>
                {detail.proposalScope ? (
                  <p className="mt-2 max-w-[var(--measure-prose)] whitespace-pre-line text-caption text-body">{detail.proposalScope}</p>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto" tabIndex={0} role="group" aria-label={t("company.approval_page.lines_caption")}>
                <table className="w-full min-w-[30rem] border-collapse text-left">
                  <caption className="sr-only">{t("company.approval_page.lines_caption")}</caption>
                  <thead>
                    <tr className="border-b border-line">
                      <th scope="col" className="py-2 pr-3 font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                        {t("company.approval_page.col.item")}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                        {t("company.approval_page.col.qty")}
                      </th>
                      <th scope="col" className="px-3 py-2 text-right font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                        {t("company.approval_page.col.unit")}
                      </th>
                      <th scope="col" className="py-2 pl-3 text-right font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                        {t("company.approval_page.col.total")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((line) => (
                      <tr key={line.id} className="border-b border-line">
                        <th scope="row" className="py-2 pr-3 text-left text-body-sm font-normal text-ink">
                          {line.description}
                        </th>
                        <td className="px-3 py-2 text-right font-mono text-body-sm tabular-nums text-ink">
                          {line.qty ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-body-sm tabular-nums text-ink">
                          {formatAED(line.unitPrice, { style: "quote" })}
                        </td>
                        <td className="py-2 pl-3 text-right font-mono text-body-sm tabular-nums text-ink">
                          {formatAED(line.lineTotal, { style: "quote" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={3} className="py-2 pr-3 text-right text-caption font-normal text-body">
                        {t("accepted.total")}
                      </th>
                      <td className="py-2 pl-3 text-right font-mono text-body-sm tabular-nums text-ink">
                        {card.valueAed === null ? "—" : formatAED(card.valueAed, { style: "exact" })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Panel>

          <Panel title={t("company.approval_page.history_title")}>
            <ol className="space-y-3">
              {detail.timeline.map((line) => {
                const words = historyWords(line);
                return (
                  <li key={line.id} className="text-caption text-body">
                    <p>
                      <span className="text-ink">{words.sentence}</span>{" "}
                      <time dateTime={line.at.toISOString()} className="text-muted">
                        {formatDateTime(line.at)}
                      </time>
                    </p>
                    {words.quote ? (
                      <blockquote className="mt-1 border-l-2 border-line-strong pl-3 text-prose">{words.quote}</blockquote>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </Panel>
        </div>

        <aside className="min-w-0 space-y-[var(--gutter)]" aria-label={t("company.approval_page.decide_label")}>
          <Panel eyebrow={t("company.approval_page.decide_eyebrow")}>
            <RequestItem view={view} />
            {card.note ? (
              <div className="mt-4 border-t border-line pt-3">
                <p className="text-caption text-body">{t("company.approval_page.note_from", { name: card.raiserName })}</p>
                <blockquote className="mt-1 border-l-2 border-line-strong pl-3 text-caption text-prose">{card.note}</blockquote>
              </div>
            ) : null}
            {card.state.kind === "pending" ? (
              <p className="mt-4 border-t border-line pt-3 text-caption text-body">
                {card.approverNames.length > 0
                  ? t("company.approval_page.who_approves", { names: card.approverNames.join(", ") })
                  : t("company.request.waiting_on_nobody")}
              </p>
            ) : null}
          </Panel>
        </aside>
      </div>
    </PublicShell>
  );
}
