import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { buttonClassName } from "@/components/primitives";
import { ChipLink } from "@/components/display";
import { scopeWords } from "@/components/domain";
import { CoverageTable, type CoverageTableRow } from "@/components/domain/ServicesStorefront";
import { getBusinessBySlug } from "@/lib/db/queries";
import { absorbedInto, redirectIfMoved } from "@/lib/listing/redirect";
import { navPages } from "@/lib/storefront/pages";
import {
  coveragePageFor,
  coveringFirmsByEmirate,
  type CoveragePlace,
} from "@/lib/storefront/services";
import {
  coverageDiffers,
  coversEveryEmirate,
  emirateOptions,
  fanoutOffer,
  filterRowsByEmirate,
  offerService,
  rowQualifiers,
  showsEmirateFilter,
  uncoveredEmirates,
  EMIRATE_ORDER,
} from "@/lib/storefront/coverage-page";
import { sellsWork } from "@/lib/storefront/tabs";
import { MIN_SAMPLE, WINDOW_DAYS } from "@/lib/metrics/response-time";
import { formatCount, formatDuration, formatList } from "@/lib/format";
import { t } from "@/lib/i18n";
import { absoluteUrl } from "@/lib/site";
import { crawlRel } from "@/lib/seo/crawl-policy";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { StorefrontHeader, storefrontCrumbs } from "../_storefront";

/**
 * Board `1f-s` — coverage, where branches and hours were.
 *
 * The goods `1f` is a branch list with pins and an hours table per row. A firm
 * that sells work usually has one office and does most of its work somewhere
 * else, and rendering that as a branch list answers nothing. So this page
 * answers the two questions that survive: **where does the work reach**, and
 * **when will they reply**.
 *
 * - **One row per live service** (B1), each through `effectiveCoverage` — the
 *   helper `1g-s` uses, so a service's row here and its own page agree.
 * - **No hours table, Ramadan band, pin or map** (B2).
 * - **Reply time is the platform's measurement**, with the sample it stands on
 *   stated beside it (B3).
 * - **Free zones are registrations**, printed beside the rows they qualify and
 *   never merged into the places or the filter (B4).
 * - **Languages are labelled as the firm's own claim** (B5).
 * - **The miss is an offer**: an emirate this firm does not cover, with a live
 *   count of the firms that do (B6).
 * - **No availability** (B8). D11 closed as no, so the H1 is *Where they work*
 *   and nothing else.
 */
export const revalidate = 300;

interface Params {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function emirateParam(raw: Record<string, string | string[] | undefined>): string | null {
  const value = Array.isArray(raw.emirate) ? raw.emirate[0] : raw.emirate;
  return value && (EMIRATE_ORDER as readonly string[]).includes(value) ? value : null;
}

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return {};
  const filtered = emirateParam(await searchParams) !== null;
  return {
    title: t("storefront_services.coverage_page_title", { name: business.displayName }),
    description: t("storefront_services.coverage_page_description", { name: business.displayName }),
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
    alternates: { canonical: `/b/${business.slug}/coverage` },
  };
}

