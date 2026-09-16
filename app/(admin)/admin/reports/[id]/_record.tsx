import { Panel } from "@/components/structure";
import { recordLines } from "@/lib/enquiry/accepted-record";
import { formatAED, formatDateTime } from "@/lib/format";
import { feeOnBasis, mobilisationWords, termWords } from "@/lib/quote/proposal-words";
import { t } from "@/lib/i18n";
import type { reportEvidence } from "@/lib/reports/service";

/**
 * Board `7c` `B8` — the accepted record behind a report, and the thread with it.
 *
 * *"Goes to the trust team with the thread attached."* This is the attachment:
 * the quote as it was accepted, and every message between the buyer and that
 * one supplier, in order, with the automatic and the flagged ones marked.
 *
 * Lifted out of `[id]/page.tsx` unchanged when board 4h gave that route a
 * decision panel and a reason to answer for every report kind rather than only
 * this one. It renders for a report that carries an enquiry and for no other,
 * which is `B12`: *a dispute points at its accepted-quote record.*
 */

export function AcceptedRecord({
  evidence,
  supplier,
}: {
  evidence: NonNullable<Awaited<ReturnType<typeof reportEvidence>>>;
  supplier: string;
}) {
  const { quote, messages } = evidence;
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
    <>
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
    </>
  );
}
