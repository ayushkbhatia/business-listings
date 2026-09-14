import Link from "next/link";
import { Tag } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { Check } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { formatDate, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type {
  BlendedResultView,
  BusinessResultView,
  ProductResultView,
  ResultFirmFacts,
  ServiceResultView,
} from "@/lib/search/blended-views";
import { ResponseTime } from "./ResponseTime";
import { VerificationBadge } from "./VerificationBadge";
import { tierSpec } from "./verification";

/**
 * Board `1c-s` — the three result shapes, and the argument each one makes.
 *
 * | Shape    | Carries                                        | Because |
 * |----------|------------------------------------------------|---------|
 * | Service  | turnaround, fee basis, delivered, sectors      | the scope sheet, surfaced |
 * | Business | why it matched, the services named, size band  | the firm ranks, not the single service |
 * | Product  | availability, place, *Price on enquiry*        | goods vocabulary, deliberately unchanged |
 *
 * Presentational and server-safe: the page and the gallery render the same
 * markup from the same values, and nothing here fetches.
 *
 * **Identity is `displayName`**, on every shape, and it links to the storefront
 * the name belongs to — a row whose words and destination disagree is the
 * defect `CLAUDE.md` names first under shared components.
 *
 * **Trust signals never take a theme colour.** The tier badge is the shared
 * `VerificationBadge`, and a checked credential wears the same status palette
 * — and only a checked one: B7 puts self-declared credentials on the
 * storefront's table, where their words say whose claim they are, and nowhere
 * on this row.
 */

/** The kind label a row leads with — `SERVICE`, `SUPPLIER`, `PRODUCT`. */
export function ResultKindBadge({ kind }: { kind: BlendedResultView["kind"] }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-tag border border-line bg-paper-sunk px-2 py-0.5 font-mono text-eyebrow uppercase text-body">
      {t(`search_blended.kind.${kind}` as "search_blended.kind.service")}
    </span>
  );
}

/**
 * A register-checked credential, as a badge.
 *
 * The visible words are the credential's name; the check and the register are
 * in the accessible name, so the badge is not a tick a screen reader hears as
 * a bare word.
 */
export function CheckedCredentialBadge({ kind }: { kind: string }) {
  const name = t(`credentials_public.kind.${kind}` as "credentials_public.kind.fta_tax_agent");
  return (
    <span
      data-verification-badge=""
      className="inline-flex items-center gap-1 rounded-pill border border-ok-line bg-ok-wash px-1.5 py-px font-mono text-eyebrow uppercase text-ok-ink"
    >
      <Check size={11} aria-hidden />
      <span className="sr-only">{t("search_blended.credential_checked", { credential: name })}</span>
      <span aria-hidden>{name}</span>
    </span>
  );
}

function badgeDate(firm: ResultFirmFacts): string | undefined {
  const spec = tierSpec(firm.verificationTier);
  if (spec.dateField === "none" || !firm.verifiedAt) return undefined;
  return formatDate(firm.verifiedAt);
}

/** Tier, checked credentials, place, rating and whatever else the shape adds. */
function FirmLine({ firm, extra }: { firm: ResultFirmFacts; extra?: string | null }) {
  const spec = tierSpec(firm.verificationTier);
  const facts = [
    firm.place,
    firm.rating
      ? t("search_blended.rating", { rating: firm.rating.value.toFixed(1), count: firm.rating.count })
      : null,
    extra ?? null,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <VerificationBadge
        compact
        size="sm"
        tier={firm.verificationTier}
        label={t(spec.labelKey as never)}
        checked={t(spec.checkedKey as never)}
        date={badgeDate(firm)}
        tierLabel={t("verify.tier", { tier: firm.verificationTier })}
      />
      {firm.checkedCredentials.map((kind) => (
        <CheckedCredentialBadge key={kind} kind={kind} />
      ))}
      {facts.length > 0 && <span className="text-body-sm text-body">{facts.join(" · ")}</span>}
    </div>
  );
}

function Reply({ ms }: { ms: number | null }) {
  // A measurement or nothing — there is no *slow-looking* placeholder on a result.
  if (ms === null) return null;
  return (
    <ResponseTime
      size="sm"
      medianMs={ms}
      durationLabel={formatDuration(ms)}
      label={t("response.median", { duration: formatDuration(ms) })}
      unmeasuredLabel={t("response.unmeasured")}
    />
  );
}

const NAME_LINK =
  "rounded-tag underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none";
const FIRM_LINK =
  "rounded-tag text-body-sm text-muted underline-offset-4 hover:text-ink hover:underline focus-visible:shadow-focus focus-visible:outline-none";

function Frame({
  headingId,
  children,
  aside,
}: {
  headingId: string;
  children: React.ReactNode;
  aside: React.ReactNode;
}) {
  return (
    <article
      aria-labelledby={headingId}
      className="grid gap-4 rounded-card border border-line bg-card p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_13rem] md:gap-8"
    >
      <div className="min-w-0">{children}</div>
      <div className="flex flex-col items-stretch gap-2 md:items-end md:text-end">{aside}</div>
    </article>
  );
}

function Chips({ chips }: { chips: readonly string[] }) {
  if (chips.length === 0) return null;
  return (
    <ul className="mt-3 flex list-none flex-wrap gap-1.5 p-0">
      {chips.map((chip) => (
        <li key={chip}>
          <Tag>{chip}</Tag>
        </li>
      ))}
    </ul>
  );
}

/* ── Service ─────────────────────────────────────────────────────────────── */