export default async function StorefrontCoveragePage({ params, searchParams }: Params) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) {
    await redirectIfMoved(`/b/${slug}/coverage`);
    notFound();
  }
  const movedTo = await absorbedInto(slug);
  if (movedTo) permanentRedirect(`/b/${movedTo}/coverage`);
  if (business.claimStatus === "unclaimed") notFound();
  if (!sellsWork(business.sellsKind)) notFound();

  const emirate = emirateParam(await searchParams);
  const basePath = `/b/${business.slug}/coverage`;

  const [data, pages] = await Promise.all([
    coveragePageFor(business.id),
    business.sectorId ? navPages(business.sectorId) : Promise.resolve([]),
  ]);

  const rows = data.rows.map((row) => ({ ...row, serviceId: row.service.id }));
  const shown = filterRowsByEmirate(rows, emirate);

  /*
     The offer names the service most likely to miss and an emirate it does not
     reach, with the live count of other firms whose same service does. Only
     computed where there is a miss to offer on.
  */
  const missing = offerService(rows);
  const counts = missing
    ? await coveringFirmsByEmirate(missing.service.categoryId, business.id)
    : new Map<string, number>();
  const offer = missing ? fanoutOffer(uncoveredEmirates(missing.places), counts) : null;
  /*
     Board `1h-s`'s seeded arrival: the trade and the emirate answer question 01
     and the cursor starts in question 02. The description is left for the
     buyer — `1h-s` B2 sends it as they write it, and a sentence we prefilled
     would reach six firms in the buyer's name.
  */
  const offerHref = missing
    ? `/rfq/new?${new URLSearchParams({
        category: missing.service.categorySlug,
        kind: "services",
        ...(offer ? { emirate: offer.emirate } : {}),
      })}`
    : null;

  const head = business.locations[0];
  const tableRows: CoverageTableRow[] = shown.map((row) => wordRow(row, data.freeZones));

  return (
    <PublicShell
      bleed
      nav={<DirectoryNav />}
      breadcrumb={
        <Breadcrumb
          label={t("gallery.breadcrumb_label")}
          items={storefrontCrumbs(business, t("storefront_services.coverage_tab"))}
        />
      }
      footer={<DirectoryFooter />}
    >
      {/*
         Each service with the places it serves, from the same resolution the
         table uses. No opening hours and no geo — B2 drops both from the page,
         and a machine should not be told what a buyer is not.
      */}
      {rows.length > 0 && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: t("storefront_services.coverage_page_title", { name: business.displayName }),
            itemListElement: rows.map((row, index) => ({
              "@type": "ListItem",
              position: index + 1,
              item: {
                "@type": "Service",
                name: row.service.name,
                url: absoluteUrl(`/b/${business.slug}/s/${row.service.slug}`),
                provider: { "@type": "LocalBusiness", name: business.displayName },
                areaServed: row.places.map((place) => ({
                  "@type": place.areaId ? "Place" : "AdministrativeArea",
                  name: place.label,
                })),
              },
            })),
          }}
        />
      )}

      <div data-theme={business.themePreset ?? "default"}>
        <StorefrontHeader
          business={business}
          active="coverage"
          pages={pages}
          subline={t("storefront_services.coverage_subline", {
            count: rows.length,
            formatted: formatCount(rows.length),
          })}
        />

        <div className="mx-auto grid w-full max-w-7xl gap-[var(--gutter)] px-5 py-8 lg:grid-cols-[minmax(0,1fr)_21.25rem]">
          <div className="min-w-0">
            <h2 className="font-serif text-h1-serif text-ink">{t("storefront_services.coverage_heading")}</h2>

            {coverageDiffers(rows) && (
              <p className="mt-2 max-w-[var(--measure-prose)] text-body text-body">
                {t("storefront_services.coverage_lead")}
              </p>
            )}

            {/* Q2 — the same threshold `1e-s`'s filters appear at. */}
            {showsEmirateFilter(rows.length) && (
              <nav aria-label={t("storefront_services.coverage_filter_label")} className="mt-4">
                <ul className="flex list-none flex-wrap gap-1.5 p-0">
                  <li>
                    <ChipLink href={basePath} size="sm" selected={emirate === null}>
                      {t("storefront_services.filters_all")}
                    </ChipLink>
                  </li>
                  {emirateOptions(rows).map((value) => {
                    const href = `${basePath}?emirate=${value}`;
                    return (
                      <li key={value}>
                        <ChipLink
                          href={href}
                          rel={crawlRel(href)}
                          size="sm"
                          selected={emirate === value}
                          count={formatCount(filterRowsByEmirate(rows, value).length)}
                        >
                          {t(`emirate.${value}` as never)}
                        </ChipLink>
                      </li>
                    );
                  })}
                </ul>
              </nav>
            )}

            <div className="mt-5">
              {rows.length === 0 ? (
                <p className="max-w-[var(--measure-prose)] text-body-sm text-muted">
                  {t("storefront_services.services_none", { name: business.displayName })}
                </p>
              ) : (
                <CoverageTable
                  rows={tableRows}
                  businessSlug={business.slug}
                  caption={t("storefront_services.coverage_caption", { name: business.displayName })}
                />
              )}
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {head && (
                <InfoCard id="coverage-office" eyebrow={t("storefront_services.coverage_office")}>
                  <address className="not-italic">
                    <span className="block text-body text-ink">{head.addressLine}</span>
                    <span className="block text-body text-ink">
                      {head.area.name}, {t(`emirate.${head.emirate}` as never)}
                    </span>
                  </address>
                  <p className="mt-2 text-body-sm text-muted">
                    {business.deliveryModes.includes("at_our_office")
                      ? t("storefront_services.coverage_office_meets")
                      : t("storefront_services.coverage_office_registered")}
                  </p>
                </InfoCard>
              )}

              {/*
                 B3. The header's figure, and the sample behind it. The platform
                 measures over ninety days with a floor of three replies — one
                 definition, so this card and the header can never print two
                 reply times for one firm.
              */}
              <InfoCard id="coverage-reply" eyebrow={t("storefront_services.coverage_reply")}>
                {business.responseTimeMedianMs === null ? (
                  <>
                    <p className="text-body text-ink">{t("storefront_services.coverage_reply_unmeasured")}</p>
                    <p className="mt-2 text-body-sm text-muted">
                      {t("storefront_services.coverage_reply_unmeasured_note", {
                        min: formatCount(MIN_SAMPLE),
                        days: WINDOW_DAYS,
                      })}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-body text-ink">
                      {t("storefront_services.coverage_reply_usually", {
                        duration: formatDuration(business.responseTimeMedianMs),
                      })}
                    </p>
                    <p className="mt-2 text-body-sm text-muted">
                      {t("storefront_services.coverage_reply_measured", {
                        count: data.replies,
                        formatted: formatCount(data.replies),
                        days: WINDOW_DAYS,
                      })}
                    </p>
                  </>
                )}
              </InfoCard>

              {business.languages.length > 0 && (
                <InfoCard id="coverage-languages" eyebrow={t("storefront_services.coverage_languages")}>
                  <p className="text-body text-ink">{formatList(business.languages)}</p>
                  <p className="mt-2 text-body-sm text-muted">{t("storefront_services.coverage_languages_claim")}</p>
                </InfoCard>
              )}
            </div>
          </div>

          <aside aria-label={t("storefront_services.coverage_rail_label")} className="flex min-w-0 flex-col gap-4">
            {offerHref && (
              <div className="rounded-card border border-line bg-card p-5">
                <h2 className="text-body font-medium text-ink">{t("storefront_services.coverage_offer_title")}</h2>
                <p className="mt-2 text-body-sm text-body">
                  {t("storefront_services.coverage_offer_body")}
                  {offer && missing
                    ? ` ${t("storefront_services.coverage_offer_count", {
                        count: offer.firms,
                        formatted: formatCount(offer.firms),
                        emirate: t(`emirate.${offer.emirate}` as never),
                        service: missing.service.name,
                      })}`
                    : ""}
                </p>
                <Link
                  href={offerHref}
                  rel={crawlRel(offerHref)}
                  className={`${buttonClassName({ block: true })} mt-4`}
                >
                  {t("storefront.request_quote")}
                </Link>
              </div>
            )}

            <p className="rounded-card border border-line bg-paper-sunk p-5 text-body-sm text-body">
              {t("storefront_services.coverage_hours_note")}
            </p>
          </aside>
        </div>
      </div>
    </PublicShell>
  );
}

/** A named region, so each of the three reads as its own landmark — once per page. */
function InfoCard({ id, eyebrow, children }: { id: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-card border border-line bg-card p-5">
      <h3 id={id} className="font-mono text-eyebrow uppercase text-muted">
        {eyebrow}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** One service, as its row reads: places worded, free zones qualified, `How` worded. */
function wordRow(
  row: { service: { slug: string; name: string; rows: { key: string; value: string | null }[] }; places: CoveragePlace[] },
  freeZones: readonly { emirate: string; name: string }[],
): CoverageTableRow {
  const delivered = row.service.rows.find((entry) => entry.key === "delivered_where")?.value ?? null;
  const zones = rowQualifiers(row.places, freeZones);
  return {
    slug: row.service.slug,
    name: row.service.name,
    where:
      row.places.length === 0
        ? t("storefront_services.not_stated")
        : coversEveryEmirate(row.places)
          ? t("storefront_services.coverage_all_seven")
          : formatList(row.places.map((place) => place.label)),
    qualifier: zones.length > 0 ? t("storefront_services.coverage_registered_in", { zones: formatList(zones) }) : null,
    how: delivered === null ? null : scopeWords("delivered_where", delivered),
  };
}
