import Link from "next/link";
import { StatusBadge } from "@/components/display/StatusBadge";
import { credentialName } from "@/components/domain/CredentialTable";
import { Button, buttonClassName } from "@/components/primitives";
import type { ComparisonColumn, ProposalComparison } from "@/lib/db/queries/proposal-comparison";
import { briefFactWords } from "@/lib/enquiry/service-brief-words";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  AREA_MAX,
  VISITS_MAX,
  figuresWanted,
  footingRowShown,
  twelveMonthFooting,
  type Footing,
} from "@/lib/quote/proposal-footing";
import { notComputableWords, workingWords } from "@/lib/quote/proposal-footing-words";
import { feeAmount, paymentTermsWords, termWords } from "@/lib/quote/proposal-words";

/**
 * Board `1n-s` — proposals compared, and nothing ranked.
 *
 * A server component with no data of its own: the page loads the comparison and
 * hands the buyer's figures from the query string; the gallery hands fixtures.
 * Accept is a server action on a plain form, and the figures are a plain GET
 * form, so the whole page works before any script loads.
 *
 * ## The order of the rows is the instruction
 *
 * *As proposed* first — the supplier's own figure in their own unit, never
 * converted (B1). Then the one row the platform made up, labelled as ours with
 * its working in every cell (B2). Then the supplier's words: term, turnaround,
 * scope, deliverable, exclusions, credentials. Only then the accept controls
 * (B11) — *read the excluded row before the fee row* depends on that order.
 *
 * ## What is deliberately absent
 *
 * No sort, no *best value*, no highlighted column, no lowest badge (B7). The
 * first column's accept is the primary button because it is first, and the
 * columns are in the order the proposals arrived.
 */

export interface ComparisonFigures {
  areaSqFt: number | null;
  visitsPerYear: number | null;
}

export function ProposalComparisonView({
  comparison,
  now,
  token,
  figures,
  error,
  acceptAction,
  mayAccept = true,
  idPrefix = "compare",
}: {
  comparison: ProposalComparison;
  now: Date;
  token: string | null;
  figures: ComparisonFigures;
  error: string | null;
  /** Ids on the page are prefixed with this, so the gallery can render several states. */
  idPrefix?: string;
  /** The accept server action — passed in so the gallery can render the page without one. */
  acceptAction?: (formData: FormData) => Promise<void>;
  /**
   * Build plan 9.4: whether this person holds `quote.accept`, which the service
   * asks before anything else. False takes the accept controls away and says why.
   */
  mayAccept?: boolean;
}) {
  const carry = token ? `?t=${token}` : "";
  const accepted = comparison.acceptedBusinessId !== null;
  const replied = comparison.columns.length;
  const site = comparison.brief ? briefFactWords(comparison.brief).site : null;
  const title = site ? t("compare_proposals.title_site", { trade: comparison.subcategoryName, site }) : comparison.subcategoryName;

  return (
    <div className="mx-auto w-full max-w-7xl px-[var(--section-pad)] pb-16">
      <header className="border-b border-line py-8">
        <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted">
          {t("compare_proposals.eyebrow", {
            ref: comparison.ref,
            sent: formatDate(comparison.createdAt),
            replied: formatCount(replied),
            total: formatCount(comparison.recipientCount),
          })}
        </p>
        <h1 className="mt-2 font-serif text-h1-serif text-ink">{title}</h1>
        <HeaderLine comparison={comparison} />
      </header>

      {error ? (
        <p role="alert" className="mt-6 rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink">
          {error}
        </p>
      ) : null}

      {/* Said only where an accept would otherwise be offered: closed or accepted says so per cell. */}
      {!mayAccept && !accepted && !error && replied > 0 && comparison.closesAt.getTime() > now.getTime() ? (
        <p className="mt-6 rounded-ctl border border-line bg-paper-sunk px-3 py-2 text-body-sm text-body">
          {t("compare.error_not_permitted")}
        </p>
      ) : null}

      {replied === 0 ? (
        <NoRepliesYet comparison={comparison} />
      ) : (
        <>
          {/*
             The table first, as drawn. The figures the platform will not guess
             follow it, and every cell waiting on one links down to it.
          */}
          <ComparisonTable
            comparison={comparison}
            now={now}
            token={token}
            figures={figures}
            acceptAction={acceptAction}
            mayAccept={mayAccept}
            idPrefix={idPrefix}
          />
          <Footnote comparison={comparison} figures={figures} />
          {!accepted ? (
            <FiguresForm
              comparison={comparison}
              figures={figures}
              token={token}
              interactive={acceptAction !== undefined}
              idPrefix={idPrefix}
            />
          ) : null}
        </>
      )}

      <p className="mt-6">
        <Link
          href={`/enquiry/${comparison.enquiryId}${carry}`}
          className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("enquiry.track")}
        </Link>
      </p>
    </div>
  );
}

