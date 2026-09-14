import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { Card } from "@/components/structure";
import { StatusBadge } from "@/components/display";
import type { AcceptedRecord } from "@/lib/enquiry/accepted-record";
import { windowExpired } from "@/lib/enquiry/accepted-record";
import { formatAED, formatDate, formatPhone } from "@/lib/format";
import { contractCard } from "@/lib/enquiry/accepted-proposal-words";
import { t } from "@/lib/i18n";
import { leadTime, recordSummaryParts, totalLabel, windowLine } from "@/lib/enquiry/accepted-record-words";
import {
  isAcceptedProposal,
  paymentLine,
  proposalSummaryParts,
  siteLines,
  type ProposalRecordValue,
} from "@/lib/enquiry/accepted-proposal-words";
import {
  AgreedCard,
  ContractCard,
  ExclusionsCard,
  ProposalCommitmentsCard,
  ProposalReviewCard,
  ScopeCard,
} from "./_proposal-record";

/**
 * Board `7c` — the accepted quote record, rendered.
 *
 * A server component with no data of its own: the page loads the record and the
 * gallery hands it fixtures, and both render this. The two forms arrive as
 * elements rather than as functions, because a function cannot cross from a
 * server component into a client one — the repo's most repeated bug.
 *
 * ## What the page must never imply (`B10`)
 *
 * No *delivered*, no *in transit*, no *complete*, no progress bar. The platform
 * does not know any of it. The commitments rail looks like a timeline and says
 * in its own foot that it is the supplier's words, unverified.
 *
 * ## The no-payment stance, three times (§5 of the handoff)
 *
 * As a fact in the payment column, as an explanation in the panel under the
 * table, as a limit in the red panel. Repetition is the design; a copy edit
 * that folds them into one sentence removes the version a skimming buyer reads.
 */

export interface AcceptedRecordLinks {
  pdf: string;
  thread: string;
  review: string;
  /**
   * Board `7c-s`: briefing again, offered as a term nears its end. Built by the
   * page, because a gallery has no `/rfq/new` to send anybody to.
   */
  rebrief?: { supplier: string; others: string | null } | null;
}

