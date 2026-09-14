import Link from "next/link";
import { StatusBadge } from "@/components/display/StatusBadge";
import { Button, buttonClassName } from "@/components/primitives";
import { Card } from "@/components/structure";
import { cn } from "@/lib/cn";
import type {
  EnquiryHistory,
  InboxBucket,
  InboxRow,
  InboxVerb,
  NeedsYou,
  Tone,
} from "@/lib/enquiry/inbox-status";
import { requirementHeadline } from "@/lib/enquiry/inbox-status";
import type { SavedSearchView } from "@/lib/saved-search/service";
import { formatCloses, formatCount, formatDate, formatDuration, isWithinRelativeWindow } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { SavedSearchRow } from "../_components/SavedSearchRow";
import { nudgeSellersAction } from "./actions";

/**
 * Board 10e — the inbox's pieces, apart from the page so the gallery renders
 * the same markup the buyer sees in every state (`/dev/gallery#buyer-inbox`).
 *
 * No landmarks in here. The page owns its `nav` and `aside`; a component that
 * brought its own would be rendered twice by the gallery, and axe fails a page
 * with two regions of one name.
 */

export const CHIP_LABEL: Record<InboxBucket | "all", MessageKey> = {
  all: "account.chip.all",
  awaiting: "account.chip.awaiting",
  quotes_in: "account.chip.quotes_in",
  accepted: "account.chip.accepted",
  expired: "account.chip.expired",
};
export const CHIP_ORDER: readonly (InboxBucket | "all")[] = ["all", "awaiting", "quotes_in", "accepted", "expired"];

/** `in 3 days` inside the week, `on 28 Sep 2026` past it — the coarse unit, never `5 d 22 h`. */
function closesWhen(closesAt: Date, now: Date): string {
  return isWithinRelativeWindow(closesAt, { now })
    ? t("account.closes.in", { duration: formatCloses(closesAt, { now }) })
    : t("account.closes.on", { date: formatDate(closesAt) });
}