/* ── The header's second line ─────────────────────────────────────────────── */

/**
 * B8: the suppliers who have not replied are counted and named, never dropped.
 * A supplier who declined says so, with their words.
 */
function HeaderLine({ comparison }: { comparison: ProposalComparison }) {
  const waiting = comparison.waiting.length;
  const parts = [
    comparison.firstProposalInMs !== null
      ? t("compare_proposals.first_back", { duration: formatDuration(comparison.firstProposalInMs) })
      : null,
    comparison.acceptedBusinessId
      ? null
      : waiting > 0
        ? t("compare_proposals.waiting", { count: waiting, formatted: formatCount(waiting) })
        : null,
  ].filter((part): part is string => part !== null);

  return (
    <div className="mt-3 space-y-1">
      {parts.length > 0 ? <p className="text-body text-body">{parts.join(" ")}</p> : null}
      {waiting > 0 && !comparison.acceptedBusinessId ? (
        <p className="text-body-sm text-muted">
          {t("compare_proposals.waiting_names", { names: comparison.waiting.map((r) => r.displayName).join(", ") })}
        </p>
      ) : null}
      {comparison.declined.length > 0 ? (
        <ul className="list-none space-y-0.5 p-0 text-body-sm text-muted">
          {comparison.declined.map((r) => (
            <li key={r.businessId}>
              {r.declineReason
                ? t("compare_proposals.declined_reason", { name: r.displayName, reason: r.declineReason })
                : t("compare_proposals.declined", { name: r.displayName })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ── No replies yet ───────────────────────────────────────────────────────── */

/** §States: *the page is the brief plus who it went to, not an empty table.* */
function NoRepliesYet({ comparison }: { comparison: ProposalComparison }) {
  const facts = comparison.brief ? briefFactWords(comparison.brief) : null;
  return (
    <div className="mt-8 grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="rounded-card border border-line bg-card p-[var(--card-pad)]">
        <h2 className="text-h3 text-ink">{t("compare_proposals.none_title")}</h2>
        <p className="mt-1 max-w-[var(--measure-prose)] text-body-sm text-muted">
          {t("compare_proposals.none_body", {
            count: comparison.recipientCount,
            formatted: formatCount(comparison.recipientCount),
          })}
        </p>
        <dl className="mt-4 space-y-3">
          {facts ? (
            <>
              <BriefFact label={t("proposal.brief_site")} value={facts.site || t("table.not_provided")} />
              <BriefFact label={t("proposal.brief_engagement")} value={facts.engagement} />
              <BriefFact label={t("proposal.brief_start")} value={facts.start} />
            </>
          ) : null}
          <BriefFact label={t("compare_proposals.scale_label")} value={comparison.scale ?? t("compare_proposals.scale_none")} muted={!comparison.scale} />
          <div>
            <dt className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted">{t("proposal.brief_need")}</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-body-sm text-prose">{comparison.requirement}</dd>
          </div>
        </dl>
      </div>
      <div className="rounded-card border border-line bg-card p-[var(--card-pad)]">
        <h2 className="text-body font-medium text-ink">{t("compare_proposals.sent_to")}</h2>
        <ul className="mt-2 list-none space-y-1 p-0 text-body-sm text-ink">
          {[...comparison.waiting, ...comparison.declined].map((r) => (
            <li key={r.businessId}>{r.displayName}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function BriefFact({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div>
      <dt className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted">{label}</dt>
      <dd className={muted ? "mt-0.5 text-body-sm text-muted" : "mt-0.5 text-body-sm text-ink"}>{value}</dd>
    </div>
  );
}

/* ── The buyer's figures (Q2) ─────────────────────────────────────────────── */

/**
 * The numbers the platform will not guess.
 *
 * A GET form: the figures live in the address, so the page renders them on the
 * server, a reload keeps them, and nothing is stored — they are the buyer's
 * assumption for this reading, not a term of anybody's proposal.
 */
function FiguresForm({
  comparison,
  figures,
  token,
  interactive,
  idPrefix,
}: {
  comparison: ProposalComparison;
  figures: ComparisonFigures;
  token: string | null;
  /** False in the gallery, which renders several states and no form behind them. */
  interactive: boolean;
  idPrefix: string;
}) {
  const Wrapper = interactive ? "form" : "div";
  const context = { engagementType: comparison.engagementType, cadence: comparison.cadence };
  const wanted = figuresWanted(
    comparison.columns.map((c) => c.proposal),
    context,
  );
  if (!footingRowShown(comparison.columns.map((c) => c.proposal), context) || (!wanted.area && !wanted.visits)) {
    return null;
  }

  return (
    <Wrapper
      id={`${idPrefix}-${FIGURES_ID}`}
      {...(interactive ? { method: "get" } : {})}
      className="mt-6 scroll-mt-24 rounded-card border border-line bg-card p-[var(--card-pad)]"
    >
      {token ? <input type="hidden" name="t" value={token} /> : null}
      <h2 className="text-body font-medium text-ink">{t("compare_proposals.figures_title")}</h2>
      <p className="mt-1 max-w-[var(--measure-prose)] text-body-sm text-muted">{t("compare_proposals.figures_body")}</p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {wanted.area ? (
          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-area`} className="block text-caption font-medium text-body">
              {t("compare_proposals.area_label")}
            </label>
            <input
              id={`${idPrefix}-area`}
              name="area"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={figures.areaSqFt === null ? "" : String(figures.areaSqFt)}
              aria-describedby={`${idPrefix}-area-note`}
              className="h-9 w-full max-w-xs rounded-ctl border border-line-strong bg-card px-3 font-mono text-body-sm text-ink focus:border-moss focus:shadow-focus focus-visible:outline-none"
            />
            {/*
               B6: the words the figure would otherwise have been read from, quoted
               beside the box — and the warning the board's second correction is
               about, stated for every brief rather than detected in one.
            */}
            <p id={`${idPrefix}-area-note`} className="max-w-[var(--measure-prose)] text-caption text-muted">
              {comparison.scale
                ? t("compare_proposals.area_note", { scale: comparison.scale, max: formatCount(AREA_MAX) })
                : t("compare_proposals.area_note_none", { max: formatCount(AREA_MAX) })}
            </p>
          </div>
        ) : null}
        {wanted.visits ? (
          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-visits`} className="block text-caption font-medium text-body">
              {t("compare_proposals.visits_label")}
            </label>
            <input
              id={`${idPrefix}-visits`}
              name="visits"
              inputMode="numeric"
              autoComplete="off"
              defaultValue={figures.visitsPerYear === null ? "" : String(figures.visitsPerYear)}
              aria-describedby={`${idPrefix}-visits-note`}
              className="h-9 w-full max-w-xs rounded-ctl border border-line-strong bg-card px-3 font-mono text-body-sm text-ink focus:border-moss focus:shadow-focus focus-visible:outline-none"
            />
            <p id={`${idPrefix}-visits-note`} className="max-w-[var(--measure-prose)] text-caption text-muted">
              {comparison.cadence
                ? t("compare_proposals.visits_note_cadence", {
                    cadence: t(`footing.cadence.${comparison.cadence}` as "footing.cadence.quarterly"),
                    max: formatCount(VISITS_MAX),
                  })
                : t("compare_proposals.visits_note", { max: formatCount(VISITS_MAX) })}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" size="sm">
          {t("compare_proposals.figures_submit")}
        </Button>
        {figures.areaSqFt !== null || figures.visitsPerYear !== null ? (
          <Link
            href={`/enquiry/${comparison.enquiryId}/compare${token ? `?t=${token}` : ""}`}
            className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("compare_proposals.figures_clear")}
          </Link>
        ) : null}
      </div>
    </Wrapper>
  );
}

/* ── The table ────────────────────────────────────────────────────────────── */

/** Where a cell that needs the buyer's figure sends them. */
const FIGURES_ID = "your-figures";

const ROW_TH = "px-5 py-4 text-left align-top font-normal";
const CELL = "px-4 py-4 align-top";
const LABEL = "block font-mono text-eyebrow uppercase tracking-eyebrow text-muted";

function ComparisonTable({
  comparison,
  now,
  token,
  figures,
  acceptAction,
  mayAccept,
  idPrefix,
}: {
  comparison: ProposalComparison;
  now: Date;
  token: string | null;
  figures: ComparisonFigures;
  acceptAction: ((formData: FormData) => Promise<void>) | undefined;
  mayAccept: boolean;
  idPrefix: string;
}) {
  const { columns } = comparison;
  const context = {
    engagementType: comparison.engagementType,
    cadence: comparison.cadence,
    areaSqFt: figures.areaSqFt,
    visitsPerYear: figures.visitsPerYear,
  };
  const showFooting = footingRowShown(columns.map((c) => c.proposal), context);
  const footings = columns.map((c) => twelveMonthFooting(c.proposal, context));
  const carry = token ? `?t=${token}` : "";
  // Equal columns — the export's layout fix: a longer caption must not make one
  // supplier read as more important than another.
  const minWidth = `${16 + columns.length * 15}rem`;

  return (
    <div
      tabIndex={0}
      role="group"
      aria-label={t("compare_proposals.caption")}
      className="mt-6 overflow-x-auto rounded-card border border-line bg-card focus-visible:shadow-focus focus-visible:outline-none"
    >
      <table className="w-full table-fixed border-collapse text-left" style={{ minWidth }}>
        <caption className="sr-only">{t("compare_proposals.caption")}</caption>
        <colgroup>
          <col className="w-[16rem]" />
          {columns.map((c) => (
            <col key={c.businessId} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-line bg-paper-sunk">
            <th scope="col" className="px-5 py-3">
              <span className="sr-only">{t("compare_proposals.term_col")}</span>
            </th>
            {columns.map((c) => (
              <th key={c.businessId} scope="col" className="px-4 py-3 align-top font-normal">
                <Link
                  href={`/b/${c.slug}`}
                  className="rounded-tag text-body font-medium text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {c.displayName}
                </Link>
                <span className="mt-0.5 block text-caption text-muted">
                  {t("compare_proposals.from_service", { service: c.proposal.serviceName })}
                </span>
                <StateChip column={c} />
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          <tr className="border-b border-line">
            <th scope="row" className={ROW_TH}>
              <span className={LABEL}>{t("compare_proposals.row.as_proposed")}</span>
            </th>
            {columns.map((c) => (
              <td key={c.businessId} className={CELL}>
                {/* B1: their figure, in their unit, and nothing done to it. */}
                <span className="block font-mono text-h3 tabular-nums text-ink">{feeAmount(c.proposal.feeAed)}</span>
                <span className="mt-0.5 block text-body-sm text-muted">{c.proposal.feeBasisLabel}</span>
              </td>
            ))}
          </tr>

          {showFooting ? (
            <tr className="border-b border-line">
              <th scope="row" className={ROW_TH}>
                <span className="block font-mono text-eyebrow uppercase tracking-eyebrow text-warn-ink">
                  {t("compare_proposals.row.twelve_months")}
                </span>
                <span className="mt-1 block text-caption text-warn-ink">{t("compare_proposals.row.twelve_months_note")}</span>
              </th>
              {columns.map((c, i) => (
                <td key={c.businessId} className={CELL}>
                  <FootingCell
                    footing={footings[i]!}
                    basisLabel={c.proposal.feeBasisLabel}
                    askFigure={comparison.acceptedBusinessId === null}
                    figuresHref={`#${idPrefix}-${FIGURES_ID}`}
                  />
                </td>
              ))}
            </tr>
          ) : null}

          <TextRow label={t("compare_proposals.row.term")} columns={columns} value={(c) => (c.proposal.termMonths === null ? null : termWords(c.proposal.termMonths))} />
          {/* Board `7c-s`: what the accepted record will call *payment agreed*, seen before agreeing. */}
          <TextRow
            label={t("compare_proposals.row.payment")}
            columns={columns}
            value={(c) => (c.quote.paymentTerms === null ? null : paymentTermsWords(c.quote.paymentTerms))}
          />
          <TextRow
            label={comparison.turnaroundLabel || t("accepted.proposal.turnaround")}
            columns={columns}
            value={(c) => c.proposal.turnaround}
          />
          <TextRow label={t("compare_proposals.row.scope")} columns={columns} value={(c) => c.proposal.scope || null} prose />
          <TextRow label={t("compare_proposals.row.deliverable")} columns={columns} value={(c) => c.proposal.deliverable} />
          <TextRow
            label={t("compare_proposals.row.excluded")}
            columns={columns}
            value={(c) => c.proposal.exclusions}
            empty={t("compare.proposal.none_stated")}
            prose
          />

          <tr className="border-b border-line">
            <th scope="row" className={ROW_TH}>
              <span className={LABEL}>{t("compare_proposals.row.credentials")}</span>
            </th>
            {columns.map((c) => (
              <td key={c.businessId} className={CELL}>
                <CredentialsCell column={c} />
              </td>
            ))}
          </tr>
        </tbody>

        <tfoot>
          <tr>
            <th scope="row" className={ROW_TH}>
              <span className="sr-only">{t("compare_proposals.row.decision")}</span>
            </th>
            {columns.map((c, i) => (
              <td key={c.businessId} className={`${CELL} pb-5`}>
                <DecisionCell
                  column={c}
                  primary={i === 0}
                  enquiryId={comparison.enquiryId}
                  token={token}
                  carry={carry}
                  now={now}
                  closesAt={comparison.closesAt}
                  acceptAction={acceptAction}
                  mayAccept={mayAccept}
                  viaAcceptPage={comparison.buyerCompanyId !== null}
                />
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function StateChip({ column }: { column: ComparisonColumn }) {
  if (column.state === "open") return null;
  return (
    <span className="mt-2 block">
      <StatusBadge tone={column.state === "accepted" ? "ok" : "neutral"} size="sm" shape="chip">
        {column.state === "accepted"
          ? t("compare_proposals.state.accepted")
          : column.state === "declined"
            ? t("compare_proposals.state.declined")
            : t("compare_proposals.state.expired")}
      </StatusBadge>
    </span>
  );
}

function FootingCell({
  footing,
  basisLabel,
  askFigure,
  figuresHref,
}: {
  footing: Footing;
  basisLabel: string;
  /** Offer the figures form — not once the comparison is a record. */
  askFigure: boolean;
  figuresHref: string;
}) {
  const working = workingWords(footing);
  if (footing.kind === "not_computable") {
    const wants = footing.reason === "needs_area" || footing.reason === "needs_visits";
    return (
      <>
        {/* B5: no number where the platform would have had to invent a quantity. */}
        <span className="block text-body-sm text-muted">{notComputableWords(footing.reason, basisLabel)}</span>
        {wants && askFigure ? (
          <a
            href={figuresHref}
            className="mt-1 block w-fit rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {footing.reason === "needs_area" ? t("compare_proposals.give_area") : t("compare_proposals.give_visits")}
          </a>
        ) : null}
        {working ? <span className="mt-1 block text-caption text-muted">{working}</span> : null}
      </>
    );
  }
  return (
    <>
      <span className="block font-mono text-body tabular-nums text-warn-ink">{feeAmount(footing.totalAed)}</span>
      {/* B2: the operation, in the cell. */}
      <span className="mt-1 block text-caption text-muted">{working}</span>
      {footing.usesBuyerFigure ? (
        <span className="mt-1 block text-caption text-warn-ink">{t("compare_proposals.uses_your_figure")}</span>
      ) : null}
    </>
  );
}

function TextRow({
  label,
  columns,
  value,
  empty,
  prose = false,
}: {
  label: string;
  columns: ComparisonColumn[];
  value: (column: ComparisonColumn) => string | null;
  empty?: string;
  prose?: boolean;
}) {
  return (
    <tr className="border-b border-line">
      <th scope="row" className={ROW_TH}>
        <span className={LABEL}>{label}</span>
      </th>
      {columns.map((c) => {
        const text = value(c);
        return (
          <td
            key={c.businessId}
            className={[CELL, "text-body-sm", text ? "text-ink" : "text-muted", prose ? "whitespace-pre-line" : ""].join(" ")}
          >
            {/* Unfilled stays visible, grey — never a blank a buyer reads as nothing. */}
            {text ?? empty ?? t("proposal.not_stated")}
          </td>
        );
      })}
    </tr>
  );
}

function CredentialsCell({ column }: { column: ComparisonColumn }) {
  return (
    <div className="space-y-1 text-body-sm">
      <p className={column.licenceVerified ? "text-ok-ink" : "text-muted"}>
        {column.licenceVerified ? t("compare_proposals.licence_verified") : t("compare_proposals.licence_unverified")}
      </p>
      {column.credentials.length > 0 ? (
        <ul className="list-none space-y-0.5 p-0">
          {column.credentials.map((credential, index) => (
            <li key={`${credential.kind}-${index}`} className={credential.verified ? "text-ok-ink" : "text-body"}>
              {/* A claim never renders like a check — `8b-s`, and CredentialTable's rule. */}
              {credential.verified
                ? t("compare_proposals.credential_checked", { name: credentialName(credential) })
                : t("compare_proposals.credential_claim", { name: credentialName(credential) })}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted">
        {column.repliedInMs === null
          ? t("compare_proposals.reply_unmeasured")
          : t("compare_proposals.replied_in", { duration: formatDuration(column.repliedInMs) })}
      </p>
    </div>
  );
}

function DecisionCell({
  column,
  primary,
  enquiryId,
  token,
  carry,
  now,
  closesAt,
  acceptAction,
  mayAccept,
  viaAcceptPage = false,
}: {
  column: ComparisonColumn;
  primary: boolean;
  enquiryId: string;
  token: string | null;
  carry: string;
  now: Date;
  closesAt: Date;
  acceptAction: ((formData: FormData) => Promise<void>) | undefined;
  /** Build plan 9.4: false leaves the question and takes the accept away. */
  mayAccept: boolean;
  /** Board `7b`: a company enquiry is accepted on the accept screen, under the company's rule. */
  viaAcceptPage?: boolean;
}) {
  const ask = (
    // B10: a question opens the thread, and neither accepts nor declines.
    <Link
      href={`/enquiry/${enquiryId}/thread/${column.slug}${carry}`}
      aria-label={t("compare_proposals.ask_named", { supplier: column.displayName })}
      className="mt-3 block rounded-tag text-center text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
    >
      {t("compare_proposals.ask")}
    </Link>
  );

  if (column.state === "accepted") {
    return (
      <div className="text-center">
        <Link href={`/enquiry/${enquiryId}/accepted${carry}`} className={buttonClassName({ variant: "primary", block: true })}>
          {t("compare_proposals.open_record")}
        </Link>
        {ask}
      </div>
    );
  }
  if (column.state === "declined") {
    return <p className="text-center text-body-sm text-muted">{t("compare_proposals.declined_after_accept")}</p>;
  }
  if (column.state === "expired") {
    return (
      <div className="text-center">
        {/* Q4: not acceptable, and still visible — it is part of what happened. */}
        <p className="text-body-sm text-muted">
          {column.quote.expiresAt
            ? t("compare_proposals.expired_on", { when: formatDate(column.quote.expiresAt) })
            : t("compare_proposals.state.expired")}
        </p>
        {ask}
      </div>
    );
  }

  /*
     Board `10e` `B3` and `10h`'s states: closed with nothing accepted is
     terminal, and `acceptQuote` refuses it — so the button is not offered to
     meet the refusal after it is pressed.
  */
  if (closesAt.getTime() <= now.getTime()) {
    return (
      <div className="text-center">
        <p className="text-body-sm text-muted">{t("compare_proposals.closed_on", { when: formatDate(closesAt) })}</p>
        {ask}
      </div>
    );
  }

  // Build plan 9.4: the service refuses this person before it reads the quote,
  // so the cell offers what they can still do — ask — and the page says why.
  if (!mayAccept) return <div className="text-center">{ask}</div>;

  const Wrapper = acceptAction ? "form" : "div";
  const label = primary ? t("compare_proposals.accept_primary") : t("compare_proposals.accept");
  const named = t("compare_proposals.accept_named", {
    supplier: column.displayName,
    revision: column.quote.revision,
  });
  if (viaAcceptPage && acceptAction) {
    return (
      <div>
        <Link
          href={`/enquiry/${enquiryId}/accept/${column.quote.id}`}
          aria-label={named}
          className={buttonClassName({ variant: primary ? "primary" : "secondary", block: true })}
        >
          {label}
        </Link>
        {column.quote.expiresAt && column.quote.expiresAt.getTime() > now.getTime() ? (
          <p className="mt-2 text-center text-caption text-muted">
            {t("compare_proposals.valid_until", { when: formatDate(column.quote.expiresAt) })}
          </p>
        ) : null}
        {ask}
      </div>
    );
  }
  return (
    <div>
      <Wrapper {...(acceptAction ? { action: acceptAction } : {})}>
        <input type="hidden" name="quoteId" value={column.quote.id} />
        <input type="hidden" name="enquiryId" value={enquiryId} />
        {token ? <input type="hidden" name="token" value={token} /> : null}
        <Button
          type="submit"
          block
          variant={primary ? "primary" : "secondary"}
          aria-label={t("compare_proposals.accept_named", {
            supplier: column.displayName,
            revision: column.quote.revision,
          })}
        >
          {primary ? t("compare_proposals.accept_primary") : t("compare_proposals.accept")}
        </Button>
      </Wrapper>
      {column.quote.expiresAt && column.quote.expiresAt.getTime() > now.getTime() ? (
        <p className="mt-2 text-center text-caption text-muted">
          {t("compare_proposals.valid_until", { when: formatDate(column.quote.expiresAt) })}
        </p>
      ) : null}
      {ask}
    </div>
  );
}

/* ── The footnote ─────────────────────────────────────────────────────────── */

/**
 * What the page admits about itself.
 *
 * Built from what is actually on the table rather than written once: the
 * twelve-month sentence only when that row is there, the visits sentence only
 * when a column was counted in visits, the figures sentence only when a column
 * used one of the buyer's. The last sentence is always there.
 */
function Footnote({ comparison, figures }: { comparison: ProposalComparison; figures: ComparisonFigures }) {
  const context = {
    engagementType: comparison.engagementType,
    cadence: comparison.cadence,
    areaSqFt: figures.areaSqFt,
    visitsPerYear: figures.visitsPerYear,
  };
  const proposals = comparison.columns.map((c) => c.proposal);
  const footings = proposals.map((p) => twelveMonthFooting(p, context));
  const shown = footingRowShown(proposals, context);
  const sentences = [
    shown ? t("compare_proposals.note.ours") : null,
    shown ? t("compare_proposals.note.term") : null,
    shown && footings.some((f) => f.working.some((s) => s.op === "visits"))
      ? t("compare_proposals.note.visits")
      : null,
    shown && footings.some((f) => f.kind === "figure" && f.usesBuyerFigure) ? t("compare_proposals.note.figures") : null,
    !shown && comparison.engagementType !== null && comparison.engagementType !== "ongoing_contract"
      ? t("compare_proposals.note.no_year")
      : null,
    !shown && proposals.length > 1 && new Set(proposals.map((p) => p.feeBasis)).size === 1
      ? t("compare_proposals.note.same_basis")
      : null,
    t("compare_proposals.note.read_excluded"),
  ].filter((s): s is string => s !== null);

  return (
    <div className="mt-6 rounded-card border border-warn-line bg-warn-wash px-[var(--card-pad)] py-4">
      <p className="text-body-sm text-warn-ink">{sentences.join(" ")}</p>
    </div>
  );
}
