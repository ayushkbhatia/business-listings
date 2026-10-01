import Link from "next/link";
import { LogoTile, StatusBadge } from "@/components/display";
import { ResponseTime, VerificationBadge, tierSpec } from "@/components/domain";
import { buttonClassName } from "@/components/primitives";
import { Check } from "@/components/primitives/icons";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { cn } from "@/lib/cn";
import type { PublicBusiness } from "@/lib/db/queries";
import { formatCount, formatDate, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { claimHref, invitesClaim } from "@/lib/listing/claim";
import { unclaimedRecord, type RecordRow } from "@/lib/listing/record";
import {
  nearestVerifiedInTrade,
  suggestionPlace,
  type Suggestion,
  type SuggestionSubject,
} from "@/lib/listing/suggestions";
import { unclaimedFacts } from "@/lib/listing/unclaimed";
import { CLAIM_MINUTES_WITH_LICENCE } from "@/lib/onboarding/claim-time";
import { crawlRel } from "@/lib/seo/crawl-policy";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { ReportTrigger } from "./ReportDialog";
import { storefrontCrumbs } from "./_storefront";

/**
 * Board 10g — the unclaimed composition of `/b/:slug`.
 *
 * Same route, same page component, selected by data: every claim status but
 * `claimed` renders here (`B1`), so a disputed listing does too — board 4c
 * `B10` and the owner's answer of 1 Oct 2026. There is no `/b/:slug/unclaimed`.
 *
 * Roughly 30,000 pages, most of what Google sees, and two readers on one
 * record. The buyer came for a supplier this business cannot be — nobody has
 * claimed the page and there is no number to call — so the page says that
 * and sends them to claimed suppliers who can answer. The owner came to see
 * what the internet says about them, so the page shows exactly what the
 * register holds, labels what is missing as missing, and gives them a reason
 * to claim it. It never fakes a rating or hours to look complete; the honesty
 * is what makes the claim worth making.
 *
 * Top to bottom: the banner, the identity block, *What the public record
 * says*, the suggestions, and the rail — claim, report, and why. Below `lg`
 * the rail stacks under the identity block with the claim card first, and the
 * banner's own claim control drops (Q5): one claim control per screen on a
 * phone.
 */
export async function UnclaimedStorefront({
  business,
  now = new Date(),
}: {
  business: PublicBusiness;
  /* A parameter, for the reason `VerificationPanel` gives: render reads no clock. */
  now?: Date;
}) {
  const head = business.locations[0] ?? null;
  const subject: SuggestionSubject = {
    businessId: business.id,
    licenceNumber: business.licenceNumber,
    primaryCategoryId: business.primaryCategoryId,
    areaId: head?.areaId ?? null,
    emirate: head?.emirate ?? null,
  };

  const [suggestions, facts] = await Promise.all([
    nearestVerifiedInTrade(subject),
    unclaimedFacts(business.id, business.claimStatus),
  ]);

  const record = unclaimedRecord(
    {
      tradeName: business.tradeName, // licence-locked
      licenceNumber: business.licenceNumber,
      licenceExpiry: business.licenceExpiry,
      licenceActivity: business.licenceActivity,
      source: business.source,
      createdAt: business.createdAt,
      verificationTier: business.verificationTier,
      verifiedAt: business.verifiedAt,
      head: head ? { addressLine: head.addressLine, phone: head.phone } : null,
    },
    now,
  );

  /*
     Both claim controls, or neither. A lapsed licence withdraws the card and
     the banner's button together (`B4`, after 13d's rule), and `invitesClaim`
     is the same test the listing's own card runs in search results.
  */
  const claimable = invitesClaim(business, now);
  const claimLink = claimHref(business.licenceNumber);
  const crumbs = storefrontCrumbs(business);
  const emirate = head ? t(`emirate.${head.emirate}` as never) : null;

  return (
    <PublicShell
      bleed
      nav={<DirectoryNav />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
      {/*
        LocalBusiness with what the licence record holds and nothing else
        (`B14`): the name, the legal name and number, and where. No telephone —
        the record's number is unverified and never printed — no opening
        hours, and no aggregateRating, because there are no reviews behind one.
        Marking up hours we do not have would be a lie in a machine-readable
        format, which is the worst kind.
      */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          name: business.displayName,
          legalName: business.tradeName, // licence-locked
          identifier: business.licenceNumber,
          address: head
            ? {
                "@type": "PostalAddress",
                addressLocality: head.area.name,
                addressRegion: emirate ?? undefined,
                addressCountry: "AE",
              }
            : undefined,
        }}
      />

      {/* ── Banner ──────────────────────────────────────────────────────── */}
      <div className="border-b border-line bg-paper-sunk">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-5 py-4">
          <p className="min-w-0 flex-1 text-body-sm text-body">
            <span className="font-medium text-ink">{t("unclaimed.banner.lead")}</span>{" "}
            {/*
               The drawn sentence says nothing here is verified, which is true of
               an import and false of a licence we have checked without a claim.
               The badge is ours to state, so the banner states it too.
            */}
            {record.licenceChecked ? t("unclaimed.banner.body_checked") : t("unclaimed.banner.body")}
          </p>
          {claimable && (
            <span className="hidden shrink-0 md:block">
              <Link href={claimLink} rel={crawlRel(claimLink)} className={buttonClassName()}>
                {t("unclaimed.banner.cta")}
              </Link>
            </span>
          )}
        </div>
      </div>

      {/*
         One grid, three children. On a desktop the identity block and the
         record sit in the left column and the rail spans both rows on the
         right, so the claim card's top lines up with the name as drawn. In
         source order the rail comes second, which is where it lands below
         `lg`: under the identity block, claim card first.
      */}
      <div className="mx-auto grid max-w-7xl gap-x-10 gap-y-5 px-5 pb-[var(--section-pad)] pt-7.5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_1fr]">
        {/* ── Identity ──────────────────────────────────────────────────── */}
        <div className="flex min-w-0 items-start gap-4 lg:col-start-1 lg:row-start-1">
          {/*
             A dashed tile, because dashed means "empty, add something here" —
             and a logo is the first thing claiming lets the owner add. Not
             `LogoTile`'s category mark: on this page the honest thing to say
             about the logo is that there is none.
          */}
          <span
            aria-hidden="true"
            className="flex size-16 shrink-0 items-center justify-center rounded-card-lg border border-dashed border-line-strong bg-fill font-mono text-eyebrow text-faint"
          >
            {t("unclaimed.no_logo")}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {/*
                 The display name, as on every card that links here — the
                 owner's answer on `B2`, 1 Oct 2026. The legal name is in the
                 record below, where it came from.
              */}
              <h1 className="min-w-0 font-serif text-h1-serif text-ink">{business.displayName}</h1>
              <StatusBadge tone="neutral">{t("display.unclaimed")}</StatusBadge>
            </div>
            <p className="mt-1.75 text-body-sm text-body">
              {business.primaryCategory.name}
              {head && (
                <>
                  {" · "}
                  {head.area.name}, {emirate}
                </>
              )}
            </p>
          </div>
        </div>

        {/* ── Rail ──────────────────────────────────────────────────────── */}
        <aside
          aria-label={t("unclaimed.rail_label")}
          className="flex min-w-0 flex-col gap-3.25 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          {claimable && (
            <ClaimCard
              claimLink={claimLink}
              underReview={facts.claimUnderReview}
              licenceChecked={record.licenceChecked}
            />
          )}
          <ReportCard slug={business.slug} />
          <WhyCard />
        </aside>

        {/* ── Record, then suggestions ──────────────────────────────────── */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <RecordCard rows={record.rows} imported={record.imported} />
          {/*
             Removed when the query finds nobody, never rendered empty (`B7`).
             A header claiming verified suppliers over zero rows is the padded
             grid this product does not draw.
          */}
          {suggestions.length > 0 && <Suggestions rows={suggestions} subject={subject} />}
        </div>
      </div>
    </PublicShell>
  );
}

