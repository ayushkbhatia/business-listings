import Link from "next/link";
import { Alert } from "@/components/display/Alert";
import { StatusBadge } from "@/components/display/StatusBadge";
import { VerificationBadge, tierSpec } from "@/components/domain";
import { buttonClassName } from "@/components/primitives";
import { Check } from "@/components/primitives/icons";
import type { QuoteComparisonData } from "@/lib/db/queries/quote-comparison";
import type { ComparisonOutlook } from "@/lib/buyer-company/queue";
import { requirementHeadline } from "@/lib/enquiry/inbox-status";
import { releaseSentences } from "@/lib/enquiry/release-words";
import { canNudge } from "@/lib/enquiry/tracking";
import {
  formatAED,
  formatCloses,
  formatCount,
  formatDate,
  formatDateShort,
  formatDuration,
  formatList,
  formatRating,
  formatRelative,
  isWithinRelativeWindow,
} from "@/lib/format";
import { t } from "@/lib/i18n";
import { MESSAGE_ALL_MAX } from "@/lib/messaging/limits";
import {
  leadTone,
  SORT_KEYS,
  type Cell,
  type NoQuoteRow,
  type QuoteComparisonModel,
  type QuotedRow,
  type RequestedLine,
  type SortKey,
  type WaitingRow,
} from "@/lib/quote/comparison";
import { filsToAed } from "@/lib/quote/money";
import { NudgeButton } from "../NudgeButton";
import { AcceptQuote, type AcceptSheet } from "./_accept";
import { MessageAll } from "./_message-all";
import type { MessageAllState } from "./actions";

/**
 * Board `1n` — the quotes on one enquiry, side by side, priced line by line.
 *
 * A server component with no data of its own: the page loads the enquiry and
 * the company's rule and hands them in; the gallery hands fixtures. Every
 * figure is read off `QuoteComparisonModel`, which the CSV reads too.
 *
 * ## The board, and the three things it got wrong
 *
 * - **Every line's winner is marked**, the gasket column included (`B2`), with
 *   a word beside the colour — the cheapest-per-line card beneath is computed
 *   from those marks, so the card and the table cannot disagree (`B1`).
 * - **Accept is on every quoted row**, the same control on each (`B4`,
 *   correction 3): a tinted row with the only Accept on it was a recommendation
 *   the copy never made. Row order is arrival unless the buyer picks another.
 * - **A company enquiry says on the row what accepting will do** (`B7`):
 *   *Send for approval* where the rule holds it, naming who approves.
 *
 * Suppliers who have not quoted keep their row (`1n-s` B8, `10h` B9): dimmed,
 * saying when they opened it, with the one nudge (`B10`).
 */

export interface QuoteComparisonViewProps {
  data: QuoteComparisonData;
  model: QuoteComparisonModel;
  now: Date;
  token: string | null;
  outlook: ComparisonOutlook;
  /** Board `7b`: an open request on this enquiry, already worded by the page. */
  approvalNotice?: React.ReactNode;
  error: string | null;
  /** The accept server action. Absent in the gallery, where nothing posts. */
  acceptAction?: (formData: FormData) => Promise<void>;
  messageAllAction?: (state: MessageAllState, formData: FormData) => Promise<MessageAllState>;
  /**
   * Build plan 9.4: whether this person holds `quote.accept`, which the service
   * asks before anything else. False takes every accept control away — the
   * sheet, the company's accept screen link and the card that explains them —
   * and the page says why. The thread stays: asking is still theirs.
   */
  mayAccept?: boolean;
  /** False in the gallery: the nudge is a live control that writes. */
  live?: boolean;
  /** Prefixes ids, so the gallery can draw several states on one page. */
  idPrefix?: string;
}