/** `B4`: at most two cards, by what doing nothing costs. Nothing when nothing does — no *all clear* panel. */
export function NeedsYouCard({ cards, now }: { cards: readonly NeedsYou<InboxRow>[]; now: Date }) {
  if (cards.length === 0) return null;
  return (
    <Card padded>
      <h2 className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted">{t("account.needs_you")}</h2>
      <ul className="mt-3 divide-y divide-line">
        {cards.map((card) => (
          <li key={`${card.kind}-${card.row.id}`} className="py-3 first:pt-0 last:pb-0">
            {card.kind === "compare" ? (
              <>
                <p className="text-body text-ink">
                  {t("account.needs.compare", {
                    count: card.quoted,
                    ref: card.row.ref,
                    when: closesWhen(card.row.closesAt, now),
                  })}
                </p>
                <Link
                  href={card.quoted >= 2 ? `/enquiry/${card.row.ref}/compare` : `/enquiry/${card.row.ref}`}
                  className={cn("mt-2 inline-flex", buttonClassName({ size: "sm" }))}
                >
                  {card.quoted >= 2 ? t("account.needs.compare_action") : t("account.needs.read_action")}
                </Link>
              </>
            ) : (
              <>
                <p className="text-body text-ink">
                  {t("account.needs.nudge", {
                    ref: card.row.ref,
                    when: closesWhen(card.row.closesAt, now),
                  })}
                </p>
                <form
                  action={nudgeSellersAction}
                  aria-label={t("account.needs.nudge_label", { ref: card.row.ref })}
                  className="mt-2"
                >
                  <input type="hidden" name="ref" value={card.row.ref} />
                  <Button type="submit" size="sm" variant="secondary">
                    {t("account.needs.nudge_action", {
                      count: card.sellers,
                    })}
                  </Button>
                </form>
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** `B8`–`B10`: the buyer's own numbers, read for the buyer alone. Absent until something has been sent. */
export function HistoryCard({ history, since }: { history: EnquiryHistory; since: Date }) {
  if (history.sent === 0) return null;
  return (
    <Card padded>
      <h2 className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted">{t("account.history")}</h2>
      <dl className="mt-3 space-y-2 text-body-sm">
        <HistoryRow label={t("account.history.sent")} value={formatCount(history.sent)} />
        <HistoryRow
          label={t("account.history.median")}
          value={
            history.medianFirstQuoteMs === null
              ? t("account.history.median_none")
              : formatDuration(history.medianFirstQuoteMs)
          }
        />
        <HistoryRow label={t("account.history.accepted")} value={formatCount(history.accepted)} />
        <HistoryRow label={t("account.history.repeat")} value={formatCount(history.repeatSuppliers)} />
      </dl>
      <p className="mt-3 text-caption text-body">
        {t("account.history.note", {
          since: formatDate(since),
          count: history.answered,
        })}
      </p>
    </Card>
  );
}

function HistoryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-body">{label}</dt>
      <dd className="font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  bad: "text-bad-ink",
  info: "text-body",
  neutral: "text-body",
};

export function EnquiryTable({ rows, now, bucket }: { rows: InboxRow[]; now: Date; bucket: InboxBucket | null }) {
  if (rows.length === 0) {
    // Filtered to zero — the chip says 0 and this says what that means.
    return (
      <Card padded>
        <p className="text-body-sm text-body">{t("account.filtered_empty")}</p>
        <p className="mt-2">
          <Link
            href="/account/enquiries"
            className="rounded-tag text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("account.filtered_clear")}
          </Link>
        </p>
      </Card>
    );
  }

  return (
    <>
      {/*
         Below `md` the same rows as a list. Five columns in a phone's width put
         the verb — the thing to do — a sideways scroll away, and a scroll that
         hides the action is the one this screen cannot afford. `hidden` removes
         whichever copy is not shown from the accessibility tree as well.
      */}
      <ul
        aria-label={t("account.enquiries.caption")}
        className="divide-y divide-line overflow-hidden rounded-card border border-line bg-card md:hidden"
      >
        {rows.map((row) => {
          const expired = row.bucket === "expired";
          const attention = row.verb.kind === "compare";
          // Muted on the wash is 4.1:1, under the floor; the highlighted row steps its quiet text up.
          const quiet = attention ? "text-body" : "text-muted";
          return (
            <li key={row.id} className={cn("px-4 py-3.5", attention && "bg-moss-wash/40")}>
              <Link
                href={`/enquiry/${row.ref}`}
                className={cn(
                  "line-clamp-2 rounded-tag text-body underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none",
                  expired ? "text-muted" : "text-ink",
                )}
              >
                {headline(row.requirement)}
              </Link>
              <p className={cn("mt-0.5 font-mono text-eyebrow uppercase tracking-eyebrow", quiet)}>{subline(row)}</p>
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <dl className="flex flex-wrap gap-x-4 gap-y-1 text-body-sm">
                  <div className="flex gap-1.5">
                    <dt className={quiet}>{t("account.col.sent_to")}</dt>
                    <dd className={cn("tabular-nums", expired ? "text-muted" : "text-ink")}>
                      {formatCount(row.sentTo)}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className={quiet}>{t("account.col.quoted")}</dt>
                    <dd className={cn("tabular-nums", !expired && row.quoted > 0 ? "text-ok-ink" : "text-muted")}>
                      {formatCount(row.quoted)}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className={quiet}>{t("account.col.closes")}</dt>
                    <dd className={row.closes.kind === "open" ? TONE_TEXT[row.closes.tone] : "text-muted"}>
                      {closesText(row, now)}
                    </dd>
                  </div>
                </dl>
                <VerbLink row={row} />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-hidden rounded-card border border-line bg-card md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] border-collapse text-left">
            <caption className="sr-only">
              {bucket
                ? t("account.caption_filtered", {
                    chip: t(CHIP_LABEL[bucket], { n: "" }).trim(),
                  })
                : t("account.enquiries.caption")}
            </caption>
            <thead>
              <tr className="bg-paper-sunk">
                <th
                  scope="col"
                  className="px-5 py-2.5 font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted"
                >
                  {t("account.col.requirement")}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-right font-mono text-eyebrow font-normal uppercase tracking-eyebrow whitespace-nowrap text-muted"
                >
                  {t("account.col.sent_to")}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-right font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted"
                >
                  {t("account.col.quoted")}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted"
                >
                  {t("account.col.closes")}
                </th>
                <th
                  scope="col"
                  className="px-5 py-2.5 font-mono text-eyebrow font-normal uppercase tracking-eyebrow text-muted"
                >
                  {t("account.col.status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const expired = row.bucket === "expired";
                const attention = row.verb.kind === "compare";
                const quiet = attention ? "text-body" : "text-muted";
                return (
                  <tr key={row.id} className={cn("border-t border-line align-middle", attention && "bg-moss-wash/40")}>
                    <th scope="row" className="px-5 py-3.5 text-left font-normal">
                      <Link
                        href={`/enquiry/${row.ref}`}
                        className={cn(
                          "line-clamp-1 rounded-tag text-body underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none",
                          expired ? "text-muted" : "text-ink",
                        )}
                      >
                        {headline(row.requirement)}
                      </Link>
                      <span className={cn("mt-0.5 block font-mono text-eyebrow uppercase tracking-eyebrow", quiet)}>
                        {subline(row)}
                      </span>
                    </th>
                    <td className={cn("px-3 py-3.5 text-right tabular-nums", expired ? "text-muted" : "text-ink")}>
                      {formatCount(row.sentTo)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3.5 text-right tabular-nums",
                        expired ? "text-muted" : row.quoted > 0 ? "text-ok-ink" : "text-muted",
                      )}
                    >
                      {formatCount(row.quoted)}
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-3.5 text-body-sm",
                        row.closes.kind === "open" ? TONE_TEXT[row.closes.tone] : "text-muted",
                      )}
                    >
                      {closesText(row, now)}
                    </td>
                    <td className="px-5 py-3.5">
                      <VerbLink row={row} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function closesText(row: InboxRow, now: Date): string {
  if (row.closes.kind === "closed") return t("account.closes.closed");
  if (row.closes.kind === "expired") return t("account.closes.expired");
  return closesWhen(row.closesAt, now);
}

const headline = requirementHeadline;

function subline(row: InboxRow): string {
  const parts = [row.ref];
  if (row.bucket === "expired") {
    parts.push(
      row.verb.kind === "resent"
        ? t("account.sub.resent", { ref: row.verb.ref })
        : t(
            row.expiryNote === "not_actioned"
              ? "account.sub.not_actioned"
              : row.expiryNote === "no_quotes"
                ? "account.sub.no_quotes"
                : "account.sub.expired",
          ),
    );
    return parts.join(" · ");
  }
  // A requirement sent with no lines says nothing about lines rather than "0 lines".
  if (row.isBrief) parts.push(t("account.sub.brief"));
  else if (row.lineCount > 0) parts.push(t("account.sub.lines", { count: row.lineCount }));
  if (row.place) parts.push(row.place);
  return parts.join(" · ");
}

function verbLabel(verb: InboxVerb): string {
  switch (verb.kind) {
    case "accepted":
      return t("account.verb.accepted");
    case "compare":
      return t("account.verb.compare");
    case "view":
      return t("account.verb.view");
    case "partial":
      return t("account.verb.partial", {
        quoted: formatCount(verb.quoted),
        sent: formatCount(verb.sentTo),
      });
    case "nudge":
      return t("account.verb.nudge");
    case "awaiting":
      return t("account.verb.awaiting");
    case "declined":
      return t("account.verb.declined");
    case "resend":
      return t("account.verb.resend");
    case "resent":
      return t("account.verb.resent");
  }
}

/** Where the verb takes you. The action is the status, so the status is a link. */
function verbHref(row: InboxRow): string {
  switch (row.verb.kind) {
    case "accepted":
      return `/enquiry/${row.ref}/accepted`;
    case "compare":
      return `/enquiry/${row.ref}/compare`;
    case "resend":
      return `/rfq/new?resend=${encodeURIComponent(row.ref)}`;
    case "resent":
      return `/enquiry/${row.verb.ref}`;
    case "declined":
      return `/rfq/new?from=${encodeURIComponent(row.ref)}`;
    default:
      return `/enquiry/${row.ref}`;
  }
}

function VerbLink({ row }: { row: InboxRow }) {
  return (
    <Link
      href={verbHref(row)}
      aria-label={t("account.verb_label", {
        verb: verbLabel(row.verb),
        ref: row.ref,
      })}
      className="inline-flex rounded-pill focus-visible:shadow-focus focus-visible:outline-none"
    >
      <StatusBadge tone={row.tone} size="sm">
        {verbLabel(row.verb)}
      </StatusBadge>
    </Link>
  );
}

/**
 * *No enquiries yet* — the composer's front door, not an empty table. A buyer
 * with nothing sent needs board 1h, and the query they type here seeds it the
 * way a zero-result search does.
 */
export function FirstEnquiry() {
  return (
    <Card padded>
      <h2 className="text-h3 text-ink">{t("account.first.title")}</h2>
      <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-body">{t("account.first.body")}</p>
      <form
        action="/rfq/new"
        method="get"
        aria-label={t("account.first.form_label")}
        className="mt-4 flex flex-wrap items-end gap-3"
      >
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="first-need" className="mb-1.5 block text-body-sm text-ink">
            {t("account.first.label")}
          </label>
          <input
            id="first-need"
            name="q"
            required
            maxLength={200}
            className="h-10 w-full rounded-ctl border border-line-strong bg-card px-3 text-body text-ink focus-visible:shadow-focus focus-visible:outline-none"
          />
        </div>
        <Button type="submit">{t("account.first.submit")}</Button>
      </form>
      <p className="mt-4 text-caption text-body">
        <Link
          href="/categories"
          className="rounded-tag font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("account.first.browse")}
        </Link>
      </p>
    </Card>
  );
}

/**
 * The saved-searches summary: three rows and a *View all N* when there are
 * more — the correction board 10e made to its own render, which claimed four in
 * the tab and drew three with no way to the fourth.
 */
export function SavedPanel({ saved, total }: { saved: readonly SavedSearchView[]; total: number }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <h2 className="text-h3 text-ink">
          {t("account.saved.title")}
        </h2>
        <span className="flex items-center gap-4 text-body-sm">
          {total > saved.length ? (
            <Link
              href="/account/saved"
              className="rounded-tag text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("account.saved.view_all", { n: formatCount(total) })}
            </Link>
          ) : null}
          <Link
            href="/search"
            className="rounded-tag text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("account.saved.find")}
          </Link>
        </span>
      </div>
      {saved.length === 0 ? (
        <p className="px-5 py-4 text-body-sm text-body">{t("account.saved.empty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {saved.map((search) => (
            <li key={search.id}>
              <SavedSearchRow search={search} editHref={`/account/saved#${search.id}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