/**
 * *What the public record says* — a description list, because it is one: a
 * label and a value, six times over. Not a table; there is nothing to compare
 * down a column.
 */
function RecordCard({ rows, imported }: { rows: RecordRow[]; imported: string | null }) {
  return (
    <section
      aria-labelledby="unclaimed-record-title"
      className="mt-0.5 overflow-hidden rounded-card-lg border border-line bg-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4.5 py-3.25">
        <h2 id="unclaimed-record-title" className="text-body-sm font-medium text-ink">
          {t("unclaimed.record.title")}
        </h2>
        {imported && (
          <p className="font-mono text-eyebrow uppercase tracking-[.06em] text-muted">{imported}</p>
        )}
      </div>
      <dl className="grid sm:grid-cols-2">
        {rows.map((row, index) => {
          const absent = row.value.state === "absent";
          return (
            <div
              key={row.key}
              data-record-row={row.key}
              data-absent={absent ? "" : undefined}
              className={cn(
                "flex min-w-0 items-baseline justify-between gap-4 border-t border-fill px-4.5 py-3",
                // The first row is tinted, as drawn: the name and the number
                // are the two facts everything else on the page hangs off.
                index < 2 && "bg-paper",
                index === 0 && "border-t-0",
                index === 1 && "sm:border-t-0",
                index % 2 === 1 && "sm:border-s",
                row.wide && "sm:col-span-2 sm:border-s-0",
              )}
            >
              {/*
                 An absent row is muted label and value both, so the eye reads
                 it as a gap in the record rather than as a value that happens
                 to be short. `B3`: muted, never hidden.
              */}
              <dt className={cn("shrink-0 text-body-sm", absent ? "text-faint" : "text-muted")}>
                {row.label}
              </dt>
              <dd
                className={cn(
                  "min-w-0 text-end text-body-sm",
                  row.value.state === "absent"
                    ? "text-faint"
                    : cn(
                        row.value.mono && "font-mono tabular-nums",
                        row.value.tone === "warn"
                          ? "text-warn-ink"
                          : row.value.tone === "bad"
                            ? "text-bad-ink"
                            : row.value.tone === "ok"
                              ? "text-ok-ink"
                              : "text-ink",
                      ),
                )}
              >
                {row.value.text}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/**
 * Board 13d's suggestions, on this page — `B7`.
 *
 * The rows are claimed and licence-verified by the query, so every one carries
 * the credential badge from the shared component (`B8`) and the reply time from
 * `ResponseTime` (`B9`): the two strings that drifted between boards when they
 * were typed by hand.
 */
function Suggestions({ rows, subject }: { rows: Suggestion[]; subject: SuggestionSubject }) {
  return (
    <section aria-labelledby="unclaimed-suggestions-title" className="mt-5">
      <h2 id="unclaimed-suggestions-title" className="text-h2 font-medium text-ink">
        {t("unclaimed.suggestions.title")}
      </h2>
      <p className="mb-3.5 mt-1.75 text-body-sm text-body">{t("unclaimed.suggestions.body")}</p>
      <ul className="flex flex-col gap-2.75">
        {rows.map((row) => (
          <SuggestionRow key={row.id} row={row} subject={subject} />
        ))}
      </ul>
      {/*
         13d's promise, printed here too (D-LINE). A supplier who buys
         placement elsewhere can appear in this list, on the same terms as
         everybody else, so the page says what decided the order.
      */}
      <p className="mt-2.5 text-caption text-muted">{t("unclaimed.suggestions.footer")}</p>
    </section>
  );
}

function SuggestionRow({ row, subject }: { row: Suggestion; subject: SuggestionSubject }) {
  const spec = tierSpec(row.verificationTier);
  const place = suggestionPlace(row, subject);
  /*
     What they have published, counted. A catalogue for a firm that sells
     goods, a scope list for one that sells work, nothing for one that has
     published neither — never a zero.
  */
  const listed =
    row._count.products > 0
      ? t("unclaimed.suggestions.products", {
          count: row._count.products,
          formatted: formatCount(row._count.products),
        })
      : row._count.services > 0
        ? t("unclaimed.suggestions.services", {
            count: row._count.services,
            formatted: formatCount(row._count.services),
          })
        : null;
  const href = `/b/${row.slug}`;

  return (
    <li className="flex items-center gap-3.5 rounded-card border border-line bg-card px-4 py-3.5">
      {/*
         The category's mark, as `LogoTile` draws for every supplier without a
         logo — not the board's initials, which the tile declines to generate:
         a worse copy of the name printed beside it.
      */}
      <LogoTile name={row.displayName} categoryCode={row.primaryCategory.code} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="min-w-0 text-body-sm font-medium text-ink">
            <a
              href={href}
              className="rounded-tag underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {row.displayName}
            </a>
          </h3>
          <VerificationBadge
            compact
            size="sm"
            tier={row.verificationTier}
            label={t(spec.labelKey as never)}
            checked={t(spec.checkedKey as never)}
            date={spec.dateField !== "none" && row.verifiedAt ? formatDate(row.verifiedAt) : undefined}
          />
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-caption text-muted">
          {listed && (
            <>
              <span>{listed}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          {place && (
            <>
              <span>{place.area.name}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <ResponseTime
            size="sm"
            medianMs={row.responseTimeMedianMs}
            durationLabel={
              row.responseTimeMedianMs !== null ? formatDuration(row.responseTimeMedianMs) : undefined
            }
            label={
              row.responseTimeMedianMs !== null
                ? t("response.median", { duration: formatDuration(row.responseTimeMedianMs) })
                : undefined
            }
            unmeasuredLabel={t("response.unmeasured")}
          />
        </p>
      </div>
      {/*
         Named, because "View" three times over is three identical links to a
         screen reader. The visible word is the board's, and it leads the name.
      */}
      <a
        href={href}
        aria-label={t("unclaimed.suggestions.view_named", { name: row.displayName })}
        className={cn(buttonClassName({ size: "md" }), "shrink-0")}
      >
        {t("unclaimed.suggestions.view")}
      </a>
    </li>
  );
}

/**
 * The claim card. Its promises are 2b's and no more (`B11`): the time comes
 * from the one value 2a's add-new card also reads, and the badge is described
 * as where claiming leads, not as something claiming grants — 2b says
 * submitting does not grant a tier, and the card cannot say otherwise.
 *
 * With a claim already under review, or two in conflict, it says so and still
 * takes one: blocking a second claimant would hand the listing to whoever
 * arrived first (`2b`, Q2). It names nobody — not the other claimant, not how
 * many there are.
 */
function ClaimCard({
  claimLink,
  underReview,
  licenceChecked,
}: {
  claimLink: string;
  underReview: boolean;
  /** The badge is already earned — the card does not promise it again. */
  licenceChecked: boolean;
}) {
  const ticks = [
    t("unclaimed.claim.tick_content"),
    t("unclaimed.claim.tick_fanout"),
    t("unclaimed.claim.tick_reply"),
  ];

  return (
    <section
      aria-labelledby="unclaimed-claim-title"
      data-claim-card={underReview ? "under-review" : "open"}
      className="rounded-card-lg border-[1.5px] border-moss bg-card px-5 py-4.75"
    >
      <h2 id="unclaimed-claim-title" className="text-h3 font-medium text-ink">
        {t("unclaimed.claim.title")}
      </h2>
      {underReview && (
        <p className="mt-2 text-body-sm text-ink">{t("unclaimed.claim.under_review")}</p>
      )}
      <p className="mt-2 text-body-sm leading-relaxed text-body">
        {t(licenceChecked ? "unclaimed.claim.body_checked" : "unclaimed.claim.body", {
          minutes: CLAIM_MINUTES_WITH_LICENCE,
        })}
      </p>
      <ul className="mt-3.5 flex flex-col gap-2.25">
        {ticks.map((tick) => (
          <li key={tick} className="flex items-center gap-2.5 text-caption text-body">
            <span aria-hidden="true" className="shrink-0 text-ok">
              <Check size={12} />
            </span>
            {tick}
          </li>
        ))}
      </ul>
      <Link
        href={claimLink}
        rel={crawlRel(claimLink)}
        className={cn(buttonClassName({ size: "lg", block: true }), "mt-4")}
      >
        {t("listing.claim_cta")}
      </Link>
    </section>
  );
}

/**
 * *Something wrong here?* — board 13c's report, opened over this page at
 * `?report=1` (`B12`), with `/report/:slug` underneath for a reader with no
 * script. On an unclaimed listing the details are the most likely thing on the
 * page to be wrong, and the person who knows is standing in front of it.
 */
function ReportCard({ slug }: { slug: string }) {
  return (
    <section
      aria-labelledby="unclaimed-report-title"
      className="rounded-card-lg border border-line bg-paper-sunk px-4.5 py-4"
    >
      <h2 id="unclaimed-report-title" className="text-body-sm font-medium text-ink">
        {t("unclaimed.report.title")}
      </h2>
      <p className="mt-1.5 text-caption leading-relaxed text-body">{t("unclaimed.report.body")}</p>
      <ReportTrigger slug={slug} className={cn(buttonClassName({ size: "sm", variant: "secondary" }), "mt-3")}>
        {t("listing.report")}
      </ReportTrigger>
    </section>
  );
}

function WhyCard() {
  return (
    <section
      aria-labelledby="unclaimed-why-title"
      className="rounded-card-lg border border-line bg-card px-4.5 py-4"
    >
      <h2
        id="unclaimed-why-title"
        className="font-mono text-eyebrow font-medium uppercase tracking-[.11em] text-faint"
      >
        {t("unclaimed.why.eyebrow")}
      </h2>
      <p className="mt-2 text-caption leading-relaxed text-body">{t("unclaimed.why.body")}</p>
    </section>
  );
}
