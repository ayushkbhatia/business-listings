import Link from "next/link";
import { StatusBadge } from "@/components/display/StatusBadge";
import { buttonClassName } from "@/components/primitives";
import { t } from "@/lib/i18n";

/**
 * Board `3j-s` — the lead for work, as drawn: a header strip, the brief on the
 * left, the proposal on the right.
 *
 * Presentational and free of data access, so `/dev/gallery` renders every state
 * from a plain object — typical, draft saved, question asked, declined, window
 * elapsed, no basis, accepted elsewhere, no scale — and the page renders the
 * same component from the database. Controls arrive as elements: a function
 * cannot cross into a client component, and the composer, the decline dialog
 * and the lead actions are client components.
 *
 * ## No rail
 *
 * The goods lead keeps the inbox rail beside it. This one does not, because the
 * render does not and because the screen is two columns that need the width: a
 * seller writing a fee reads the brief beside it, not above it. The way back to
 * the list is the first thing in the strip.
 *
 * ## No landmarks
 *
 * Headings and plain containers only. A named section is a landmark, and the
 * gallery renders this view more than once on one page.
 */

export interface BriefRow {
  key: string;
  label: string;
  value: string;
  /** An unanswered row: grey, still visible. */
  missing?: boolean;
}

export interface SentProposalRow {
  id: string;
  ref: string;
  sentLabel: string;
  fee: string;
  term: string;
  mobilisation: string;
  /** Board `7c-s`: the payment terms as sent, or *Not stated*. */
  payment: string;
  validUntil: string;
  status: string;
}

export interface ProposalLeadModel {
  ref: string;
  title: string;
  /** Null once answered: the chip counts down to a first reply and stops there. */
  replyChip: { tone: "neutral" | "warn" | "bad"; label: string } | null;
  /** `Also sent to 5 others`, or null for a single-supplier enquiry. */
  othersLabel: string | null;
  backHref: string;
  brief: {
    rows: BriefRow[];
    /** The buyer's words, verbatim. */
    requirement: string;
    attachments: { id: string; filename: string; href: string; size: string | null }[];
  };
  buyer: {
    name: string;
    /** Lines shown once contact is released; empty before. */
    released: string[];
  };
  /** What the right column is. */
  state:
    | { kind: "compose" }
    | { kind: "no_service"; trade: string; href: string }
    | { kind: "read_only"; tone: "ok" | "neutral"; title: string; body: string };
  sent: SentProposalRow[];
}

