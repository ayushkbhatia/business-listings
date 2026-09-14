import Link from "next/link";
import { notFound } from "next/navigation";
import { KeyValuePanel, Panel } from "@/components/structure";
import { StatusBadge } from "@/components/display";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { recordLines } from "@/lib/enquiry/accepted-record";
import { formatAED, formatDate, formatDateTime } from "@/lib/format";
import { feeOnBasis, mobilisationWords, termWords } from "@/lib/quote/proposal-words";
import { t } from "@/lib/i18n";
import { reportEvidence } from "@/lib/reports/service";
import { AdminPage, getAdminNavBadges } from "../../../_shell";

/**
 * Board `7c` `B8` — the evidence behind a report filed from an accepted record.
 *
 * *"Goes to the trust team with the thread attached."* This is the attachment:
 * the buyer's report, the quote as it was accepted, and every message between
 * the buyer and that one supplier, in order, with the automatic and the flagged
 * ones marked as such.
 *
 * Read-only. The outcome is decided in the queue at `/admin/reports`, by the
 * same `resolveReport` every other supplier report goes through — three
 * outcomes, a written reason, an audit row — so there is one place a report is
 * closed and one audit trail for it.
 */
export const dynamic = "force-dynamic";

export default async function ReportEvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const seat = await requireStaff();
  if (!can(seat.actor, "report.resolve")) notFound();

  const { id } = await params;
  const [evidence, badges] = await Promise.all([reportEvidence(id), getAdminNavBadges(seat)]);
  if (!evidence) notFound();

  const { report, enquiry, quote, messages } = evidence;
  const supplier = report.subjectBusiness.displayName;
  const priced = quote
    ? recordLines(
        quote.lines.map((line) => ({
          id: line.id,
          description: line.description,
          qty: line.qty,
          unitPrice: line.unitPrice.toFixed(2),
          leadTimeDays: line.leadTimeDays,
          productId: null,
          sku: null,
        })),
      )
    : null;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/reports"
      title={t("admin.report_evidence.title", { supplier })}
      eyebrow={t(`admin.reports.kind.${report.kind}` as "admin.reports.kind.accepted_quote")}
      breadcrumb={
        <Link
          href="/admin/reports"
          className="rounded-tag text-caption text-muted underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("admin.report_evidence.back")}
        </Link>
      }
      meta={
        report.outcome ? (
          <StatusBadge tone="neutral">
            {t("admin.report_evidence.resolved", {
              outcome: t(`admin.reports.outcome.${report.outcome}` as "admin.reports.outcome.upheld"),
            })}
          </StatusBadge>
        ) : (
          <StatusBadge tone="warn">{t("admin.report_evidence.open")}</StatusBadge>
        )
      }
    >
      <div className="flex flex-col gap-[var(--gutter)]">
        <Panel title={t("admin.report_evidence.report")}>
          <KeyValuePanel
            columns={2}
            notProvidedLabel={t("table.not_provided")}
            entries={[
              { key: "enquiry", label: t("admin.report_evidence.enquiry"), value: enquiry.ref },
              { key: "filed", label: t("admin.report_evidence.filed"), value: formatDateTime(report.createdAt) },
              {
                key: "reporter",
                label: t("admin.report_evidence.reporter"),
                value: report.reporter?.fullName ?? undefined,
              },
              {
                key: "accepted",
                label: t("admin.report_evidence.accepted"),
                value: enquiry.contactReleasedAt ? formatDate(enquiry.contactReleasedAt) : undefined,
              },
              {
                key: "detail",
                label: t("admin.report_evidence.detail"),
                value: report.detail ?? undefined,
                wide: true,
              },
              ...(report.outcome
                ? [
                    {
                      key: "reason",
                      label: t("admin.report_evidence.reason"),
                      value: report.outcomeReason ?? undefined,
                      wide: true,
                    },
                  ]
                : []),
            ]}
          />
        </Panel>

        <Panel
          title={t("admin.report_evidence.quote")}
          {...(quote
            ? {
                description: t("admin.report_evidence.quote_meta", {
                  ref: quote.ref,
                  revision: quote.revision,
                  terms: quote.paymentTerms
                    ? t(`terms.${quote.paymentTerms}` as "terms.net_30")
                    : t("accepted.not_stated"),
                }),
              }
            : {})}
        >
          {quote?.proposal ? (
            /*
               Board `3j-s`. A proposal has no lines to tabulate; the trust team
               reads the fee, the terms, the scope and the exclusions — the list a
               month-four argument is usually about.
            */
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {[
                { key: "fee", label: t("accepted.proposal.fee"), value: feeOnBasis(quote.proposal) },
                { key: "term", label: t("accepted.proposal.term"), value: termWords(quote.proposal.termMonths) },
                {
                  key: "mobilisation",
                  label: t("accepted.proposal.mobilisation"),
                  value: mobilisationWords(quote.proposal.mobilisationAed),
                },
                { key: "service", label: t("accepted.proposal.service"), value: quote.proposal.serviceName },
                { key: "scope", label: t("accepted.proposal.scope"), value: quote.proposal.scope },
                {
                  key: "excluded",
                  label: t("accepted.proposal.excluded"),
                  value: quote.proposal.exclusions ?? t("accepted.proposal.excluded_none", { supplier }),
                },
              ].map((fact) => (
                <div key={fact.key} className={fact.key === "scope" || fact.key === "excluded" ? "sm:col-span-2" : ""}>
                  <dt className="text-caption text-muted">{fact.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-line text-body-sm text-ink">{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : quote && priced ? (
            <div
              tabIndex={0}
              role="group"
              aria-label={t("accepted.quoted.scroll")}
              className="overflow-x-auto focus-visible:shadow-focus focus-visible:outline-none"
            >
              <table className="w-full min-w-[32rem] border-collapse text-left">
                <caption className="sr-only">{t("admin.report_evidence.quote_caption", { supplier })}</caption>
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="py-1.5 pr-3 text-caption font-normal text-muted">
                      {t("accepted.col.line")}
                    </th>
                    <th scope="col" className="px-3 py-1.5 text-right text-caption font-normal text-muted">
                      {t("accepted.col.qty")}
                    </th>
                    <th scope="col" className="px-3 py-1.5 text-right text-caption font-normal text-muted">
                      {t("accepted.col.unit")}
                    </th>
                    <th scope="col" className="py-1.5 pl-3 text-right text-caption font-normal text-muted">
                      {t("accepted.col.line_total")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {priced.lines.map((line) => (
                    <tr key={line.id} className="border-b border-line">
                      <th scope="row" className="py-2 pr-3 text-left text-body-sm font-normal text-ink">
                        {line.description}
                      </th>
                      <td className="px-3 py-2 text-right font-mono text-body-sm tabular-nums">
                        {line.qty ?? t("accepted.line.whole")}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-body-sm tabular-nums">
                        {formatAED(line.unitPrice, { style: "quote" })}
                      </td>
                      <td className="py-2 pl-3 text-right font-mono text-body-sm tabular-nums">
                        {formatAED(line.lineTotal, { style: "quote" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row" colSpan={3} className="py-2 pr-3 text-left text-body-sm font-medium text-ink">
                      {t("accepted.total")}
                    </th>
                    <td className="py-2 pl-3 text-right font-mono text-body-sm tabular-nums text-ink">
                      {formatAED(priced.totalAed, { style: "quote" })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="text-body-sm text-muted">{t("admin.report_evidence.no_quote")}</p>
          )}
        </Panel>

        <Panel
          title={t("admin.report_evidence.thread")}
          description={t("admin.report_evidence.thread_count", { count: messages.length })}
        >
          {messages.length === 0 ? (
            <p className="text-body-sm text-muted">{t("admin.report_evidence.no_messages")}</p>
          ) : (
            <ol className="flex flex-col">
              {messages.map((message) => (
                <li key={message.id} className="flex flex-col gap-1 border-t border-line py-3 first:border-t-0">
                  <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                    <span className="text-ink">
                      {message.fromSupplier ? supplier : t("admin.report_evidence.buyer")}
                    </span>
                    <span>{formatDateTime(message.createdAt)}</span>
                    {message.automatic ? <span>{t("admin.report_evidence.automatic")}</span> : null}
                    {message.flagged ? (
                      <span className="text-bad-ink">{t("admin.report_evidence.flagged")}</span>
                    ) : null}
                  </p>
                  <p className="max-w-[var(--measure-prose)] whitespace-pre-line text-body-sm text-body">
                    {message.body}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}
