import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { Card } from "@/components/structure";
import {
  agreedAmount,
  agreedFacts,
  agreedWindowLine,
  commitmentLines,
  contractCard,
  reviewTiming,
  type ProposalRecordValue,
} from "@/lib/enquiry/accepted-proposal-words";
import { reviewRefusalWords, type ReviewRefusal } from "@/lib/enquiry/accepted-record-words";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board `7c-s` — the parts of the accepted record that replace the lines table
 * when what was accepted is a proposal.
 *
 * Server components with no data of their own; `_record.tsx` chooses them by the
 * shape of the accepted reply, on one route (`7c` and `7c-s` are selected by
 * what was accepted, not by a second URL).
 *
 * ## The three things most likely to be built wrong, and where each is held
 *
 * 1. **A total.** There is none, stored or computed, and the card says so in its
 *    own foot. The fee is printed at display scale beside its basis and nothing
 *    is multiplied (`B3`, Q1 is the owner's).
 * 2. **Editable exclusions.** Rendered verbatim from `quote_proposal`, which a
 *    trigger refuses to update once sent; no form on this page reaches it (`B2`).
 * 3. **A progress state.** No tracker, no countdown, no *completed*. The contract
 *    card reads the calendar — the term ends on a date — and never the work
 *    (`B9`). The commitments rail's dots are all one colour for the same reason:
 *    a green first dot reads as *done*.
 */

const EYEBROW = "font-mono text-eyebrow uppercase tracking-eyebrow";

/* ── What was agreed ─────────────────────────────────────────────────────── */

export function AgreedCard({ record }: { record: ProposalRecordValue }) {
  const proposal = record.quote.proposal;
  const amount = agreedAmount(record);
  const facts = agreedFacts(record);

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-[var(--card-pad)] py-3">
        <h2 className="text-h3 text-ink">{t("accepted_proposal.agreed.title")}</h2>
        <p className={`${EYEBROW} text-faint`}>{agreedWindowLine(record)}</p>
      </div>

      <div className="grid @2xl:grid-cols-[15rem_minmax(0,1fr)]">
        {/* Read-only: a property of their service, copied when they sent it (`B5`). */}
        <div className="border-b border-line bg-paper-sunk px-[var(--card-pad)] py-4 @2xl:border-b-0 @2xl:border-r">
          <p className={`${EYEBROW} text-faint`}>{t("accepted_proposal.basis.label")}</p>
          <p className="mt-1 text-body text-ink">{proposal.feeBasisLabel}</p>
          <p className="mt-2 text-body-sm text-muted">{t("accepted_proposal.basis.note")}</p>
        </div>
        {/* Read in order — *AED 18,400 per month, excluding VAT* — so no label is needed. */}
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-[var(--card-pad)] py-5">
          <span className="font-mono text-body-sm text-muted">{amount.currency}</span>
          <span className="font-mono text-display tabular-nums text-ink">{amount.figure}</span>
          <span className="text-body text-body">{amount.basis}</span>
        </p>
      </div>

      <dl className="grid border-t border-line @xl:grid-cols-3">
        {facts.map((fact, index) => (
          <div
            key={fact.key}
            className={[
              "px-[var(--card-pad)] py-3.5",
              index > 0 ? "border-t border-line @xl:border-l @xl:border-t-0" : "",
            ].join(" ")}
          >
            <dt className={`${EYEBROW} text-faint`}>{fact.label}</dt>
            {/* Unstated stays visible, grey — never hidden, never a zero. */}
            <dd className={fact.muted ? "mt-1 text-body-sm text-muted" : "mt-1 text-body text-ink"}>{fact.value}</dd>
          </div>
        ))}
      </dl>

      <p className="rounded-b-card border-t border-line bg-paper-sunk px-[var(--card-pad)] py-3 text-body-sm text-body">
        <strong className="font-medium text-ink">{t("accepted_proposal.no_total.lead")}</strong>{" "}
        {t("accepted_proposal.no_total.body")}
      </p>
    </Card>
  );
}

/* ── Scope ───────────────────────────────────────────────────────────────── */