export function ProposalLeadView({
  model,
  composer,
  decline,
  askHref,
  askLabel,
  leadActions,
}: {
  model: ProposalLeadModel;
  /** The composer, when `state.kind` is `compose`. */
  composer?: React.ReactNode;
  /** The decline control, when the lead may still be declined. */
  decline?: React.ReactNode;
  /** The thread. Always offered: a question is never the wrong thing to be able to ask. */
  askHref: string;
  askLabel: string;
  /** Assign and mark, where the seat may. */
  leadActions?: React.ReactNode;
}) {
  return (
    <div className="@container space-y-[var(--gutter)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={model.backHref}
            className="rounded-tag text-caption text-moss underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("proposal.back")}
          </Link>
          <span className="font-mono text-eyebrow uppercase text-muted">{model.ref}</span>
          <h2 className="min-w-0 text-h3 text-ink">{model.title}</h2>
          {model.replyChip ? (
            <StatusBadge tone={model.replyChip.tone} size="sm" shape="chip">
              {model.replyChip.label}
            </StatusBadge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {model.othersLabel ? (
            <span className="font-mono text-eyebrow uppercase text-muted">{model.othersLabel}</span>
          ) : null}
          {/*
             B4: *Ask a question first* precedes *Decline*. A supplier who cannot
             price without one more fact should ask, not guess and not walk.
          */}
          <Link href={askHref} className={buttonClassName({ variant: "secondary" })}>
            {askLabel}
          </Link>
          {decline}
        </div>
      </div>

      <div className="grid gap-[var(--gutter)] @4xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="space-y-[var(--gutter)]">
          <BriefCard brief={model.brief} />
          <BuyerCard buyer={model.buyer} />
          {leadActions ? (
            <div className="rounded-card border border-line bg-card p-4">
              <h3 className="text-body-sm text-ink">{t("proposal.lead_title")}</h3>
              <div className="mt-2">{leadActions}</div>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 space-y-[var(--gutter)]">
          {model.state.kind === "compose" ? composer : null}

          {model.state.kind === "no_service" ? (
            <div className="rounded-card border border-warn-line bg-warn-surface p-5">
              <h3 className="text-h3 text-warn-ink">{t("proposal.no_service_title")}</h3>
              <p className="mt-1 max-w-[var(--measure-prose)] text-body-sm text-warn-ink">
                {t("proposal.no_service_body", { trade: model.state.trade })}
              </p>
              <Link href={model.state.href} className={`mt-3 ${buttonClassName({ variant: "secondary" })}`}>
                {t("proposal.no_service_action")}
              </Link>
            </div>
          ) : null}

          {model.state.kind === "read_only" ? (
            <div
              className={
                model.state.tone === "ok"
                  ? "rounded-card border border-ok-line bg-ok-surface p-5"
                  : "rounded-card border border-line bg-card p-5"
              }
            >
              <h3 className={model.state.tone === "ok" ? "text-h3 text-ok-ink" : "text-h3 text-ink"}>
                {model.state.title}
              </h3>
              <p
                className={
                  model.state.tone === "ok"
                    ? "mt-1 max-w-[var(--measure-prose)] text-body-sm text-ok-ink"
                    : "mt-1 max-w-[var(--measure-prose)] text-body-sm text-muted"
                }
              >
                {model.state.body}
              </p>
            </div>
          ) : null}

          {model.sent.length > 0 ? <SentProposals rows={model.sent} /> : null}
        </div>
      </div>
    </div>
  );
}

function BriefCard({ brief }: { brief: ProposalLeadModel["brief"] }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card">
      <h3 className="border-b border-line px-5 py-3 text-h3 text-ink">{t("proposal.brief_title")}</h3>
      {/* The render's order: where, then what, then the shape of it. */}
      <dl className="space-y-3 px-5 py-4">
        {brief.rows.slice(0, 1).map((row) => (
          <BriefFact key={row.key} row={row} />
        ))}
        <div>
          <dt className="font-mono text-eyebrow uppercase text-muted">{t("proposal.brief_need")}</dt>
          {/* B2 of `1h-s`: the description as the buyer wrote it, never summarised. */}
          <dd className="mt-0.5 whitespace-pre-wrap text-body-sm text-prose">{brief.requirement}</dd>
        </div>
        {brief.rows.slice(1).map((row) => (
          <BriefFact key={row.key} row={row} />
        ))}
        {brief.attachments.length > 0 ? (
          <div>
            <dt className="font-mono text-eyebrow uppercase text-muted">{t("proposal.brief_attached")}</dt>
            <dd className="mt-1">
              <ul className="flex list-none flex-wrap gap-2 p-0">
                {brief.attachments.map((file) => (
                  <li key={file.id}>
                    <a
                      href={file.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-baseline gap-1.5 rounded-tag border border-line-strong bg-paper-sunk px-2.5 py-1 text-body-sm text-ink hover:border-moss focus-visible:shadow-focus focus-visible:outline-none"
                    >
                      {file.filename}
                      {file.size ? <span className="text-caption text-muted">{file.size}</span> : null}
                    </a>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="border-t border-line bg-paper-sunk px-5 py-3 text-caption text-muted">
        {t("proposal.brief_rule")}
      </p>
    </div>
  );
}

function BriefFact({ row }: { row: BriefRow }) {
  return (
    <div>
      <dt className="font-mono text-eyebrow uppercase text-muted">{row.label}</dt>
      <dd className={row.missing ? "mt-0.5 text-body-sm text-muted" : "mt-0.5 text-body-sm text-ink"}>{row.value}</dd>
    </div>
  );
}

function BuyerCard({ buyer }: { buyer: ProposalLeadModel["buyer"] }) {
  return (
    <div className="rounded-card border border-line bg-card p-5">
      <p className="text-body text-ink">{buyer.name}</p>
      {buyer.released.length > 0 ? (
        <ul className="mt-1 list-none space-y-0.5 p-0 text-body-sm text-ink">
          {buyer.released.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <>
          {/*
             Rule 1, at the query layer: a first name until acceptance. The
             render printed the buyer's full name, company and job title here;
             `seller-visibility.ts` never selects them, and `1h-s` already
             corrected the same card on the buyer's side.
          */}
          <p className="mt-1 text-body-sm text-muted">{t("proposal.buyer_masked")}</p>
          <p className="mt-3 border-t border-line pt-3 text-caption text-muted">{t("proposal.buyer_phone_hidden")}</p>
        </>
      )}
    </div>
  );
}

function SentProposals({ rows }: { rows: SentProposalRow[] }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card">
      <h3 className="px-5 pt-4 text-h3 text-ink">{t("proposal.sent_title")}</h3>
      <div className="mt-2 overflow-x-auto" tabIndex={0} role="group" aria-label={t("proposal.sent_title")}>
        <table className="w-full min-w-[46rem] border-collapse text-left">
          <caption className="sr-only">{t("proposal.sent_caption")}</caption>
          <thead>
            <tr className="border-y border-line bg-paper-sunk">
              <th scope="col" className="px-5 py-2 font-mono text-eyebrow font-normal uppercase text-muted">
                {t("proposal.col.ref")}
              </th>
              <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase text-muted">
                {t("proposal.col.fee")}
              </th>
              <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase text-muted">
                {t("proposal.col.term")}
              </th>
              <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase text-muted">
                {t("proposal.col.mobilisation")}
              </th>
              <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase text-muted">
                {t("proposal.col.payment")}
              </th>
              <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase text-muted">
                {t("proposal.col.valid_until")}
              </th>
              <th scope="col" className="px-5 py-2 font-mono text-eyebrow font-normal uppercase text-muted">
                {t("proposal.col.status")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-line last:border-b-0">
                <th scope="row" className="px-5 py-2.5 text-left font-normal">
                  <span className="block font-mono text-body-sm text-ink">{row.ref}</span>
                  <span className="block text-caption text-muted">{row.sentLabel}</span>
                </th>
                <td className="px-3 py-2.5 font-mono text-body-sm tabular-nums text-ink">{row.fee}</td>
                <td className="px-3 py-2.5 text-body-sm text-ink">{row.term}</td>
                <td className="px-3 py-2.5 text-body-sm text-ink">{row.mobilisation}</td>
                <td className="px-3 py-2.5 text-body-sm text-ink">{row.payment}</td>
                <td className="px-3 py-2.5 text-body-sm text-ink">{row.validUntil}</td>
                <td className="px-5 py-2.5 text-body-sm text-ink">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
