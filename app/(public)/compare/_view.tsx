import Link from "next/link";
import { StatusBadge, type StatusTone } from "@/components/display";
import { ImagePlaceholder } from "@/components/display/ImagePlaceholder";
import { ResponseTime, VerificationBadge, tierSpec } from "@/components/domain";
import { buttonClassName } from "@/components/primitives";
import { Close } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import type { CompareCell, CompareRow } from "@/lib/compare/table";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { crawlRel } from "@/lib/seo/crawl-policy";
import { removeColumn } from "./actions";
import { PrintButton } from "./PrintButton";

/**
 * Board `10d` — the comparison's markup, from a table already built.
 *
 * No database import, so the gallery renders the page's own parts from fixed
 * values rather than a copy of them. `page.tsx` loads, builds and frames it.
 */

/** A product's column head, as a value — what the page read, already shaped. */
export interface CompareColumn {
  id: string;
  slug: string;
  name: string;
  businessSlug: string;
  /** Always `displayName`. */
  seller: string;
  verificationTier: number;
  verifiedAt: string | null;
  imageUrl: string | null;
}

/* ── Header ──────────────────────────────────────────────────────────────── */

export function CompareHeader({
  columns,
  trade,
  hasTemplate,
  hideMatching,
  toggleHref,
  askAllHref,
  exportHref,
  headingLevel = 1,
}: {
  columns: readonly CompareColumn[];
  trade: string;
  hasTemplate: boolean;
  hideMatching: boolean;
  /** `?diff=1` on or off, the rest of the URL kept. */
  toggleHref: string;
  askAllHref: string;
  /** The CSV of this set — board `1n`'s exporter, shared. Absent in the gallery. */
  exportHref?: string;
  /** 1 on the page. The gallery draws it under its own `h1`, where a second is a defect. */
  headingLevel?: 1 | 2;
}) {
  const count = columns.length;
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-line pb-5 print:border-none">
      <div className="min-w-0 max-w-[var(--measure-prose)]">
        <Heading className="font-serif text-h1-serif text-ink">
          {t("compare.heading", { count, formatted: formatCount(count) })}
        </Heading>
        {/*
           The claim the screen exists to make legible — and only where it is
           true. A trade with no template has no shared fields, and saying they
           are "genuinely the same fields" over a table with none would be the
           sentence lying about the table under it.
        */}
        <p className="mt-2 text-prose text-prose">
          {hasTemplate ? t("compare.lede", { trade }) : t("compare.lede_no_template", { trade })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {count >= 2 && hasTemplate && (
          <a href={toggleHref} rel="nofollow" className={buttonClassName({ variant: "secondary" })}>
            {hideMatching ? t("compare.show_all") : t("compare.hide_matching")}
          </a>
        )}
        <PrintButton label={t("compare.print")} />
        {exportHref ? (
          <a href={exportHref} rel="nofollow" download className={buttonClassName({ variant: "secondary" })}>
            {t("compare.export_csv")}
          </a>
        ) : null}
        {/*
           `B2`: one CTA string. `Ask all 4 for a quote` opens the composer with
           every column's seller pinned and every column's product as a matched
           line — one enquiry, the fan-out's own record shape (`Q5`).
        */}
        <a href={askAllHref} rel="nofollow" className={buttonClassName()}>
          {t("compare.ask_all", { count, formatted: formatCount(count) })}
        </a>
      </div>
    </header>
  );
}

/* ── The table ───────────────────────────────────────────────────────────── */

const TONE: Record<NonNullable<CompareCell["tone"]>, StatusTone> = {
  ok: "ok",
  info: "info",
  warn: "warn",
  neutral: "neutral",
};

const AVAILABILITY_KEY = {
  in_stock: "availability.in_stock",
  made_to_order: "availability.made_to_order",
  indent: "availability.indent",
  out_of_stock: "availability.out_of_stock",
} as const;

