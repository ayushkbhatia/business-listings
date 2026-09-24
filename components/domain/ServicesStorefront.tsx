import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { Tag } from "@/components/display";
import { cn } from "@/lib/cn";
import { formatCount, formatList } from "@/lib/format";
import { t } from "@/lib/i18n";
import { EnquireServiceLink } from "./EnquireServiceLink";
import { ENQUIRY_VOLUME_DAYS } from "@/lib/storefront/services-catalogue";

/**
 * Board `1d-s` — the pieces of a storefront whose catalogue is its work.
 *
 * Presentational and server-safe, so the gallery renders every documented state
 * from plain objects and the storefront renders the same markup from the loader.
 * Nothing here fetches, and nothing here knows which trade it is drawing: a
 * statutory audit, a cleaning contract and a customs clearance all arrive as a
 * name, up to three chips, a deliverable and a link.
 */

/* ── A service, as a row with a deliverable ─────────────────────────────── */

/** The compact "Enquire" control's look, shared by the link and the drawer trigger. */
export const ENQUIRE_LINK =
  "rounded-tag text-body-sm font-medium text-brand-ink underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none";

export interface ServiceSummaryView {
  slug: string;
  name: string;
  /** Engagement, turnaround and fee basis, already worded. Unfilled ones absent. */
  chips: readonly string[];
  /** What lands on the client's desk. Null when the firm has not said. */
  deliverable: string | null;
}

/**
 * One service on the overview — *rows with deliverables, not tiles with prices.*
 *
 * **B5, no fee anywhere**: there is no slot in these props an amount could
 * arrive in, and the loader behind them never selects one.
 *
 * **B6, an unfilled field is absent, not blank**: the chips are the filled ones
 * and the deliverable line is omitted when there is none. This is a summary row
 * with a link to the scope table, which is where every unanswered row is shown
 * grey — `1g-s`'s instrument, and the right place for it. A grey *Not provided*
 * chip here would say the same thing twice, smaller.
 *
 * **B9, no availability chip.** The render's *Accepting new clients* sat in
 * this footer. D11 closed as no: a listed firm is taking work, and a stale flag
 * is worse than none.
 */
export function ServiceSummaryCard({
  service,
  businessSlug,
  enquire,
}: {
  service: ServiceSummaryView;
  businessSlug: string;
  /**
   * The "Enquire" control, rendered by the caller.
   *
   * A slot because its behaviour depends on the page it is on: a storefront
   * whose rail carries the service composer moves focus into it, and one whose
   * rail carries the goods composer — `sellsKind = both` — opens the service
   * composer in a drawer instead. Defaults to the first. Null for none: a seat
   * on the firm's own team, which is offered no composer to move focus into.
   */
  enquire?: React.ReactNode;
}) {
  const href = `/b/${businessSlug}/s/${service.slug}`;
  return (
    <article className="flex h-full flex-col rounded-card border border-line bg-card p-5">
      <h3 className="text-body font-medium text-ink">
        <Link
          href={href}
          className="rounded-tag underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {service.name}
        </Link>
      </h3>

      {service.chips.length > 0 && (
        <ul className="mt-2.5 flex list-none flex-wrap gap-1.5 p-0">
          {service.chips.map((chip) => (
            <li key={chip}>
              <Tag>{chip}</Tag>
            </li>
          ))}
        </ul>
      )}

      {service.deliverable && (
        <p className="mt-3 text-body-sm text-body">{service.deliverable}</p>
      )}

      {/* Pushes the footer to the card's foot, so rows in a grid line up. */}
      <div aria-hidden className="min-h-4 flex-1" />

      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
        {/*
           Named for the service in the accessible name, so a screen reader's
           links list reads four distinct links rather than four "Enquire"s. The
           visible words start the name — WCAG's label-in-name — so a voice user
           saying what they see still hits it.
        */}
        <Link
          href={href}
          aria-label={t("storefront_services.service_scope_named", { name: service.name })}
          className="rounded-tag text-body-sm text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("storefront_services.service_scope_link")}
        </Link>
        {/*
           "Enquire" — the compact form, per the vocabulary rule. It prefills the
           composer with this service (B11) and moves focus into it.
        */}
        {enquire !== undefined ? enquire : (
          <EnquireServiceLink
            href={`/b/${businessSlug}?service=${encodeURIComponent(service.slug)}#enquire`}
            service={service.slug}
            className={ENQUIRE_LINK}
            label={t("storefront_services.enquire_named", { name: service.name })}
          >
            {t("listing.enquire")}
          </EnquireServiceLink>
        )}
      </div>
    </article>
  );
}

/* ── Sectors, declared ──────────────────────────────────────────────────── */

export interface DeclaredSectorView {
  label: string;
  engagements: number | null;
}