export function QuoteComparisonView({
  data,
  model,
  now,
  token,
  outlook,
  approvalNotice,
  error,
  acceptAction,
  messageAllAction,
  mayAccept = true,
  live = true,
  idPrefix = "compare",
}: QuoteComparisonViewProps) {
  const { enquiry } = data;
  const carry = token ? `?t=${encodeURIComponent(token)}` : "";
  const base = `/enquiry/${encodeURIComponent(enquiry.ref)}`;
  const style = moneyStyle(model);
  const quotedRows = model.rows.filter((row): row is QuotedRow => row.kind === "quoted");
  const accepted = model.phase === "accepted" ? quotedRows.find((row) => row.state === "accepted") ?? null : null;
  const messageable = model.phase === "open" && model.rows.some((row) => row.kind !== "no_quote" || !row.declinedBySupplier);
  // Said before the button is pressed, not after — and only where there is one. The record keeps it.
  const explainsAccept = mayAccept || model.phase === "accepted";

  return (
    <div className="mx-auto w-full max-w-7xl px-[var(--section-pad)] pb-16">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 py-8">
        <div className="min-w-0">
          <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted">{eyebrow(data, model, now)}</p>
          <h1 className="mt-2 font-serif text-h1-serif text-ink">{requirementHeadline(enquiry.requirement)}</h1>
          <p className="mt-2 text-body text-body">
            {t("compare_quotes.lines", { count: model.lines.length })}
            {" · "}
            {t("compare_quotes.sent_to", { count: model.sentTo })}
            {" · "}
            {model.quoted > 0 ? (
              <span className="text-ok-ink">{t("compare_quotes.received", { count: model.quoted })}</span>
            ) : (
              t("compare_quotes.received_none")
            )}
          </p>
        </div>
        {model.quoted > 0 ? (
          <div className="flex flex-wrap items-start gap-2">
            <a
              href={`${base}/compare/export${carry}`}
              rel="nofollow"
              download
              className={buttonClassName({ variant: "secondary" })}
            >
              {t("compare_quotes.export")}
            </a>
            {messageable ? (
              <MessageAll
                enquiryId={enquiry.id}
                token={token}
                max={MESSAGE_ALL_MAX}
                action={messageAllAction}
                words={messageAllWords(model)}
              />
            ) : null}
          </div>
        ) : null}
      </header>

      <div className="space-y-3">
        {error ? (
          <Alert tone="bad" live="assertive" fix={t("compare_quotes.error_fix")}>
            {error}
          </Alert>
        ) : null}
        {model.phase === "closed" && !error ? (
          <Alert tone="neutral" live="off">
            {t("compare.error_enquiry_closed")}
          </Alert>
        ) : null}
        {/* Said only where an accept would otherwise be offered: closed and accepted say their own. */}
        {!mayAccept && model.phase === "open" && model.quoted > 0 && !error ? (
          <Alert tone="neutral" live="off">
            {t("compare.error_not_permitted")}
          </Alert>
        ) : null}
        {accepted ? (
          <Alert
            tone="ok"
            live="off"
            action={
              <Link
                href={`${base}/accepted${carry}`}
                className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("compare_quotes.view_record")}
              </Link>
            }
          >
            {t("compare_quotes.accepted_notice", {
              supplier: accepted.supplier.displayName,
              date: formatDate(enquiry.acceptedAt ?? accepted.quote.sentAt),
            })}
          </Alert>
        ) : null}
        {approvalNotice}
      </div>

      {model.quoted === 0 ? (
        <NoQuotesYet model={model} now={now} token={token} enquiryRef={enquiry.ref} live={live} idPrefix={idPrefix} />
      ) : (
        <>
          <SortNav sort={model.sort} base={`${base}/compare`} token={token} />
          <ComparisonTable
            data={data}
            model={model}
            now={now}
            token={token}
            style={style}
            outlook={outlook}
            acceptAction={acceptAction}
            mayAccept={mayAccept}
            live={live}
            idPrefix={idPrefix}
          />
          <p className="mt-2 text-caption text-body">{t("compare_quotes.basis")}</p>
          {model.cheapest || explainsAccept ? (
            <div className="mt-6 grid gap-[var(--gutter)] lg:grid-cols-2">
              {model.cheapest ? <CheapestCard model={model} style={style} base={base} carry={carry} idPrefix={idPrefix} /> : null}
              {explainsAccept ? <OnAcceptCard data={data} model={model} outlook={outlook} idPrefix={idPrefix} /> : null}
            </div>
          ) : null}
        </>
      )}

      <p className="mt-8">
        <Link
          href={`${base}${carry}`}
          className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("enquiry.track")}
        </Link>
      </p>
    </div>
  );
}

/* ── Money ─────────────────────────────────────────────────────────────────── */

type MoneyStyle = "display" | "exact";

/**
 * Whole dirhams where every figure on the page is one, fils everywhere
 * otherwise. Rounding cells one way and totals another is how a column stops
 * adding up to the figure under it — one style for the whole table.
 */
function moneyStyle(model: QuoteComparisonModel): MoneyStyle {
  const figures: bigint[] = [];
  for (const row of model.rows) {
    if (row.kind !== "quoted") continue;
    figures.push(row.totalFils, row.extraFils);
    for (const cell of row.cells) if (cell.kind === "priced") figures.push(cell.totalFils);
  }
  if (model.cheapest) figures.push(model.cheapest.totalFils, ...(model.cheapest.against ? [model.cheapest.against.savingFils] : []));
  return figures.every((fils) => fils % 100n === 0n) ? "display" : "exact";
}

function money(fils: bigint, style: MoneyStyle): string {
  return formatAED(filsToAed(fils), { style });
}

/* ── Header ────────────────────────────────────────────────────────────────── */