export function ScopeCard({ record }: { record: ProposalRecordValue }) {
  const proposal = record.quote.proposal;
  const rows = [
    { key: "service", label: t("accepted_proposal.scope.service"), value: proposal.serviceName || null },
    { key: "deliverable", label: t("accepted.proposal.deliverable"), value: proposal.deliverable },
    { key: "where", label: t("accepted.proposal.delivered_where"), value: proposal.deliveredWhere },
  ];

  return (
    <Card padded>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h3 text-ink">{t("accepted_proposal.scope.title")}</h2>
        <p className="text-body-sm text-muted">{t("accepted_proposal.scope.note")}</p>
      </div>
      <p className="mt-3 max-w-[var(--measure-prose)] whitespace-pre-line text-body text-prose">{proposal.scope}</p>
      <dl className="mt-4 grid gap-x-6 gap-y-3 @xl:grid-cols-3">
        {rows.map((row) => (
          <div key={row.key}>
            <dt className={`${EYEBROW} text-faint`}>{row.label}</dt>
            <dd className={row.value ? "mt-1 text-body text-ink" : "mt-1 text-body-sm text-muted"}>
              {row.value ?? t("accepted_proposal.not_stated")}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/* ── Excluded — the loudest thing on the page ────────────────────────────── */

export function ExclusionsCard({ record }: { record: ProposalRecordValue }) {
  const exclusions = record.quote.proposal.exclusions;
  return (
    <div className="rounded-card border border-warn-line bg-warn-surface p-[var(--card-pad)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h3 text-warn-ink">{t("accepted_proposal.excluded.title")}</h2>
        <p className="text-body-sm text-warn-ink">{t("accepted_proposal.excluded.aside")}</p>
      </div>
      {/* Verbatim, as sent (`B2`). `whitespace-pre-line` keeps the seller's own line breaks. */}
      <blockquote
        className={
          exclusions
            ? "mt-3 whitespace-pre-line rounded-card border border-warn-line bg-card px-4 py-3 text-body text-ink"
            : "mt-3 rounded-card border border-warn-line bg-card px-4 py-3 text-body-sm text-muted"
        }
      >
        {exclusions ?? t("accepted.proposal.excluded_none", { supplier: record.supplier.displayName })}
      </blockquote>
      <p className="mt-3 max-w-[var(--measure-prose)] text-body-sm text-warn-ink">{t("accepted_proposal.excluded.note")}</p>
    </div>
  );
}

/* ── The rail ────────────────────────────────────────────────────────────── */

export function ProposalCommitmentsCard({ record }: { record: ProposalRecordValue }) {
  const lines = commitmentLines(record);
  return (
    <Card padded={false}>
      <h2 className="border-b border-line px-[var(--card-pad)] py-3 text-body font-medium text-ink">
        {t("accepted.commitments.title")}
      </h2>
      {lines.length === 0 ? (
        <p className="px-[var(--card-pad)] py-4 text-body-sm text-muted">
          {t("accepted_proposal.commitments.empty", { supplier: record.supplier.displayName })}
        </p>
      ) : (
        <ul className="flex flex-col gap-4 px-[var(--card-pad)] py-4">
          {lines.map((line) => (
            <li key={line.key} className="flex gap-3">
              <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-line-strong" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-body-sm text-ink">{line.text}</span>
                <span className={`${EYEBROW} text-faint`}>{line.source}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="rounded-b-card border-t border-line bg-paper-sunk px-[var(--card-pad)] py-3 text-caption text-muted">
        {t("accepted_proposal.commitments.note")}
      </p>
    </Card>
  );
}

export function ContractCard({
  record,
  now,
  rebrief,
}: {
  record: ProposalRecordValue;
  now: Date;
  rebrief: { supplier: string; others: string | null } | null;
}) {
  const words = contractCard(record, now);
  if (!words) return null;
  const warn = words.tone === "warn";

  return (
    <div
      className={
        warn
          ? "rounded-card border border-warn-line bg-warn-surface p-[var(--card-pad)]"
          : "rounded-card border border-line bg-paper-sunk p-[var(--card-pad)]"
      }
    >
      <h2 className={`${EYEBROW} ${warn ? "text-warn-ink" : "text-muted"}`}>{words.eyebrow}</h2>
      <p className={`mt-2 text-body-sm ${warn ? "text-warn-ink" : "text-body"}`}>{words.body}</p>
      {words.rebrief && rebrief ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={rebrief.supplier} className={buttonClassName({ variant: "secondary", size: "sm" })}>
            {t("accepted_proposal.rebrief.supplier", { supplier: record.supplier.displayName })}
          </Link>
          {rebrief.others ? (
            <Link href={rebrief.others} className={buttonClassName({ variant: "secondary", size: "sm" })}>
              {t("accepted_proposal.rebrief.others")}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ProposalReviewCard({
  record,
  now,
  reviewHref,
  refusal = null,
}: {
  record: ProposalRecordValue;
  now: Date;
  reviewHref: string;
  /** Why this reader may not write it, where they may not. See `AcceptedRecordView`. */
  refusal?: ReviewRefusal | null;
}) {
  const { review, supplier } = record;
  const timing = reviewTiming(record, now);

  return (
    <Card padded>
      <h2 className={`${EYEBROW} text-faint`}>{timing.eyebrow}</h2>
      {review.kind === "none" ? (
        timing.open && refusal ? (
          // No button to a form `createReview` would refuse.
          <p className="mt-2 text-body-sm text-body">{reviewRefusalWords(refusal, supplier.displayName)}</p>
        ) : timing.open ? (
          <>
            <p className="mt-2 text-body-sm text-body">
              {t("accepted_proposal.review.body", { label: t("reviewpage.provenance.accepted_quote") })}
            </p>
            <Link href={reviewHref} className={`mt-4 ${buttonClassName({ variant: "primary" })}`}>
              {t("accepted.review.write")}
            </Link>
          </>
        ) : (
          // No button before the day: a form the gate refuses is worse than none.
          <p className="mt-2 text-body-sm text-body">{timing.body}</p>
        )
      ) : review.kind === "posted" ? (
        <>
          <p className="mt-2 text-body-sm text-body">
            {t("accepted.review.posted", { supplier: supplier.displayName, when: formatDate(review.postedAt) })}
          </p>
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