export function ServiceResultRow({ row }: { row: ServiceResultView }) {
  const headingId = `result-service-${row.id}`;
  const scopeHref = `/b/${row.businessSlug}/s/${row.slug}`;
  return (
    <Frame
      headingId={headingId}
      aside={
        <>
          {/* B8 — a scope sheet prices a job, not a line item. */}
          <p className="text-body-sm font-medium text-ink">{t("storefront_services.fee_on_enquiry")}</p>
          <Link
            href={`/b/${row.businessSlug}?service=${encodeURIComponent(row.slug)}#enquire`}
            aria-label={t("search_blended.enquire_named", { name: row.name })}
            className={buttonClassName({ block: true })}
          >
            {t("listing.enquire")}
          </Link>
          <Link
            href={scopeHref}
            aria-label={t("storefront_services.full_scope_named", { name: row.name })}
            className={buttonClassName({ variant: "secondary", block: true })}
          >
            {t("storefront_services.full_scope")}
          </Link>
          <Reply ms={row.replyMs} />
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ResultKindBadge kind="service" />
        <h3 id={headingId} className="text-h3 text-ink">
          <Link href={scopeHref} className={NAME_LINK}>
            {row.name}
          </Link>
        </h3>
        <Link href={`/b/${row.businessSlug}`} className={FIRM_LINK}>
          {row.businessName}
        </Link>
      </div>
      <FirmLine firm={row} />
      {row.summary && (
        <p className="mt-3 line-clamp-2 max-w-[var(--measure-prose)] text-body-sm text-body">{row.summary}</p>
      )}
      <Chips chips={row.chips} />
    </Frame>
  );
}

/* ── Business ────────────────────────────────────────────────────────────── */

/** A seller's headline often has no full stop, and a count sentence follows it. */
function sentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

export function BusinessResultRow({ row }: { row: BusinessResultView }) {
  const headingId = `result-business-${row.id}`;
  const href = `/b/${row.businessSlug}`;
  const chips = row.services
    ? [
        ...row.services.names,
        ...(row.services.total > row.services.names.length
          ? [t("search_blended.services_more", { count: row.services.total - row.services.names.length })]
          : []),
      ]
    : [];
  const summary = [
    row.summary ? sentence(row.summary) : null,
    row.services ? t("search_blended.services_listed", { count: row.services.total }) : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Frame
      headingId={headingId}
      aside={
        <>
          {row.sellsWork && (
            <p className="text-body-sm font-medium text-ink">{t("storefront_services.fee_on_enquiry")}</p>
          )}
          <Link
            href={`/rfq/new?to=${encodeURIComponent(row.businessSlug)}`}
            aria-label={t("search_blended.enquire_named", { name: row.businessName })}
            className={buttonClassName({ block: true })}
          >
            {t("listing.enquire")}
          </Link>
          <Link href={href} className={buttonClassName({ variant: "secondary", block: true })}>
            {row.sellsWork ? t("search_blended.view_firm") : t("search_blended.view_storefront")}
          </Link>
          <Reply ms={row.replyMs} />
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ResultKindBadge kind="business" />
        <h3 id={headingId} className="text-h3 text-ink">
          <Link href={href} className={NAME_LINK}>
            {row.businessName}
          </Link>
        </h3>
      </div>
      <FirmLine firm={row} extra={row.teamLabel} />
      {summary && (
        <p className="mt-3 line-clamp-2 max-w-[var(--measure-prose)] text-body-sm text-body">{summary}</p>
      )}
      <Chips chips={chips} />
      {/*
         B5. Without this sentence a buyer reads the firm as a duplicate of the
         service row above it; with it, a firm worth asking about several things.
      */}
      {row.matchedOnService && (
        <p className="mt-3 text-caption text-muted">{t("search_blended.matched_on_service")}</p>
      )}
    </Frame>
  );
}

/* ── Product ─────────────────────────────────────────────────────────────── */

export function ProductResultRow({ row }: { row: ProductResultView }) {
  const headingId = `result-product-${row.id}`;
  const href = `/b/${row.businessSlug}/p/${row.slug}`;
  const chips = [row.availability, row.place].filter((chip): chip is string => Boolean(chip));
  return (
    <Frame
      headingId={headingId}
      aside={
        <>
          {/* B4 — goods vocabulary, unchanged. */}
          <p className="text-body-sm font-medium text-ink">{t("product.no_price")}</p>
          <Link
            href={`/rfq/new?to=${encodeURIComponent(row.businessSlug)}&products=${encodeURIComponent(row.id)}`}
            aria-label={t("search_blended.enquire_named", { name: row.name })}
            className={buttonClassName({ variant: "secondary", block: true })}
          >
            {t("listing.enquire")}
          </Link>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ResultKindBadge kind="product" />
        <h3 id={headingId} className="text-h3 text-ink">
          <Link href={href} className={NAME_LINK}>
            {row.name}
          </Link>
        </h3>
        <Link href={`/b/${row.businessSlug}`} className={FIRM_LINK}>
          {row.businessName}
        </Link>
      </div>
      {row.summary && (
        <p className="mt-3 line-clamp-2 max-w-[var(--measure-prose)] text-body-sm text-body">{row.summary}</p>
      )}
      <Chips chips={chips} />
    </Frame>
  );
}

export function BlendedResultRow({ row }: { row: BlendedResultView }) {
  if (row.kind === "service") return <ServiceResultRow row={row} />;
  if (row.kind === "business") return <BusinessResultRow row={row} />;
  return <ProductResultRow row={row} />;
}

/** The list, as a list — the order is the product. */
export function BlendedResultList({
  rows,
  className,
}: {
  rows: readonly BlendedResultView[];
  className?: string;
}) {
  return (
    <ol className={cn("flex list-none flex-col gap-3 p-0", className)}>
      {rows.map((row) => (
        <li key={`${row.kind}:${row.id}`} data-result-kind={row.kind}>
          <BlendedResultRow row={row} />
        </li>
      ))}
    </ol>
  );
}