/**
 * The comparison, as a real table (`CLAUDE.md` non-negotiable 4).
 *
 * Transposed against every other table in the product: products are columns and
 * fields are rows, because four products across is what fits and a buyer reads
 * down one field at a time. That is a `<th scope="col">` per product and a
 * `<th scope="row">` per field, which is what lets a screen reader announce
 * *Emirates Valve, End connection, Lugged wafer* from any cell.
 *
 * **A tint is never the only signal** (WCAG 1.4.1). A differing row also carries
 * a mark in its heading and the words *differs between these products* for
 * anyone not reading colour, and the tint prints (`print-color-adjust: exact`),
 * because a printed comparison that has lost its differences is not one.
 */
export function ComparisonTable({
  columns,
  rows,
  set,
  hideMatching,
  caption,
  captionId = "compare-caption",
}: {
  columns: readonly CompareColumn[];
  rows: readonly CompareRow[];
  /** The ids this page is showing, in order — the remove control keeps the rest. */
  set: readonly string[];
  hideMatching: boolean;
  caption: string;
  /** Unique per table on a page — the region is named by it. */
  captionId?: string;
}) {
  return (
    <div
      role="region"
      aria-labelledby={captionId}
      /*
         Focusable because it scrolls. Four columns do not fit a phone, and a
         scrolling region a keyboard cannot reach is content a keyboard cannot
         read (axe `scrollable-region-focusable`).
      */
      tabIndex={0}
      className="mt-5 overflow-x-auto rounded-card border border-line bg-card focus-visible:outline-none focus-visible:shadow-focus print:overflow-visible print:border-line-strong"
    >
      <table className="w-full min-w-[44rem] border-collapse text-start print:min-w-0">
        <caption id={captionId} className="sr-only">
          {caption}
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky start-0 z-10 w-44 bg-card px-4 py-3 text-start align-top font-mono text-colhead uppercase text-muted"
            >
              {t("compare.spec_head")}
            </th>
            {columns.map((column) => (
              <ColumnHead key={column.id} column={column} set={set} hideMatching={hideMatching} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.key} row={row} columns={columns} />
          ))}
          <tr>
            <th scope="row" className="sticky start-0 z-10 bg-card px-4 py-3">
              <span className="sr-only">{t("compare.ask_row")}</span>
            </th>
            {columns.map((column) => (
              <td key={column.id} className="border-s border-t border-line px-4 py-3 align-top print:hidden">
                <a
                  href={`/rfq/new?to=${encodeURIComponent(column.businessSlug)}&products=${encodeURIComponent(column.id)}`}
                  rel="nofollow"
                  aria-label={t("search_blended.enquire_named", { name: column.name })}
                  className={buttonClassName({ block: true })}
                >
                  {t("listing.enquire")}
                </a>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ColumnHead({
  column,
  set,
  hideMatching,
}: {
  column: CompareColumn;
  set: readonly string[];
  hideMatching: boolean;
}) {
  const spec = tierSpec(column.verificationTier);
  const date = spec.dateField === "none" || !column.verifiedAt ? undefined : formatDate(column.verifiedAt);
  const productHref = `/b/${column.businessSlug}/p/${column.slug}`;

  return (
    <th scope="col" className="min-w-52 border-s border-line px-4 py-3 text-start align-top font-normal">
      <div className="relative">
        {column.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={column.imageUrl}
            alt=""
            className="aspect-[3/1] w-full rounded-chip border border-line bg-card object-cover print:hidden"
          />
        ) : (
          <div className="print:hidden">
            <ImagePlaceholder kind="empty" ratio="3 / 1" rounded="chip" />
          </div>
        )}
        {/*
           Remove, as a form: it edits the set this page shows and the buyer's
           tray together (`removeColumn`), and a link cannot change a cookie.
        */}
        <form action={removeColumn} className="absolute end-1 top-1 print:hidden">
          <input type="hidden" name="productId" value={column.id} />
          <input type="hidden" name="set" value={set.join(",")} />
          {hideMatching && <input type="hidden" name="diff" value="1" />}
          <button
            type="submit"
            aria-label={t("compare.remove", { name: column.name })}
            title={t("compare.remove", { name: column.name })}
            className="flex size-7 items-center justify-center rounded-chip bg-card/90 text-muted shadow-sm transition-colors duration-120 ease-out hover:bg-fill hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
          >
            <Close size={12} />
          </button>
        </form>
      </div>

      <p className="mt-3 text-body-sm font-medium text-ink">
        <Link
          href={productHref}
          rel={crawlRel(productHref)}
          className="rounded-tag underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {column.name}
        </Link>
      </p>
      <p className="mt-0.5 text-caption text-muted">
        <Link
          href={`/b/${column.businessSlug}`}
          className="rounded-tag underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {column.seller}
        </Link>
      </p>
      {/*
         `B3` and correction 2: the shared badge, which names the licence —
         *Licence verified* — on every column alike. A bare *Verified* would not
         say which of the two things this platform verifies it means.
      */}
      <div className="mt-2">
        <VerificationBadge
          compact
          size="sm"
          tier={column.verificationTier}
          label={t(spec.labelKey as never)}
          checked={t(spec.checkedKey as never)}
          date={date}
          tierLabel={t("verify.tier", { tier: column.verificationTier })}
        />
      </div>
    </th>
  );
}

function Row({ row, columns }: { row: CompareRow; columns: readonly CompareColumn[] }) {
  /* The two seller rows sit under a heavier rule: they describe who answers, not the product. */
  const sellerRow = row.kind === "reply" || row.kind === "completeness";
  return (
    <tr data-differs={row.differs || undefined} data-row-kind={row.kind}>
      <th
        scope="row"
        className={cn(
          "sticky start-0 z-10 border-t border-line bg-card px-4 py-3 text-start align-top text-body-sm font-normal text-body",
          row.kind === "reply" && "border-t-2 border-t-line-strong",
        )}
      >
        <span className="inline-flex items-center gap-2">
          {row.differs && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-moss" />}
          {row.label}
        </span>
        {row.differs && <span className="sr-only"> — {t("compare.differs")}</span>}
      </th>
      {row.cells.map((cell, index) => {
        const column = columns[index];
        if (!column) return null;
        const filled = cell.text !== null || sellerRow || row.kind === "availability";
        return (
          <td
            key={column.id}
            className={cn(
              "border-s border-t border-line px-4 py-3 align-top text-body-sm",
              row.kind === "reply" && "border-t-2 border-t-line-strong",
              row.differs && filled && "bg-moss-wash [print-color-adjust:exact]",
            )}
          >
            <Cell row={row} cell={cell} />
          </td>
        );
      })}
    </tr>
  );
}

function Cell({ row, cell }: { row: CompareRow; cell: CompareCell }) {
  if (row.kind === "availability") {
    const value = cell.text as keyof typeof AVAILABILITY_KEY;
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge size="sm" dot tone={TONE[cell.tone ?? "neutral"]}>
          {t(AVAILABILITY_KEY[value])}
        </StatusBadge>
        {cell.stockQty != null && (
          <span className="font-mono text-eyebrow tabular-nums text-muted">
            {t("product.in_stock_qty", { qty: formatCount(cell.stockQty) })}
          </span>
        )}
        {cell.leadTimeDays != null && (
          <span className="font-mono text-eyebrow tabular-nums text-muted">
            {t("product.lead_time", { days: cell.leadTimeDays })}
          </span>
        )}
      </span>
    );
  }

  if (row.kind === "reply") {
    /* `B9`: measured, in the platform's one format. Unmeasured says so, never a placeholder. */
    return (
      <ResponseTime
        size="sm"
        medianMs={cell.replyMs ?? null}
        durationLabel={cell.replyMs ? formatDuration(cell.replyMs) : undefined}
        label={cell.replyMs ? t("response.median", { duration: formatDuration(cell.replyMs) }) : undefined}
        unmeasuredLabel={t("response.unmeasured")}
      />
    );
  }

  if (row.kind === "completeness") {
    /*
       `B11`: the count, and no colour. A seller diagnostic on a buyer's screen
       must not become a pass or a fail — the grey rows above already say where
       the gaps are.
    */
    return (
      <span className="font-mono tabular-nums text-body">
        {t("display.fields_filled", { filled: cell.filled ?? 0, total: cell.total ?? 0 })}
      </span>
    );
  }

  /* `B6`: a gap in the listing, in grey, never tinted and never a difference. */
  if (cell.text === null) return <span className="text-muted">{t("table.not_provided")}</span>;
  return (
    <span className={cn("text-ink", cell.mono && "font-mono tabular-nums")}>
      {cell.text}
      {cell.unit && <span className="ms-1 text-muted">{cell.unit}</span>}
    </span>
  );
}

/* ── Under the table ─────────────────────────────────────────────────────── */

/**
 * The board's summary, counted rather than written.
 *
 * *So the eye lands on the four rows that actually decide this* — four on the
 * fixture, and whatever the table holds anywhere else. The price clause the
 * board also drew is gone (correction 3): there is no price row, and the
 * trade-off it pointed at is the availability row, which says it already.
 */
export function CompareSummary({ deciding, hasTemplate }: { deciding: number; hasTemplate: boolean }) {
  return (
    <div className="mt-4 flex flex-wrap items-start justify-between gap-x-8 gap-y-2 rounded-card bg-paper-sunk px-5 py-4 print:bg-transparent print:px-0">
      <p className="max-w-[var(--measure-prose)] text-body-sm text-body">
        {!hasTemplate
          ? t("compare.summary_no_template")
          : deciding > 0
            ? t("compare.summary", { count: deciding, formatted: formatCount(deciding) })
            : t("compare.summary_none")}
      </p>
      <p className="font-mono text-eyebrow uppercase text-muted">{t("compare.footnote")}</p>
    </div>
  );
}

/**
 * `B10` and the one-trade rule — every product the URL named that is not in
 * the table, and why. Nothing leaves a comparison without the page saying so.
 */
export function CompareNotices({
  delisted,
  otherTrade,
  overflow,
  trade,
}: {
  delisted: number;
  otherTrade: readonly { id: string; name: string; trade: string }[];
  overflow: number;
  trade: string;
}) {
  const lines = [
    delisted > 0 ? t("compare.notice_delisted", { count: delisted, formatted: formatCount(delisted) }) : null,
    ...otherTrade.map((item) => t("compare.notice_other_trade", { name: item.name, other: item.trade, trade })),
    overflow > 0 ? t("compare.notice_overflow", { count: overflow, formatted: formatCount(overflow) }) : null,
  ].filter((line): line is string => line !== null);
  if (lines.length === 0) return null;

  return (
    <ul className="mt-4 flex list-none flex-col gap-1 rounded-card border border-line bg-card px-4 py-3 print:hidden">
      {lines.map((line) => (
        <li key={line} className="text-body-sm text-body">
          {line}
        </li>
      ))}
    </ul>
  );
}

/* ── States ──────────────────────────────────────────────────────────────── */

/** Nothing held, and nothing in the URL. How to start one, and what it is for. */
export function CompareEmpty({ headingLevel = 1 }: { headingLevel?: 1 | 2 }) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className="mt-8 max-w-[var(--measure-prose)]">
      <Heading className="font-serif text-h1-serif text-ink">{t("compare.empty_title")}</Heading>
      <p className="mt-3 text-prose text-prose">{t("compare.empty_body")}</p>
      {/*
         `B8` and `10c` Q1, stated rather than implied: this compares products.
         A buyer who came here with a service in mind is told where that
         comparison actually happens.
      */}
      <p className="mt-2 text-body-sm text-muted">{t("compare.services_note")}</p>
      <div className="mt-5">
        <Link href="/search?kind=products" className={buttonClassName({ variant: "secondary" })}>
          {t("compare.browse")}
        </Link>
      </div>
    </div>
  );
}

/** One product: a column, and what is missing. A comparison of one is not one. */
export function CompareNeedsMore({ trade }: { trade: string }) {
  return (
    <p className="mt-4 rounded-card border border-dashed border-line px-4 py-3 text-body-sm text-body print:hidden">
      {t("compare.need_more", { trade })}
    </p>
  );
}
