import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { Card } from "@/components/structure";
import { cn } from "@/lib/cn";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ClosureBlockers } from "@/lib/closure/blockers";
import type { ConsequenceKind, ConsequenceRow } from "@/lib/closure/consequences";
import { COOLING_OFF_DAYS } from "@/lib/closure/policy";

/**
 * Board `11i`'s panels, presentational and data-free.
 *
 * Separate from the page so `/dev/gallery` can render every state the screen
 * has from synthetic facts — blocked by one thing, by two, clear, and on Free —
 * without a database. The page supplies the facts; nothing in here queries.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The two paths
// ─────────────────────────────────────────────────────────────────────────────

export type PlanPath =
  | { kind: "paid"; planName: string }
  | { kind: "cancelling"; planName: string; endsOn: Date }
  | { kind: "free" };

/**
 * Cancelling is not closing, and the two sit side by side at the top.
 *
 * A seller who came here meaning to stop paying can take the cheaper option
 * without reading further — which is the outcome the business wants and, much
 * more often than not, the one the seller wants too.
 */
export function ClosurePaths({ plan }: { plan: PlanPath }) {
  return (
    <div className="grid gap-3.5 md:grid-cols-2">
      <Card surface="card" padded>
        <h2 className="text-body font-medium text-ink">{t("closure.path.cancel_title")}</h2>
        <p className="mt-2 max-w-prose text-caption leading-relaxed text-body-ink">
          {plan.kind === "paid" && t("closure.path.cancel_body")}
          {plan.kind === "cancelling" &&
            t("closure.path.cancel_scheduled", { plan: plan.planName, date: formatDate(plan.endsOn) })}
          {plan.kind === "free" && t("closure.path.cancel_free")}
        </p>
        {plan.kind === "paid" && (
          <Link
            href="/dashboard/billing/cancel"
            className={cn(buttonClassName({ variant: "secondary", size: "sm" }), "mt-3.5")}
          >
            {t("closure.path.cancel_cta")}
          </Link>
        )}
      </Card>

      {/*
         Marked as the current place rather than as a button. The page is already
         the close path; a second control that "closes the account" here would be
         a live red action above the blockers the seller has not read yet.
      */}
      <div className="rounded-card border-[1.5px] border-bad-line-strong bg-bad-surface p-4">
        <h2 className="text-body font-medium text-bad-ink">{t("closure.path.close_title")}</h2>
        <p className="mt-2 max-w-prose text-caption leading-relaxed text-bad-ink">
          {t("closure.path.close_body")}
        </p>
        <p className="mt-3.5 font-mono text-eyebrow uppercase tracking-[0.11em] text-bad-ink">
          {t("closure.path.you_are_here")}
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The blockers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Two things that must clear first, each with its route out.
 *
 * > *A buyer waiting on your quote must not find you gone.*
 *
 * The heading counts what is actually there — one thing or two — rather than
 * reading "Two things" over a single row, which is the header-that-disagrees-
 * with-the-rows defect CLAUDE.md names.
 */
export function ClosureBlockersPanel({ blockers }: { blockers: ClosureBlockers }) {
  if (blockers.clear) return null;
  const count = (blockers.subscription ? 1 : 0) + (blockers.enquiries ? 1 : 0);

  return (
    /*
       A `div` with a heading, not a named `section`. A named section is a
       landmark, and the gallery renders this panel in four states — four
       landmarks with one name is the `landmark-unique` failure
       tests/e2e/landmarks.spec.ts already caught once on board 11h's table.
    */
    <div className="overflow-hidden rounded-card border border-warn-line bg-warn-surface">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-warn-line px-4 py-3.5">
        <h2 className="text-body font-medium text-warn-ink">
          {t("closure.blockers.title", { count })}
        </h2>
        <p className="text-caption text-warn-ink">{t("closure.blockers.why")}</p>
      </div>

      <ul>
        {blockers.subscription && (
          <BlockerRow
            title={
              blockers.subscription.pastDue
                ? t("closure.blockers.subscription_past_due", { plan: blockers.subscription.planName })
                : t("closure.blockers.subscription", {
                    plan: blockers.subscription.planName,
                    date: formatDate(blockers.subscription.renewsAt),
                  })
            }
            body={t("closure.blockers.subscription_body")}
            href="/dashboard/billing/cancel"
            action={t("closure.blockers.subscription_cta")}
          />
        )}
        {blockers.enquiries && (
          <BlockerRow
            title={enquiryTitle(blockers.enquiries.openEnquiries, blockers.enquiries.awaitingQuotes)}
            body={enquiryBody(blockers.enquiries)}
            href="/dashboard/leads"
            action={t("closure.blockers.enquiries_cta")}
          />
        )}
      </ul>
    </div>
  );
}

function enquiryTitle(open: number, awaiting: number): string {
  const enquiries = t("closure.blockers.open_enquiries", { count: open, formatted: formatCount(open) });
  const quotes = t("closure.blockers.awaiting_quotes", { count: awaiting, formatted: formatCount(awaiting) });
  if (open > 0 && awaiting > 0) return t("closure.blockers.both", { enquiries, quotes });
  return open > 0 ? enquiries : quotes;
}

function enquiryBody(enquiries: NonNullable<ClosureBlockers["enquiries"]>): string {
  const quote = enquiries.firstQuote;
  if (!quote) return t("closure.blockers.enquiries_body");

  /*
     The buyer as board 3k shows them: a first name until a quote is accepted.
     The board wrote the buyer's company here, and a seller cannot see that
     before acceptance — so printing it on this screen would have been the one
     place in the dashboard that unmasked a buyer.
  */
  const buyer = quote.buyer.firstName || t("closure.blockers.a_buyer");
  return quote.expiresAt
    ? t("closure.blockers.quote_body_dated", { ref: quote.ref, buyer, date: formatDate(quote.expiresAt) })
    : t("closure.blockers.quote_body", { ref: quote.ref, buyer });
}

function BlockerRow({
  title,
  body,
  href,
  action,
}: {
  title: string;
  body: string;
  href: string;
  action: string;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-warn-line px-4 py-3.5 last:border-0">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-bad" />
      <div className="min-w-0 flex-1">
        <p className="text-body-sm text-ink">{title}</p>
        <p className="mt-0.5 text-caption leading-relaxed text-body-ink">{body}</p>
      </div>
      <Link href={href} className={buttonClassName({ variant: "secondary", size: "sm" })}>
        {action}
      </Link>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// What happens when you close
// ─────────────────────────────────────────────────────────────────────────────

const WHEN_TONE: Record<ConsequenceKind, string> = {
  leaves: "text-bad-ink",
  retained: "text-ok-ink",
  reserved: "text-ok-ink",
};

/**
 * The consequence table. A real `<table>` — non-negotiable 4.
 *
 * Kept rows are tinted and carry their reason in the cell. The tint is never the
 * only signal: every row's third column says `At closure`, `Retained` or
 * `Reserved` in words.
 */
export function ClosureConsequences({ rows }: { rows: readonly ConsequenceRow[] }) {
  return (
    <Card surface="card" padded={false}>
      <h2 className="px-4 pb-3 pt-4 text-body font-medium text-ink">{t("closure.table.title")}</h2>
      {/*
         `group` with a name and a focus stop, for the same two reasons board
         11h's table gives: a scrollable region with a link in only one row is
         otherwise unreachable by keyboard on a narrow screen, and a named
         `region` would be a landmark the gallery repeats.
      */}
      <div
        tabIndex={0}
        role="group"
        aria-label={t("closure.table.scroll")}
        className="overflow-x-auto focus-visible:shadow-focus focus-visible:outline-none"
      >
        <table className="w-full min-w-[40rem] border-collapse text-left">
          {/* A caption rather than `aria-labelledby` to an id the gallery would repeat. */}
          <caption className="sr-only">{t("closure.table.title")}</caption>
          <thead>
            <tr className="border-y border-line bg-paper-sunk">
              <th scope="col" className="px-4 py-3 font-mono text-eyebrow font-normal uppercase tracking-[0.09em] text-muted">
                {t("closure.table.col.area")}
              </th>
              <th scope="col" className="px-3 py-3 font-mono text-eyebrow font-normal uppercase tracking-[0.09em] text-muted">
                {t("closure.table.col.what")}
              </th>
              <th scope="col" className="px-4 py-3 font-mono text-eyebrow font-normal uppercase tracking-[0.09em] text-muted">
                {t("closure.table.col.when")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={cn(
                  "border-b border-line-soft last:border-0",
                  row.kind !== "leaves" && "bg-ok-surface",
                )}
              >
                <th scope="row" className="px-4 py-3 align-top text-body-sm font-normal text-ink">
                  {row.area}
                </th>
                <td className="px-3 py-3 align-top text-body-sm text-body-ink">
                  {row.lead && <span className="font-medium text-ink">{row.lead} </span>}
                  {row.body}
                  {row.link && (
                    <>
                      {" "}
                      <Link
                        href={row.link.href}
                        className="rounded-tag font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                      >
                        {row.link.label}
                      </Link>
                    </>
                  )}
                </td>
                <td className={cn("whitespace-nowrap px-4 py-3 align-top text-body-sm", WHEN_TONE[row.kind])}>
                  {row.when}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The rail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Three cards. The first is the window, the second is the board's argument, and
 * the third is build note `B8` — the platform's own closure, said before it can
 * happen.
 *
 * `previewFinalAt` is today plus the window, rendered as a date rather than as
 * "in fourteen days": the email promises a date, and this is the same date the
 * seller would get if they closed now.
 */
export function ClosureRail({
  previewFinalAt,
  notOurs,
  kept,
}: {
  previewFinalAt: Date;
  notOurs: number;
  kept: number;
}) {
  return (
    <>
      <Card surface="card" padded>
        <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
          {t("closure.rail.window_eyebrow", { days: formatCount(COOLING_OFF_DAYS) })}
        </p>
        <p className="mt-2.5 text-body-sm leading-relaxed text-body-ink">
          {t("closure.rail.window_body", { date: formatDate(previewFinalAt) })}
        </p>
        <p className="mt-3 border-t border-line pt-3 text-caption leading-relaxed text-muted">
          {t("closure.rail.window_after")}
        </p>
      </Card>

      <Card surface="paper" padded>
        <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
          {t("closure.rail.keep_eyebrow")}
        </p>
        <p className="mt-2.5 text-body-sm leading-relaxed text-body-ink">
          {t("closure.rail.keep_body", { not_ours: formatCount(notOurs), kept: formatCount(kept) })}
        </p>
        <p className="mt-2.5 text-body-sm leading-relaxed text-body-ink">{t("closure.rail.keep_close")}</p>
      </Card>

      <Card surface="card" padded>
        <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
          {t("closure.rail.lapsed_eyebrow")}
        </p>
        <p className="mt-2.5 text-body-sm leading-relaxed text-body-ink">{t("closure.rail.lapsed_body")}</p>
      </Card>
    </>
  );
}

/**
 * The two controls at the foot of the rail.
 *
 * **The primary action is disabled while anything stands, and that is the
 * point.** A close-account screen that leads with a live red button has not
 * thought about the buyer at the other end of the open quote. The reason is a
 * sentence under the button, never only the grey of it.
 */
export function ClosureActions({ blockers }: { blockers: ClosureBlockers }) {
  const count = (blockers.subscription ? 1 : 0) + (blockers.enquiries ? 1 : 0);
  return (
    <div className="mt-auto flex flex-col gap-2.5 pt-2">
      {blockers.clear ? (
        <Link href="/dashboard/account/close/confirm" className={buttonClassName({ variant: "danger", block: true })}>
          {t("closure.actions.request")}
        </Link>
      ) : (
        <>
          {/*
             The reason is inside the button's own description rather than an
             `aria-describedby` to an id, which the gallery would repeat. A
             disabled control that does not say why is the shape errors are
             supposed to prevent.
          */}
          <button type="button" disabled className={buttonClassName({ variant: "danger", block: true })}>
            {t("closure.actions.request")}
            <span className="sr-only"> — {t("closure.blockers.title", { count })}</span>
          </button>
          <p aria-hidden="true" className="text-center text-caption text-warn-ink">
            {t("closure.blockers.title", { count })}
          </p>
        </>
      )}
      <Link href="/dashboard" className={buttonClassName({ variant: "secondary", block: true })}>
        {t("closure.actions.keep")}
      </Link>
    </div>
  );
}