function eyebrow(data: QuoteComparisonData, model: QuoteComparisonModel, now: Date): string {
  const { enquiry } = data;
  const parts = [enquiry.ref, t("compare_quotes.eyebrow_sent", { date: formatDateShort(enquiry.createdAt) })];
  if (model.phase === "accepted" && enquiry.acceptedAt) {
    parts.push(t("compare_quotes.eyebrow_accepted", { date: formatDateShort(enquiry.acceptedAt) }));
  } else if (model.phase === "closed") {
    parts.push(t("compare_quotes.eyebrow_closed", { date: formatDateShort(enquiry.closesAt) }));
  } else if (isWithinRelativeWindow(enquiry.closesAt, { now })) {
    parts.push(t("compare_quotes.eyebrow_closes_in", { when: formatCloses(enquiry.closesAt, { now }) }));
  } else {
    parts.push(t("compare_quotes.eyebrow_closes_on", { date: formatDateShort(enquiry.closesAt) }));
  }
  return parts.join(" · ");
}

function messageAllWords(model: QuoteComparisonModel) {
  const names = model.rows
    .filter((row) => row.kind !== "no_quote" || !row.declinedBySupplier)
    .filter((row) => !row.supplier.closed)
    .map((row) => row.supplier.displayName);
  return {
    button: t("compare_quotes.message_all.button"),
    title: t("compare_quotes.message_all.title"),
    description: t("compare_quotes.message_all.description"),
    label: t("compare_quotes.message_all.label"),
    hint: t("compare_quotes.message_all.hint", { max: formatCount(MESSAGE_ALL_MAX) }),
    recipients: t("compare_quotes.message_all.recipients", { count: names.length, names: formatList(names) }),
    send: t("compare_quotes.message_all.send", { count: names.length }),
    cancel: t("compare_quotes.message_all.cancel"),
    close: t("compare_quotes.message_all.close"),
    // The client fills the two figures in as the buyer types; the words stay the catalogue's.
    counter: t("compare_quotes.message_all.counter", { used: "{used}", limit: "{limit}" }),
  };
}

/* ── Sort ──────────────────────────────────────────────────────────────────── */

/**
 * Flag 3 — four quotes in the order they came, and nothing else. The order is
 * still arrival by default; a buyer may pick total or lead time, and a total
 * sort keeps every complete quote above an incomplete one (`B5`). Links, so the
 * order lives in the address and works before any script loads.
 */