/**
 * Sectors they work in — B8.
 *
 * The number is the firm's own declaration and the sentence under it says so,
 * directly beneath, in both halves the board asks for: where the number comes
 * from, and why an unaudited number is on the page at all.
 *
 * A sector declared without a count is a chip without a number, which is the
 * difference between *not said* and *zero*. The disclaimer renders only when a
 * number does — a sentence disclaiming counts nobody printed reads as a page
 * that forgot to render them.
 */
export function DeclaredSectors({ sectors }: { sectors: readonly DeclaredSectorView[] }) {
  const counted = sectors.some((sector) => sector.engagements !== null);
  return (
    <>
      <ul className="flex list-none flex-wrap gap-2 p-0">
        {sectors.map((sector) => (
          <li
            key={sector.label}
            className="inline-flex items-baseline gap-2 rounded-ctl border border-line bg-card px-3 py-1.5 text-body-sm text-ink"
          >
            <span>{sector.label}</span>
            {sector.engagements !== null && (
              <span className="font-mono text-caption tabular-nums text-muted">
                <span aria-hidden>{formatCount(sector.engagements)}</span>
                <span className="sr-only">
                  {t("storefront_services.sector_count_sr", { count: sector.engagements })}
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
      {counted && (
        <p className="mt-3 max-w-[var(--measure-prose)] text-caption text-muted">
          {t("storefront_services.sectors_disclaimer")}
        </p>
      )}
    </>
  );
}

/* ── Coverage, as a sentence ────────────────────────────────────────────── */

export type DeliveryModeView = "remote" | "at_our_office" | "at_client_site";

/**
 * Where they work and how the work reaches you — the rail's coverage card.
 *
 * `places` is the union of published services' effective coverage (B7), worded
 * by the loader. The modes are the firm's `2d-s` answer. Either half may be
 * missing and each says so rather than vanishing: a services firm that has not
 * said where it works has left a question the buyer should ask.
 */
export function CoverageSummary({
  places,
  modes,
  className,
}: {
  places: readonly string[];
  modes: readonly DeliveryModeView[];
  className?: string;
}) {
  return (
    /*
       A div, not a named section. A labelled section is a landmark, and the
       gallery renders this card once per state — duplicate landmarks fail axe.
    */
    <div className={cn("rounded-card border border-line bg-paper-sunk p-5", className)}>
      <h2 className="text-body font-medium text-ink">
        {t("storefront_services.coverage_title")}
      </h2>
      <p className="mt-2 text-body-sm text-body">
        {places.length > 0
          ? t("storefront_services.coverage_places", { places: formatList(places) })
          : t("storefront_services.coverage_none")}
      </p>
      {modes.length > 0 && (
        <p className="mt-1.5 text-body-sm text-body">
          {t("storefront_services.coverage_modes", {
            modes: formatList(modes.map((mode) => t(`storefront_services.mode.${mode}` as "storefront_services.mode.remote"))),
          })}
        </p>
      )}
    </div>
  );
}

/* ── Board 1e-s — a service as a long card ──────────────────────────────── */

export interface ServiceCatalogueField {
  key: "engagement" | "turnaround" | "fee_basis" | "delivered";
  /** Already worded. Null where the firm has not said. */
  value: string | null;
}

export interface ServiceCatalogueView {
  slug: string;
  name: string;
  /** The firm's own scope paragraph, where it wrote one. */
  summary: string | null;
  /** Always four, always in this order — B1. */
  fields: readonly [ServiceCatalogueField, ServiceCatalogueField, ServiceCatalogueField, ServiceCatalogueField];
  /** The `requires_from_client` row. Null omits the line and its label — B3. */
  provides: string | null;
}

/**
 * One service on the public services list — board `1e-s`.
 *
 * **The four-field block is the page's only comparison mechanism** (B1):
 * engagement, turnaround, fee basis, delivered, in that order, on every card. A
 * field the firm has not filled reads *Not stated* rather than vanishing,
 * because a buyer reads down that column four times and a missing cell moves
 * every cell after it. This is a deliberate difference from the overview's
 * summary row (`1d-s` B6) and is written into both boards' notes.
 *
 * **No completeness figure** (B2). The render's *THIN SCOPE — 2 OF 6 ROWS
 * FILLED* is `3f-s`'s seller metric; on a buyer page it tells them nothing they
 * can act on and makes the smallest firm look careless.
 *
 * **Fee on enquiry, always** (B4). There is no prop an amount could arrive in.
 *
 * **No availability** (B7). D11 closed as no: no chip, no *Join the waitlist*,
 * no capacity sentence.
 */
export function ServiceCatalogueCard({
  service,
  businessSlug,
  enquiries,
  enquire,
}: {
  service: ServiceCatalogueView;
  businessSlug: string;
  /** Set only on the `MOST ENQUIRED` card — B5. */
  enquiries: number | null;
  /** The primary action, rendered by the caller — it needs a client island. */
  enquire: React.ReactNode;
}) {
  const scopeHref = `/b/${businessSlug}/s/${service.slug}`;
  const headingId = `service-${service.slug}`;

  return (
    <article
      aria-labelledby={headingId}
      className="grid gap-5 rounded-card border border-line bg-card p-5 md:grid-cols-[minmax(0,1fr)_13rem] md:gap-8 md:p-6"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 id={headingId} className="text-h3 text-ink">
            <Link
              href={scopeHref}
              className="rounded-tag underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {service.name}
            </Link>
          </h3>
          {enquiries !== null && (
            <span className="rounded-tag border border-line bg-paper-sunk px-2 py-0.5 font-mono text-eyebrow uppercase text-body">
              {t("storefront_services.most_enquired")}
            </span>
          )}
        </div>

        {service.summary && (
          <p className="mt-2 line-clamp-3 max-w-[var(--measure-prose)] text-body-sm text-body">
            {service.summary}
          </p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {service.fields.map((field) => (
            <div key={field.key} className="min-w-0">
              <dt className="font-mono text-eyebrow uppercase text-muted">
                {t(`storefront_services.field.${field.key}` as "storefront_services.field.engagement")}
              </dt>
              <dd className={cn("mt-1 text-body-sm", field.value === null ? "text-muted" : "text-ink")}>
                {field.value ?? t("storefront_services.not_stated")}
              </dd>
            </div>
          ))}
        </dl>

        {service.provides && (
          <p className="mt-4 border-t border-line pt-3 text-body-sm text-body">
            <span className="font-medium text-ink">{t("storefront_services.you_provide")}</span>{" "}
            {service.provides}
          </p>
        )}
      </div>

      <div className="flex flex-col items-stretch gap-2.5 md:items-end md:text-end">
        <p className="text-body-sm font-medium text-ink">{t("storefront_services.fee_on_enquiry")}</p>
        <div className="flex flex-col gap-2 md:w-full">
          {enquire}
          <Link
            href={scopeHref}
            aria-label={t("storefront_services.full_scope_named", { name: service.name })}
            className={cn(buttonClassName({ variant: "secondary", block: true }))}
          >
            {t("storefront_services.full_scope")}
          </Link>
        </div>
        {enquiries !== null && (
          <p className="font-mono text-eyebrow uppercase tabular-nums text-muted">
            {t("storefront_services.enquiries_window", { count: enquiries, days: ENQUIRY_VOLUME_DAYS })}
          </p>
        )}
      </div>
    </article>
  );
}

/* ── Board 1f-s — coverage, one row per service ─────────────────────────── */

export interface CoverageTableRow {
  slug: string;
  name: string;
  /** Already worded — *Dubai, Sharjah and Abu Dhabi*, or *All seven emirates*. */
  where: string;
  /** Free-zone registrations in emirates this row reaches, already worded. */
  qualifier: string | null;
  /** Delivered where, worded. Null reads *Not stated* (B11). */
  how: string | null;
}

/**
 * The coverage table — board `1f-s`.
 *
 * **One row per published service** (B1), because coverage genuinely differs
 * by service and a buyer in Sharjah needing an audit must read the audit row,
 * not the headline. A real table, with column heads a buyer is reading down
 * (the board's *one service* state keeps the header for that reason).
 *
 * The free-zone qualifier renders in the `Where` cell as a second line, in a
 * quieter tone, and says *registered in* — the model's word. It is a fact about
 * the firm printed beside the place a buyer acts on it (B4), never a place.
 *
 * An unstated `How` reads *Not stated* (B11), matching `1e-s`: this table is
 * read down its columns, and an empty cell misaligns the comparison.
 */
export function CoverageTable({
  rows,
  businessSlug,
  caption,
}: {
  rows: readonly CoverageTableRow[];
  businessSlug: string;
  caption: string;
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-card">
      <table className="w-full min-w-[36rem] border-collapse text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-paper-sunk">
            <th scope="col" className="w-[34%] py-2.5 pe-4 ps-5 text-start font-mono text-colhead font-normal uppercase text-muted">
              {t("storefront_services.coverage_col_service")}
            </th>
            <th scope="col" className="py-2.5 pe-4 text-start font-mono text-colhead font-normal uppercase text-muted">
              {t("storefront_services.coverage_col_where")}
            </th>
            <th scope="col" className="w-[22%] py-2.5 pe-5 text-start font-mono text-colhead font-normal uppercase text-muted">
              {t("storefront_services.coverage_col_how")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.slug} className="border-b border-line last:border-b-0">
              <th scope="row" className="py-3.5 pe-4 ps-5 text-start align-top font-normal">
                <Link
                  href={`/b/${businessSlug}/s/${row.slug}`}
                  className="rounded-tag text-ink underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {row.name}
                </Link>
              </th>
              <td className="py-3.5 pe-4 align-top text-body">
                {row.where}
                {row.qualifier && (
                  <span className="mt-0.5 block text-caption text-muted">{row.qualifier}</span>
                )}
              </td>
              <td className={cn("py-3.5 pe-5 align-top", row.how === null ? "text-muted" : "text-body")}>
                {row.how ?? t("storefront_services.not_stated")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