export function AcceptedRecordView({
  record,
  now,
  links,
  breadcrumb,
  referenceForm,
  reportForm,
}: {
  record: AcceptedRecord;
  now: Date;
  links: AcceptedRecordLinks;
  /**
   * The page's own chrome, passed in. A breadcrumb is a named `nav` landmark,
   * and the gallery renders this view in several states on one page — where a
   * landmark the view drew for itself would appear once per state.
   */
  breadcrumb: React.ReactNode;
  /** `ReferenceForm`, or a static rendering of the reference in the gallery. */
  referenceForm: React.ReactNode;
  /** `ReportForm`. Rendered only while there is no report on this record. */
  reportForm: React.ReactNode;
}) {
  const { quote, supplier } = record;
  const expired = windowExpired(quote.expiresAt, now);
  // Board `7c-s`: one route, two shapes, chosen by what was accepted.
  const accepted: ProposalRecordValue | null = isAcceptedProposal(record) ? record : null;
  const contract = accepted ? (
    <ContractCard record={accepted} now={now} rebrief={links.rebrief ?? null} />
  ) : null;
  const contractLeads = accepted ? leadsRail(accepted, now) : false;

  const summary = [
    record.acceptedAt ? t("accepted.summary.accepted", { when: formatDate(record.acceptedAt) }) : null,
    ...(accepted ? proposalSummaryParts(accepted) : recordSummaryParts(record)),
  ].filter(Boolean);

  return (
    // Container queries rather than viewport ones: the record lays out by its own
    // width, so it reads the same in the gallery's column as on the full page.
    <div className="@container mx-auto w-full max-w-7xl px-5 pb-16 pt-8">
      <div className="grid gap-[var(--gutter)] @4xl:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ── The record ──────────────────────────────────────────────────── */}
        <div className="@container flex min-w-0 flex-col gap-[var(--gutter)]">
          <header className="flex flex-col gap-4 @2xl:flex-row @2xl:items-end @2xl:justify-between">
            <div className="min-w-0">
              {breadcrumb}
              {/* Seller identity is `displayName`, here as everywhere. */}
              <h1 className="mt-2 font-serif text-h1-serif text-ink">{supplier.displayName}</h1>
              <p className="mt-1.5 text-body-sm text-body">{summary.join(" · ")}</p>
              <div className="mt-1">{referenceForm}</div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {/* A plain link to a route handler: a file download, not a navigation. */}
              <a href={links.pdf} className={buttonClassName({ variant: "secondary" })}>
                {accepted ? t("accepted.action.pdf_proposal") : t("accepted.action.pdf")}
              </a>
              <Link href={links.thread} className={buttonClassName({ variant: "primary" })}>
                {t("accepted.action.message")}
              </Link>
            </div>
          </header>

          {/* ── Released, and the three facts ─────────────────────────────── */}
          <Card padded>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <StatusBadge tone="ok">{t("accepted.released")}</StatusBadge>
              <p className="text-body-sm text-body">
                {record.declinedCount > 0
                  ? t("accepted.released_declined", { count: record.declinedCount })
                  : t("accepted.released_only")}
              </p>
            </div>

            <dl className="mt-5 grid gap-5 @xl:grid-cols-3">
              <div>
                <dt className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                  {t("accepted.contact.who")}
                </dt>
                <dd className="mt-1.5 flex flex-col gap-0.5 text-body text-ink">
                  <ContactLines record={record} threadHref={links.thread} />
                </dd>
              </div>
              <div>
                <dt className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                  {accepted ? t("accepted_proposal.where.label") : t("accepted.where.label")}
                </dt>
                <dd className="mt-1.5 flex flex-col gap-0.5 text-body text-ink">
                  {accepted ? (
                    // Work happens at the buyer's site, not at the supplier's warehouse.
                    <SiteLines record={accepted} />
                  ) : supplier.location ? (
                    <>
                      <span>{supplier.location.addressLine}</span>
                      <span>
                        {[
                          supplier.location.areaName,
                          t(`emirate.${supplier.location.emirate}` as "emirate.dubai"),
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </>
                  ) : (
                    <span className="text-body-sm text-muted">{t("accepted.where.none")}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                  {t("accepted.payment.label")}
                </dt>
                <dd className="mt-1.5 flex flex-col gap-0.5 text-body">
                  {accepted ? (
                    <span className={paymentLine(accepted).muted ? "text-muted" : "text-ink"}>
                      {paymentLine(accepted).value}
                    </span>
                  ) : quote.paymentTerms ? (
                    <span className="text-ink">{t(`terms.${quote.paymentTerms}` as "terms.net_30")}</span>
                  ) : (
                    // Unfilled data stays visible, grey, rather than hidden.
                    <span className="text-muted">{t("accepted.not_stated")}</span>
                  )}
                  <span className="text-body-sm text-muted">{t("accepted.payment.invoiced_by_them")}</span>
                </dd>
              </div>
            </dl>
          </Card>

          {/* ── What was agreed — board `7c-s` ────────────────────────────────── */}
          {accepted ? (
            <>
              <AgreedCard record={accepted} />
              <ScopeCard record={accepted} />
              <ExclusionsCard record={accepted} />
            </>
          ) : (
          <Card padded={false}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-[var(--card-pad)] pb-3 pt-[var(--card-pad)]">
              <h2 className="text-h3 text-ink">{t("accepted.quoted.title")}</h2>
              <p
                className={
                  expired
                    ? "font-mono text-eyebrow uppercase tracking-eyebrow text-warn-ink"
                    : "font-mono text-eyebrow uppercase tracking-eyebrow text-faint"
                }
              >
                {windowLine(record, now)}
              </p>
            </div>

            {expired ? (
              <p className="mx-[var(--card-pad)] mb-3 max-w-[var(--measure-prose)] text-body-sm text-muted">
                {t("accepted.expired_note")}
              </p>
            ) : null}
            {record.isBrief && !quote.proposal ? (
              <p className="mx-[var(--card-pad)] mb-3 max-w-[var(--measure-prose)] text-body-sm text-muted">
                {t("accepted.brief_note")}
              </p>
            ) : null}

            {/*
               Focusable, so a phone-width buyer can scroll the lines with a
               keyboard (`scrollable-region-focusable`). A named group rather than
               a region: a region is a landmark, and the gallery renders this in
               five states — `ConsequenceTable` records the same trade.
            */}
            <div
              tabIndex={0}
              role="group"
              aria-label={t("accepted.quoted.scroll")}
              className="overflow-x-auto focus-visible:shadow-focus focus-visible:outline-none"
            >
              <table className="w-full min-w-[40rem] border-collapse text-left">
                <caption className="sr-only">
                  {t("accepted.quoted.caption", { supplier: supplier.displayName })}
                </caption>
                <thead>
                  <tr className="border-y border-line bg-paper-sunk">
                    <th scope="col" className="px-[var(--card-pad)] py-2 font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                      {t("accepted.col.line")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                      {t("accepted.col.qty")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                      {t("accepted.col.unit")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                      {t("accepted.col.line_total")}
                    </th>
                    <th scope="col" className="px-[var(--card-pad)] py-2 font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted">
                      {t("accepted.col.supplier_said")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {quote.lines.map((line) => (
                    <tr key={line.id} className="border-b border-line align-top">
                      <th scope="row" className="px-[var(--card-pad)] py-3 text-left font-normal">
                        <span className="block text-body text-ink">{line.description}</span>
                        {line.manual ? (
                          <span className="mt-0.5 block font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                            {t("accepted.line.manual")}
                          </span>
                        ) : line.sku ? (
                          <span className="mt-0.5 block font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                            {line.sku}
                          </span>
                        ) : null}
                      </th>
                      <td className="px-3 py-3 text-right font-mono text-body-sm tabular-nums text-ink">
                        {line.qty === null ? (
                          <span className="font-sans text-caption text-muted">{t("accepted.line.whole")}</span>
                        ) : (
                          line.qty
                        )}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-body-sm tabular-nums text-ink">
                        {formatAED(line.unitPrice, { style: "quote" })}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-body tabular-nums text-ink">
                        {formatAED(line.lineTotal, { style: "quote" })}
                      </td>
                      <td
                        className={
                          line.leadTimeDays === null
                            ? "px-[var(--card-pad)] py-3 text-body-sm text-muted"
                            : "px-[var(--card-pad)] py-3 text-body-sm text-body"
                        }
                      >
                        {leadTime(line.leadTimeDays)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-paper-sunk">
                    <th scope="row" colSpan={3} className="px-[var(--card-pad)] py-3 text-left text-body font-medium text-ink">
                      {totalLabel(record)}
                    </th>
                    <td className="px-3 py-3 text-right font-mono text-body tabular-nums text-ink">
                      {/* Computed from the lines by `recordLines`, never stored (`B2`). */}
                      {formatAED(quote.totalAed, { style: "quote" })}
                    </td>
                    <td className="px-[var(--card-pad)] py-3" />
                  </tr>
                </tfoot>
              </table>
            </div>

            {quote.note ? (
              <div className="px-[var(--card-pad)] py-[var(--card-pad)]">
                <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                  {t("accepted.supplier_note")}
                </p>
                <p className="mt-1 max-w-[var(--measure-prose)] whitespace-pre-line text-body-sm text-prose">
                  {quote.note}
                </p>
              </div>
            ) : null}
          </Card>
          )}

          {/* ── Where our part ends ───────────────────────────────────────── */}
          <div className="flex flex-col gap-4 rounded-card border border-line bg-paper-sunk p-[var(--card-pad)] @2xl:flex-row @2xl:items-center @2xl:justify-between">
            <div className="max-w-[var(--measure-prose)]">
              <h2 className="text-body font-medium text-ink">
                {t("accepted.between.title", { supplier: supplier.displayName })}
              </h2>
              <p className="mt-1 text-body-sm text-body">
                {accepted ? t("accepted_proposal.between.body") : t("accepted.between.body")}
              </p>
            </div>
            <Link href={links.thread} className={buttonClassName({ variant: "secondary" })}>
              {t("accepted.thread")}
            </Link>
          </div>
        </div>

        {/* ── The rail ────────────────────────────────────────────────────── */}
        {/*
           A div, not an aside or a labelled section. The gallery renders this
           view in several states on one page, and every named landmark would
           appear there more than once — which axe fails the build over.
        */}
        <div className="flex flex-col gap-[var(--gutter)]">
          {accepted ? (
            <>
              {/* §States: once the term has started, coming back is the page's use. */}
              {contractLeads ? contract : null}
              <ProposalCommitmentsCard record={accepted} />
              <ProposalReviewCard record={accepted} now={now} reviewHref={links.review} />
              {contractLeads ? null : contract}
            </>
          ) : (
            <>
              <CommitmentsCard record={record} />
              <ReviewCard record={record} reviewHref={links.review} />
            </>
          )}
          <ProblemCard record={record} reportForm={reportForm} />
        </div>
      </div>
    </div>
  );
}

function leadsRail(record: ProposalRecordValue, now: Date): boolean {
  return contractCard(record, now)?.leadsRail ?? false;
}

function SiteLines({ record }: { record: ProposalRecordValue }) {
  const lines = siteLines(record);
  if (lines.length === 0) {
    return <span className="text-body-sm text-muted">{t("accepted_proposal.where.none")}</span>;
  }
  return (
    <>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </>
  );
}

function ContactLines({ record, threadHref }: { record: AcceptedRecord; threadHref: string }) {
  const { supplier } = record;
  const phones = [supplier.person?.phone, supplier.phone].filter(
    (phone, index, all): phone is string => Boolean(phone) && all.indexOf(phone) === index,
  );

  return (
    <>
      <span>
        {supplier.person ? `${supplier.person.name}, ${supplier.person.role}` : supplier.displayName}
      </span>
      {phones.map((phone) => (
        <a
          key={phone}
          href={`tel:${phone.replace(/[^\d+]/g, "")}`}
          className="w-fit rounded-tag font-mono text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {formatPhone(phone)}
        </a>
      ))}
      {supplier.whatsapp ? (
        <span className="font-mono text-body-sm text-body">
          {t("accepted.contact.whatsapp", { number: formatPhone(supplier.whatsapp) })}
        </span>
      ) : null}
      {phones.length === 0 && !supplier.whatsapp ? (
        <Link
          href={threadHref}
          className="w-fit rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("accepted.contact.no_phone")}
        </Link>
      ) : null}
    </>
  );
}

function CommitmentsCard({ record }: { record: AcceptedRecord }) {
  const { commitments, supplier } = record;
  return (
    <Card padded={false}>
      <h2 className="border-b border-line px-[var(--card-pad)] py-3 text-body font-medium text-ink">
        {t("accepted.commitments.title")}
      </h2>
      {commitments.length === 0 ? (
        <p className="px-[var(--card-pad)] py-4 text-body-sm text-muted">
          {t("accepted.commitments.empty", { supplier: supplier.displayName })}
        </p>
      ) : (
        <ol className="flex flex-col gap-4 px-[var(--card-pad)] py-4">
          {commitments.map((commitment, index) => (
            <li key={`${commitment.messageId}-${index}`} className="flex gap-3">
              <span
                aria-hidden="true"
                className={
                  index === commitments.length - 1
                    ? "mt-1.5 size-2 shrink-0 rounded-full bg-moss"
                    : "mt-1.5 size-2 shrink-0 rounded-full bg-line-strong"
                }
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                {/* The supplier's words, quoted — never our reading of them. */}
                <q className="text-body-sm text-ink before:content-none after:content-none">{commitment.text}</q>
                <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
                  {t("accepted.commitments.said", {
                    when: formatDate(commitment.saidAt),
                    supplier: supplier.displayName,
                  })}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="rounded-b-card border-t border-line bg-paper-sunk px-[var(--card-pad)] py-3 text-caption text-muted">
        {t("accepted.commitments.note")}
      </p>
    </Card>
  );
}

function ReviewCard({ record, reviewHref }: { record: AcceptedRecord; reviewHref: string }) {
  const { review, supplier } = record;
  return (
    <Card padded>
      <h2 className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
        {t("accepted.review.eyebrow")}
      </h2>
      {review.kind === "none" ? (
        <>
          <p className="mt-2 text-body-sm text-body">{t("accepted.review.body")}</p>
          <Link href={reviewHref} className={`mt-4 ${buttonClassName({ variant: "primary" })}`}>
            {t("accepted.review.write")}
          </Link>
        </>
      ) : review.kind === "posted" ? (
        <>
          <p className="mt-2 text-body-sm text-body">
            {t("accepted.review.posted", { supplier: supplier.displayName, when: formatDate(review.postedAt) })}
          </p>
          {/* A link to the review rather than a second prompt. */}
          <Link href={reviewHref} className={`mt-3 ${buttonClassName({ variant: "secondary" })}`}>
            {t("accepted.review.read")}
          </Link>
        </>
      ) : (
        <p className="mt-2 text-body-sm text-body">
          {review.kind === "held"
            ? t("accepted.review.held", { supplier: supplier.displayName })
            : t("accepted.review.removed", { supplier: supplier.displayName })}
        </p>
      )}
    </Card>
  );
}

function ProblemCard({ record, reportForm }: { record: AcceptedRecord; reportForm: React.ReactNode }) {
  const { report } = record;
  return (
    <div className="rounded-card border border-bad-line bg-bad-wash p-[var(--card-pad)]">
      <h2 className="font-mono text-eyebrow uppercase tracking-eyebrow text-bad-ink">
        {t("accepted.problem.eyebrow")}
      </h2>
      <p className="mt-2 text-body-sm text-bad-ink">{t("accepted.problem.body")}</p>

      <div className="mt-4">
        {report.kind === "none" ? (
          reportForm
        ) : report.kind === "open" ? (
          <p className="text-body-sm text-bad-ink">
            {t("accepted.report.case_open", { when: formatDate(report.filedAt) })}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-body-sm text-bad-ink">
              {t("accepted.report.case_resolved", {
                when: formatDate(report.filedAt),
                closed: formatDate(report.resolvedAt),
                outcome: t(`accepted.report.outcome.${report.outcome}` as "accepted.report.outcome.no_action"),
              })}
            </p>
            {report.reason ? (
              <p className="text-body-sm text-bad-ink">
                {t("accepted.report.reason", { reason: report.reason })}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <p className="mt-3 text-caption text-bad-ink">{t("accepted.problem.outcomes")}</p>
    </div>
  );
}