function SortNav({ sort, base, token }: { sort: SortKey; base: string; token: string | null }) {
  return (
    // A group, not a landmark: the gallery draws this in every state, and a sort
    // is not a place anybody navigates to.
    <div role="group" aria-label={t("compare_quotes.sort_label")} className="flex flex-wrap items-center gap-2 text-body-sm">
      <span className="text-body">{t("compare_quotes.sort_prefix")}</span>
      <ul className="flex list-none flex-wrap gap-1 p-0">
        {SORT_KEYS.map((key) => {
          const params = new URLSearchParams();
          if (key !== "received") params.set("sort", key);
          if (token) params.set("t", token);
          const query = params.toString();
          const current = key === sort;
          return (
            <li key={key}>
              <Link
                href={`${base}${query ? `?${query}` : ""}`}
                aria-current={current ? "true" : undefined}
                className={
                  current
                    ? "inline-flex min-h-8 items-center rounded-chip border-[1.5px] border-moss bg-moss-wash px-2.5 text-ink focus-visible:shadow-focus focus-visible:outline-none"
                    : "inline-flex min-h-8 items-center rounded-chip border border-line bg-card px-2.5 text-body hover:bg-fill focus-visible:shadow-focus focus-visible:outline-none"
                }
              >
                {t(`compare_quotes.sort.${key}` as "compare_quotes.sort.received")}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── The table ─────────────────────────────────────────────────────────────── */

const HEAD = "px-4 py-3 text-left align-bottom font-mono text-colhead uppercase text-muted font-normal";
const CELL = "px-4 py-4 align-top";
/**
 * The supplier column, pinned while the lines scroll past it. A painted edge
 * rather than a border: a collapsed border stays behind when the cell sticks.
 */
const PINNED = "sticky left-0 z-10 bg-clip-padding shadow-[inset_-1px_0_0_var(--line)]";

function ComparisonTable({
  data,
  model,
  now,
  token,
  style,
  outlook,
  acceptAction,
  mayAccept,
  live,
  idPrefix,
}: {
  data: QuoteComparisonData;
  model: QuoteComparisonModel;
  now: Date;
  token: string | null;
  style: MoneyStyle;
  outlook: ComparisonOutlook;
  acceptAction: ((formData: FormData) => Promise<void>) | undefined;
  mayAccept: boolean;
  live: boolean;
  idPrefix: string;
}) {
  const span = model.lines.length + 2;
  // One column per line, never three hard-coded (flag 9): at 1440 three lines
  // fit, past four the table scrolls inside its own frame, and the supplier
  // column stays put.
  const minWidth = `${16.5 + model.lines.length * 8.5 + 27}rem`;
  const sortedBy = model.sort;

  return (
    /*
       `relative`, so the frame is the containing block of the `sr-only` marks
       inside it. Without it those absolutely positioned words escape the
       frame's clip, sit at the table's full width, and a phone's layout
       viewport widens to fit them — the page scrolled sideways while every
       visible element stayed inside 412px.
    */
    <div
      tabIndex={0}
      role="group"
      aria-label={t("compare_quotes.table_label")}
      className="relative mt-4 overflow-x-auto rounded-card border border-line bg-card focus-visible:shadow-focus focus-visible:outline-none"
    >
      <table className="w-full border-collapse text-left" style={{ minWidth }}>
        <caption className="sr-only">
          {t("compare_quotes.caption", { count: model.quoted })}
        </caption>
        <thead>
          <tr className="border-b border-line bg-paper-sunk">
            {/* Pinned, and narrower on a phone so the lines have room to scroll past it. */}
            <th scope="col" className={`${HEAD} ${PINNED} w-[11rem] bg-paper-sunk sm:w-[16.5rem]`}>
              {t("compare_quotes.col.supplier")}
            </th>
            {model.lines.map((line) => (
              <th key={line.id} scope="col" className={`${HEAD} w-[8.5rem]`}>
                <LineHead line={line} />
              </th>
            ))}
            <th scope="col" className={`${HEAD} w-[8.5rem]`} aria-sort={sortedBy === "lead" ? "ascending" : undefined}>
              {t("compare_quotes.col.lead")}
            </th>
            <th
              scope="col"
              className={`${HEAD} w-[8rem] whitespace-nowrap text-right`}
              aria-sort={sortedBy === "total" ? "ascending" : undefined}
            >
              {t("compare_quotes.col.total")}
            </th>
            <th scope="col" className={`${HEAD} w-[10.5rem]`}>
              <span className="sr-only">{mayAccept ? t("compare_quotes.col.action") : t("compare_quotes.col.view")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) =>
            row.kind === "quoted" ? (
              <QuotedTableRow
                key={row.supplier.businessId}
                row={row}
                data={data}
                model={model}
                now={now}
                token={token}
                style={style}
                outlook={outlook}
                acceptAction={acceptAction}
                mayAccept={mayAccept}
              />
            ) : row.kind === "waiting" ? (
              <WaitingTableRow
                key={row.supplier.businessId}
                row={row}
                span={span}
                now={now}
                token={token}
                enquiryRef={data.enquiry.ref}
                live={live}
                idPrefix={idPrefix}
              />
            ) : (
              <NoQuoteTableRow key={row.supplier.businessId} row={row} span={span} />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function LineHead({ line }: { line: RequestedLine }) {
  const facts = [line.size, line.qty === null ? null : t("compare_quotes.col.line_qty", { qty: formatCount(line.qty), unit: line.unit ?? "" }).trim()]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="block">
      <span className="block font-sans text-body-sm normal-case tracking-normal text-ink">{line.description}</span>
      {facts ? <span className="mt-0.5 block">{facts}</span> : null}
    </span>
  );
}

/* ── One supplier ──────────────────────────────────────────────────────────── */

function SellerCell({ row, dim }: { row: QuotedRow | WaitingRow | NoQuoteRow; dim: boolean }) {
  const supplier = row.supplier;
  const spec = tierSpec(supplier.verificationTier);
  const meta = [
    supplier.rating
      ? t("compare_quotes.rating", { rating: formatRating(supplier.rating.average), count: supplier.rating.count })
      : null,
    row.kind === "quoted" ? t("compare_quotes.quoted_in", { duration: formatDuration(row.quotedInMs) }) : null,
  ].filter((part): part is string => part !== null);

  return (
    <th
      scope="row"
      className={`${CELL} ${PINNED} w-[11rem] font-normal sm:w-[16.5rem] ${dim ? "bg-paper-sunk" : "bg-card"}`}
    >
      <Link
        href={`/b/${supplier.slug}`}
        className={`rounded-tag text-body font-medium underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none ${dim ? "text-body" : "text-ink"}`}
      >
        {supplier.displayName}
      </Link>
      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <VerificationBadge
          tier={supplier.verificationTier}
          label={t(spec.labelKey as never)}
          checked={t(spec.checkedKey as never)}
          date={spec.dateField === "verifiedAt" && supplier.verifiedAt ? formatDate(supplier.verifiedAt) : undefined}
          size="sm"
          compact
        />
        {meta.map((fact) => (
          // Each fact wraps whole: *4.8 from 31 reviews* never breaks after the 4.8.
          <span key={fact} className="whitespace-nowrap font-mono text-eyebrow uppercase tracking-eyebrow text-body">
            {fact}
          </span>
        ))}
      </span>
      {row.kind === "quoted" && row.superseded ? (
        <span className="mt-1 block text-caption text-warn-ink">
          {t("compare_quotes.superseded", { revision: row.quote.againstRevision })}
        </span>
      ) : null}
    </th>
  );
}

function QuotedTableRow({
  row,
  data,
  model,
  now,
  token,
  style,
  outlook,
  acceptAction,
  mayAccept,
}: {
  row: QuotedRow;
  data: QuoteComparisonData;
  model: QuoteComparisonModel;
  now: Date;
  token: string | null;
  style: MoneyStyle;
  outlook: ComparisonOutlook;
  acceptAction: ((formData: FormData) => Promise<void>) | undefined;
  mayAccept: boolean;
}) {
  const dim = row.state !== "open" && row.state !== "accepted";
  return (
    <tr className={`border-b border-line last:border-b-0 ${dim ? "bg-paper-sunk" : ""}`}>
      <SellerCell row={row} dim={dim} />
      {row.cells.map((cell, index) => (
        <td key={cell.lineId} className={CELL}>
          <PriceCell cell={cell} line={model.lines[index]!} style={style} dim={dim} />
        </td>
      ))}
      <td className={CELL}>
        <LeadCell days={row.leadTimeDays} neededBy={data.enquiry.neededBy} now={now} />
      </td>
      <td className={`${CELL} text-right`}>
        <span className={`block whitespace-nowrap text-body tabular-nums ${dim ? "text-body" : "font-medium text-ink"}`}>
          {money(row.totalFils, style)}
        </span>
        {!row.complete ? (
          <span className="mt-0.5 block text-caption text-warn-ink">
            {t("compare_quotes.total.partial", { quoted: row.quotedLines, total: row.totalLines })}
          </span>
        ) : null}
        {row.extraLines > 0 ? (
          <span className="mt-0.5 block text-caption text-body">
            {t("compare_quotes.total.extra", { count: row.extraLines, amount: money(row.extraFils, style) })}
          </span>
        ) : null}
      </td>
      <td className={CELL}>
        <RowActions
          row={row}
          data={data}
          model={model}
          now={now}
          token={token}
          style={style}
          outlook={outlook}
          acceptAction={acceptAction}
          mayAccept={mayAccept}
        />
      </td>
    </tr>
  );
}

function PriceCell({ cell, line, style, dim }: { cell: Cell; line: RequestedLine; style: MoneyStyle; dim: boolean }) {
  if (cell.kind === "not_quoted") {
    return <span className="text-body-sm text-muted">{t("compare_quotes.not_quoted")}</span>;
  }
  const detail =
    cell.parts > 1
      ? t("compare_quotes.cell.parts", { count: cell.parts })
      : cell.unitFils !== null && cell.qty !== null
        ? t("compare_quotes.cell.each", { price: formatAED(filsToAed(cell.unitFils), { style: "quote" }) })
        : null;
  return (
    <span className="block">
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap text-body-sm tabular-nums ${
          cell.winner ? "text-ok-ink" : dim ? "text-body" : "text-ink"
        }`}
      >
        {cell.winner ? <Check size={12} /> : null}
        {money(cell.totalFils, style)}
      </span>
      {cell.winner ? <span className="sr-only">{t("compare_quotes.cell.lowest")}</span> : null}
      {detail ? <span className="mt-0.5 block text-caption tabular-nums text-body">{detail}</span> : null}
      {!cell.comparable && line.qty !== null ? (
        <span className="mt-0.5 block text-caption text-warn-ink">
          {cell.qty === null
            ? t("compare_quotes.cell.no_qty", { asked: formatCount(line.qty) })
            : t("compare_quotes.cell.other_qty", { qty: formatCount(cell.qty), asked: formatCount(line.qty) })}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Flag 6 — the boundary is the buyer's own date. With a needed-by date the
 * colour says whether it lands in time, and a word beside it says the same;
 * with none there is no boundary, and no colour pretends to one.
 */
function LeadCell({ days, neededBy, now }: { days: number | null; neededBy: Date | null; now: Date }) {
  if (days === null) return <span className="text-body-sm text-muted">{t("compare_quotes.lead.not_stated")}</span>;
  const tone = leadTone(days, neededBy, now);
  const label = days === 0 ? t("compare_quotes.lead.ex_stock") : t("compare_quotes.lead.days", { count: days });
  return (
    <span className="block">
      <span className={`text-body-sm ${tone === "ok" ? "text-ok-ink" : tone === "late" ? "text-warn-ink" : "text-ink"}`}>
        {label}
      </span>
      {neededBy && tone !== "none" ? (
        <span className="mt-0.5 block text-caption text-body">
          {tone === "ok"
            ? t("compare_quotes.lead.in_time", { date: formatDateShort(neededBy) })
            : t("compare_quotes.lead.late", { date: formatDateShort(neededBy) })}
        </span>
      ) : null}
    </span>
  );
}

function RowActions({
  row,
  data,
  model,
  now,
  token,
  style,
  outlook,
  acceptAction,
  mayAccept,
}: {
  row: QuotedRow;
  data: QuoteComparisonData;
  model: QuoteComparisonModel;
  now: Date;
  token: string | null;
  style: MoneyStyle;
  outlook: ComparisonOutlook;
  acceptAction: ((formData: FormData) => Promise<void>) | undefined;
  mayAccept: boolean;
}) {
  const carry = token ? `?t=${encodeURIComponent(token)}` : "";
  const base = `/enquiry/${encodeURIComponent(data.enquiry.ref)}`;
  const supplier = row.supplier.displayName;
  const view = (
    <Link
      href={`${base}/thread/${row.supplier.slug}${carry}`}
      aria-label={t("compare_quotes.view_named", { supplier })}
      className={buttonClassName({ variant: "secondary", size: "sm" })}
    >
      {t("compare_quotes.view")}
    </Link>
  );

  if (row.state === "accepted") {
    return (
      <span className="flex flex-col items-start gap-1.5">
        <StatusBadge tone="ok" shape="chip">
          {t("compare_quotes.state.accepted")}
        </StatusBadge>
        <Link
          href={`${base}/accepted${carry}`}
          className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("compare_quotes.view_record")}
        </Link>
      </span>
    );
  }

  if (row.state !== "open") {
    const said =
      row.state === "expired"
        ? t("compare_quotes.state.expired", { date: formatDateShort(row.quote.expiresAt ?? now) })
        : t(`compare_quotes.state.${row.state}` as "compare_quotes.state.declined");
    return (
      <span className="flex flex-col items-start gap-1.5">
        <StatusBadge tone="neutral" shape="chip">
          {said}
        </StatusBadge>
        {view}
      </span>
    );
  }

  // Build plan 9.4: the service refuses this person before it reads the quote,
  // so the row offers what they can still do — read it and ask — and the page says why.
  if (!mayAccept) return view;

  const figure = money(row.totalFils, style);
  if (outlook.kind === "company" || outlook.kind === "not_member") {
    // Board `7b`: the rule is read on the accept screen before anything is
    // pressed; the row says which of its two outcomes this quote will meet.
    const need = outlook.kind === "company" ? outlook.quotes.get(row.quote.id) : undefined;
    const approval = need?.required ?? false;
    return (
      <span className="flex flex-col items-start gap-1.5">
        <span className="flex items-center gap-2">
          <Link
            href={`${base}/accept/${row.quote.id}${carry}`}
            aria-label={
              approval
                ? t("compare_quotes.approval_named", { supplier, ref: row.quote.ref, total: figure })
                : t("compare_quotes.accept_named", { supplier, ref: row.quote.ref, total: figure })
            }
            className={buttonClassName({ size: "sm", variant: approval ? "secondary" : "primary" })}
          >
            {approval ? t("company.accept.send_for_approval") : t("compare_quotes.accept")}
          </Link>
          {view}
        </span>
        {approval ? (
          <span className="whitespace-normal text-caption text-body">
            {need && need.approverNames.length > 0
              ? t("compare_quotes.approval_by", { names: formatList(need.approverNames) })
              : t("compare_quotes.approval_nobody")}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <AcceptQuote
        label={t("compare_quotes.accept")}
        accessibleName={t("compare_quotes.accept_named", { supplier, ref: row.quote.ref, total: figure })}
        sheet={acceptSheet(row, data, model, figure)}
        quoteId={row.quote.id}
        enquiryId={data.enquiry.id}
        token={token}
        action={acceptAction}
        primary
      />
      {view}
    </span>
  );
}

/** The sheet's words: `10h`'s facts, for this row. */
function acceptSheet(row: QuotedRow, data: QuoteComparisonData, model: QuoteComparisonModel, figure: string): AcceptSheet {
  const supplier = row.supplier.displayName;
  const others = model.rows.filter((other) => other.supplier.businessId !== row.supplier.businessId).map((other) => other.supplier.displayName);
  const unquoted = row.cells.filter((cell) => cell.kind === "not_quoted").length;
  const terms = [
    row.quote.paymentTerms ? t(`terms.${row.quote.paymentTerms}` as "terms.net_30") : t("accepted.not_stated"),
    row.quote.delivery ? t(`compare.delivery.${row.quote.delivery}` as "compare.delivery.included") : t("accepted.not_stated"),
  ];
  return {
    title: t("negotiation.accept.dialog_title", { revision: row.quote.revision, supplier }),
    description: t("negotiation.accept.dialog_description"),
    facts: [
      t("negotiation.accept.fact_figure", {
        figure,
        lines: t("negotiation.accept.fact_lines", { count: row.quotedLines }),
      }),
      t("compare_quotes.sheet.terms", { payment: terms[0]!, delivery: terms[1]! }),
      row.quote.expiresAt ? t("compare_quotes.sheet.held", { date: formatDate(row.quote.expiresAt) }) : null,
      ...releaseSentences({ companyName: data.enquiry.companyName, hasDeliveryAddress: data.enquiry.hasDeliveryAddress }, supplier),
      others.length > 0 ? t("negotiation.accept.fact_declined", { names: formatList(others) }) : null,
      t("negotiation.accept.fact_no_payment", { supplier }),
      t("negotiation.accept.fact_record"),
    ].filter((fact): fact is string => fact !== null),
    warning: unquoted > 0 ? t("negotiation.accept.unaccepted_lines", { count: unquoted }) : null,
    warningFix: unquoted > 0 ? t("negotiation.accept.unaccepted_fix") : null,
    confirm: t("negotiation.accept.confirm", { revision: row.quote.revision }),
    cancel: t("compare_quotes.sheet.cancel"),
    close: t("negotiation.accept.close"),
  };
}

function WaitingTableRow({
  row,
  span,
  now,
  token,
  enquiryRef,
  live,
  idPrefix,
}: {
  row: WaitingRow;
  span: number;
  now: Date;
  token: string | null;
  enquiryRef: string;
  live: boolean;
  idPrefix: string;
}) {
  const said = waitingWords(row, now);
  const nudgeable = canNudge(
    { state: row.state, buyerNudgedAt: row.buyerNudgedAt, deliveredAt: row.deliveredAt, repliedAt: row.repliedAt },
    now,
  );
  return (
    <tr className="border-b border-line bg-paper-sunk last:border-b-0">
      <SellerCell row={row} dim />
      <td colSpan={span} className={`${CELL} text-body-sm text-body`}>
        {said}
      </td>
      <td className={CELL}>
        {row.buyerNudgedAt ? (
          <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-body">
            {t("compare_quotes.nudged", { when: formatRelative(row.buyerNudgedAt, { now }) })}
          </span>
        ) : live ? (
          <NudgeButton
            businessId={row.supplier.businessId}
            enquiryRef={enquiryRef}
            token={token}
            disabled={!nudgeable}
            label={t("compare_quotes.nudge")}
            waitLabel={t("track.nudge_wait")}
            sentLabel={t("compare_quotes.nudge_sent")}
            source="compare"
          />
        ) : (
          <span id={`${idPrefix}-nudge-${row.supplier.businessId}`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
            {t("compare_quotes.nudge")}
          </span>
        )}
      </td>
    </tr>
  );
}

function NoQuoteTableRow({ row, span }: { row: NoQuoteRow; span: number }) {
  const said = row.declinedBySupplier
    ? row.declineReason
      ? t("compare_quotes.no_quote.declined_reason", { reason: row.declineReason })
      : t("compare_quotes.no_quote.declined")
    : t("compare_quotes.no_quote.none");
  return (
    <tr className="border-b border-line bg-paper-sunk last:border-b-0">
      <SellerCell row={row} dim />
      <td colSpan={span + 1} className={`${CELL} text-body-sm text-body`}>
        {said}
      </td>
    </tr>
  );
}

/** Where a supplier who has not quoted has got to, in one line. */
function waitingWords(row: WaitingRow, now: Date): string {
  if (row.repliedAt) return t("compare_quotes.waiting.replied", { when: formatRelative(row.repliedAt, { now }) });
  if (row.state === "opened" && row.openedAt) {
    return t("compare_quotes.waiting.opened", { when: formatRelative(row.openedAt, { now }) });
  }
  return t("compare_quotes.waiting.delivered", { when: formatRelative(row.deliveredAt, { now }) });
}

/* ── Nothing yet ───────────────────────────────────────────────────────────── */

/**
 * §States: the page with no quotes is who the enquiry went to and where each of
 * them has got to — not an empty table, and not a 404.
 */
function NoQuotesYet({
  model,
  now,
  token,
  enquiryRef,
  live,
  idPrefix,
}: {
  model: QuoteComparisonModel;
  now: Date;
  token: string | null;
  enquiryRef: string;
  live: boolean;
  idPrefix: string;
}) {
  return (
    <div role="group" aria-labelledby={`${idPrefix}-no-quotes`} className="mt-2 rounded-card border border-line bg-card p-[var(--card-pad)]">
      <h2 id={`${idPrefix}-no-quotes`} className="text-h3 text-ink">
        {t("compare_quotes.none_title")}
      </h2>
      <p className="mt-1 max-w-[var(--measure-prose)] text-body-sm text-body">
        {model.phase === "open"
          ? t("compare_quotes.none_body", { count: model.sentTo })
          : t("compare_quotes.none_body_closed", { count: model.sentTo })}
      </p>
      <ul className="mt-4 list-none divide-y divide-line p-0">
        {model.rows.map((row) => (
          <li key={row.supplier.businessId} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span>
              <span className="block text-body-sm font-medium text-ink">{row.supplier.displayName}</span>
              <span className="block text-caption text-body">
                {row.kind === "waiting"
                  ? waitingWords(row, now)
                  : row.kind === "no_quote" && row.declinedBySupplier
                    ? row.declineReason
                      ? t("compare_quotes.no_quote.declined_reason", { reason: row.declineReason })
                      : t("compare_quotes.no_quote.declined")
                    : t("compare_quotes.no_quote.none")}
              </span>
            </span>
            {row.kind === "waiting" && live && !row.buyerNudgedAt ? (
              <NudgeButton
                businessId={row.supplier.businessId}
                enquiryRef={enquiryRef}
                token={token}
                disabled={
                  !canNudge(
                    { state: row.state, buyerNudgedAt: row.buyerNudgedAt, deliveredAt: row.deliveredAt, repliedAt: row.repliedAt },
                    now,
                  )
                }
                label={t("compare_quotes.nudge")}
                waitLabel={t("track.nudge_wait")}
                sentLabel={t("compare_quotes.nudge_sent")}
                source="compare"
              />
            ) : row.kind === "waiting" && row.buyerNudgedAt ? (
              <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-body">
                {t("compare_quotes.nudged", { when: formatRelative(row.buyerNudgedAt, { now }) })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── The two cards ─────────────────────────────────────────────────────────── */

/**
 * Cheapest per line, computed from the green marks (`B1`–`B3`). It names only
 * the suppliers it needs and counts their deliveries. Accepting is one supplier
 * per enquiry (decided 24 Sep 2026), so the card is a figure to negotiate with:
 * it says so, and points at the threads where a supplier can revise.
 */
function CheapestCard({
  model,
  style,
  base,
  carry,
  idPrefix,
}: {
  model: QuoteComparisonModel;
  style: MoneyStyle;
  base: string;
  carry: string;
  idPrefix: string;
}) {
  const split = model.cheapest!;
  const suppliers = formatList(split.suppliers.map((s) => s.displayName));
  const deliveries = t("compare_quotes.cheapest.deliveries", { count: split.deliveries });
  return (
    <div role="group" aria-labelledby={`${idPrefix}-cheapest`} className="rounded-card border border-line bg-card p-[var(--card-pad)]">
      <h2 id={`${idPrefix}-cheapest`} className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted">
        {t("compare_quotes.cheapest.eyebrow")}
      </h2>
      <p className="mt-2 max-w-[var(--measure-prose)] text-body text-prose">
        {split.against
          ? t("compare_quotes.cheapest.body", {
              suppliers,
              total: money(split.totalFils, style),
              saving: money(split.against.savingFils, style),
              deliveries,
            })
          : t("compare_quotes.cheapest.body_no_single", { suppliers, total: money(split.totalFils, style), deliveries })}
      </p>
      <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-body">{t("compare_quotes.cheapest.one_supplier")}</p>
      <ul className="mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0">
        {split.suppliers.map((supplier) => (
          <li key={supplier.businessId}>
            <Link
              href={`${base}/thread/${supplier.slug}${carry}`}
              className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("compare_quotes.cheapest.thread", { supplier: supplier.displayName })}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What happens on accept, in the service's own terms (Phase 2.4): the quote is
 * accepted at its prices, what is released is named (`B9`), the others are told
 * (`B8`), and — on a company enquiry — where the rule sends it first (`B7`).
 */
function OnAcceptCard({
  data,
  model,
  outlook,
  idPrefix,
}: {
  data: QuoteComparisonData;
  model: QuoteComparisonModel;
  outlook: ComparisonOutlook;
  idPrefix: string;
}) {
  const others = model.sentTo - 1;
  const approvers =
    outlook.kind === "company"
      ? [...new Set([...outlook.quotes.values()].filter((q) => q.required).flatMap((q) => q.approverNames))]
      : [];
  const anyHeld = outlook.kind === "company" && [...outlook.quotes.values()].some((q) => q.required);

  const sentences =
    model.phase === "accepted"
      ? [t("compare_quotes.on_accept.done")]
      : [
          ...(anyHeld
            ? [
                approvers.length > 0
                  ? t("compare_quotes.on_accept.approval", { names: formatList(approvers) })
                  : t("compare_quotes.on_accept.approval_nobody"),
              ]
            : []),
          t("compare_quotes.on_accept.accepted"),
          ...releaseSentences({ companyName: data.enquiry.companyName, hasDeliveryAddress: data.enquiry.hasDeliveryAddress }, null),
          ...(others > 0 ? [t("compare_quotes.on_accept.declined", { count: others })] : []),
          t("compare_quotes.on_accept.no_payment"),
        ];

  return (
    <div role="group" aria-labelledby={`${idPrefix}-on-accept`} className="rounded-card border border-line bg-paper-sunk p-[var(--card-pad)]">
      <h2 id={`${idPrefix}-on-accept`} className="font-mono text-eyebrow uppercase tracking-eyebrow text-muted">
        {t("compare_quotes.on_accept.eyebrow")}
      </h2>
      <p className="mt-2 max-w-[var(--measure-prose)] text-body text-prose">{sentences.join(" ")}</p>
    </div>
  );
}
