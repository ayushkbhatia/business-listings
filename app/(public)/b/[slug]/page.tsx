import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button } from "@/components/primitives";
import { Breadcrumb, Card, KeyValuePanel, Panel, PublicShell } from "@/components/structure";
import { Tag } from "@/components/display";
import { ListingCard, ProductCard, VerificationLadder, tierSpec } from "@/components/domain";
import {
  getBusinessBySlug,
  getBusinessProducts,
  getSimilarClaimedBusinesses,
  getSpecTemplate,
} from "@/lib/db/queries";
import { formatCount, formatDate, formatDuration, maskTRN } from "@/lib/format";
import { t } from "@/lib/i18n";
import { primarySize } from "@/lib/spec";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { StorefrontHeader, storefrontCrumbs } from "./_storefront";
import { ContactCard } from "./ContactCard";
import { EnquireButton } from "./EnquireDrawer";
import { EMIRATES } from "@/lib/uae";
import { getActor } from "@/lib/auth/session";

export const revalidate = 300;

interface Params {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return {};

  const head = business.locations[0];
  const area = head?.area.name ?? "";
  const emirate = head ? t(`emirate.${head.emirate}` as never) : "";
  const unclaimed = business.claimStatus === "unclaimed";

  const description = unclaimed
    ? t("seo.unclaimed_description", {
        name: business.displayName,
        authority: business.licenceAuthority,
        area,
        emirate,
      })
    : t("seo.business_description", {
        name: business.displayName,
        category: business.primaryCategory.name,
        area,
        emirate,
        verification: t(tierSpec(business.verificationTier).checkedKey as never) + ".",
      });

  return {
    title: `${business.displayName} — ${business.primaryCategory.name}`,
    description,
    alternates: { canonical: `/b/${slug}` },
    openGraph: {
      title: business.displayName,
      description,
      type: "website",
      url: `/b/${slug}`,
    },
    // An unclaimed page is thin by nature and honest about it. It stays
    // indexable — 30,000 of them are how a supplier first finds us — but it
    // never claims a rating it does not have.
    robots: unclaimed ? { index: true, follow: true } : undefined,
  };
}

export default async function StorefrontPage({ params }: Params) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();

  return business.claimStatus === "unclaimed" ? (
    <UnclaimedStorefront business={business} />
  ) : (
    <ClaimedStorefront business={business} />
  );
}

type Business = NonNullable<Awaited<ReturnType<typeof getBusinessBySlug>>>;

// ─────────────────────────────────────────────────────────────────────────────
// Board 1d — the claimed composition
// ─────────────────────────────────────────────────────────────────────────────

async function ClaimedStorefront({ business }: { business: Business }) {
  // Only to decide whether the composer asks for a phone number. A buyer with
  // no account can still send one — that is the point of the provisional
  // identity — they just have to say where the quotes should go.
  const actor = await getActor();
  const [products, template] = await Promise.all([
    getBusinessProducts(business.id, { take: 4 }),
    getSpecTemplate(business.primaryCategoryId),
  ]);
  const fields = template?.fields ?? [];
  const head = business.locations[0];
  const crumbs = storefrontCrumbs(business);

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          name: business.displayName,
          description: business.description ?? undefined,
          identifier: business.licenceNumber,
          foundingDate: business.establishedYear ? String(business.establishedYear) : undefined,
          address: head
            ? {
                "@type": "PostalAddress",
                streetAddress: head.addressLine,
                addressLocality: head.area.name,
                addressRegion: t(`emirate.${head.emirate}` as never),
                addressCountry: "AE",
              }
            : undefined,
          geo:
            head?.lat != null && head.lng != null
              ? { "@type": "GeoCoordinates", latitude: head.lat, longitude: head.lng }
              : undefined,
          // aggregateRating only when reviews exist. A rating object with a zero
          // count is a rich result built on nothing.
          aggregateRating:
            business._count.reviews > 0 && business.ratingOverall
              ? {
                  "@type": "AggregateRating",
                  ratingValue: business.ratingOverall,
                  reviewCount: business._count.reviews,
                  bestRating: 5,
                  worstRating: 1,
                }
              : undefined,
        }}
      />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: crumbs.map((crumb, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: crumb.label,
            item: crumb.href,
          })),
        }}
      />

      {/*
        The seller theme scopes here and nowhere above it. It recolours the
        heading, links and buttons inside; the verification badge is drawn from
        the status palette and is unaffected by design.
      */}
      <div data-theme={business.themePreset ?? "default"}>
        <StorefrontHeader business={business} active="overview" />

        <div className="mt-6 grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            {business.description && (
              <section>
                <h2 className="text-h2 text-brand-ink">{t("storefront.about")}</h2>
                <p className="mt-2 max-w-[var(--measure-prose)] text-prose text-prose">
                  {business.description}
                </p>
              </section>
            )}

            <section className="mt-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-h2 text-brand-ink">{t("storefront.catalogue")}</h2>
                {business._count.products > products.length && (
                  <a
                    href={`/b/${business.slug}/products`}
                    className="rounded-tag text-caption text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {t("storefront.view_all_products", {
                      count: formatCount(business._count.products),
                    })}
                  </a>
                )}
              </div>

              {products.length === 0 ? (
                <p className="mt-2 text-body-sm text-muted">{t("storefront.catalogue_empty")}</p>
              ) : (
                <div className="mt-3 grid gap-[var(--gutter)] sm:grid-cols-2">
                  {products.map((product) => (
                    <ProductCard
                      enquireHref={`/rfq/new?to=${business.slug}`}
                      key={product.id}
                      product={{
                        slug: product.slug,
                        businessSlug: business.slug,
                        name: product.name,
                        sku: product.sku,
                        availability: product.availability,
                        stockQty: product.stockQty,
                        leadTimeDays: product.leadTimeDays,
                        minOrderQty: product.minOrderQty,
                        sizeLabel: primarySize(fields, product.specValues),
                      }}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="mt-6">
              <h2 className="text-h2 text-brand-ink">{t("verify.ladder")}</h2>
              <div className="mt-2">
                <VerificationLadder
                  label={t("verify.ladder")}
                  reachedLabel={t("verify.reached")}
                  current={business.verificationTier}
                  rungs={[1, 2, 3, 4].map((tier) => ({
                    tier,
                    label: t(tierSpec(tier).labelKey as never),
                    requirement: t(`verify.requirement.t${tier}` as never),
                    date:
                      tier <= business.verificationTier
                        ? tier >= 3
                          ? business.visitedAt
                            ? formatDate(business.visitedAt)
                            : undefined
                          : business.verifiedAt
                            ? formatDate(business.verifiedAt)
                            : undefined
                        : undefined,
                  }))}
                />
              </div>
            </section>
          </div>

          <aside className="min-w-0">
            <Card>
              <h2 className="text-h3 text-brand-ink">{t("storefront.at_a_glance")}</h2>
              <div className="mt-2">
                <KeyValuePanel
                  columns={1}
                  notProvidedLabel={t("table.not_provided")}
                  entries={[
                    {
                      key: "licence",
                      label: t("storefront.licence"),
                      value: business.licenceNumber,
                      mono: true,
                    },
                    {
                      key: "authority",
                      label: t("storefront.authority"),
                      value: business.licenceAuthority,
                    },
                    {
                      key: "trn",
                      label: t("trade.trn"),
                      // Masked on every surface except the seller's own.
                      value: business.trn ? maskTRN(business.trn) : undefined,
                      mono: true,
                    },
                    {
                      key: "established",
                      label: t("storefront.established"),
                      value: business.establishedYear ?? undefined,
                    },
                    {
                      key: "team",
                      label: t("storefront.team"),
                      value: business.teamSize
                        ? t(`storefront.team_band.${business.teamSize}` as never)
                        : undefined,
                    },
                    {
                      key: "languages",
                      label: t("storefront.languages"),
                      value: business.languages.length > 0 ? business.languages.join(", ") : undefined,
                    },
                  ]}
                />
              </div>

              {business.categories.length > 0 && (
                <div className="mt-3">
                  <p className="text-caption text-muted">{t("storefront.categories")}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {business.categories.map((link) => (
                      <Tag key={link.categoryId} size="sm" href={`/c/${link.category.slug}`}>
                        {link.category.name}
                      </Tag>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            {/*
              Masking is not a growth trick — the reveal is the event that
              proves the platform delivered the enquiry, and it is what a
              seller's subscription is ultimately judged on.
            */}
            <div className="mt-3">
              <ContactCard
                businessId={business.id}
                businessSlug={business.slug}
                phone={head?.phone ?? null}
                whatsapp={head?.whatsapp ?? null}
                enquire={
                  <EnquireButton
                    block
                    businessId={business.id}
                    businessSlug={business.slug}
                    displayName={business.displayName}
                    categoryId={business.primaryCategoryId}
                    emirates={EMIRATES}
                    signedIn={Boolean(actor)}
                    triggerLabel={t("product.enquire")}
                    recipient={{
                      businessId: business.id,
                      displayName: business.displayName,
                      areaName: head?.area?.name ?? null,
                      verificationTier: business.verificationTier,
                      responseLabel:
                        business.responseTimeMedianMs === null
                          ? t("response.unmeasured")
                          : t("response.median", {
                              duration: formatDuration(business.responseTimeMedianMs),
                            }),
                      pinned: true,
                    }}
                  />
                }
              />
            </div>
          </aside>
        </div>
      </div>
    </PublicShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Board 10g — the unclaimed composition. Same route, no second page component.
// ─────────────────────────────────────────────────────────────────────────────

async function UnclaimedStorefront({ business }: { business: Business }) {
  const head = business.locations[0];
  const similar = await getSimilarClaimedBusinesses(
    { id: business.primaryCategoryId, parentId: business.primaryCategory.parentId },
    business.id,
    head?.emirate ?? null,
    2,
  );
  const crumbs = storefrontCrumbs(business);

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
      {/*
        LocalBusiness with no aggregateRating, no opening hours and no telephone.
        Only what the licence record actually holds. Marking up hours we do not
        have would be a lie in a machine-readable format, which is the worst
        kind.
      */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          name: business.tradeName,
          identifier: business.licenceNumber,
          address: head
            ? {
                "@type": "PostalAddress",
                addressLocality: head.area.name,
                addressRegion: t(`emirate.${head.emirate}` as never),
                addressCountry: "AE",
              }
            : undefined,
        }}
      />

      <header className="border-b border-line pb-5">
        <p className="font-mono text-eyebrow uppercase text-faint">
          {business.primaryCategory.name}
        </p>
        <h1 className="mt-0.5 font-serif text-h1-serif text-ink">{business.tradeName}</h1>
        {head && (
          <p className="mt-1 text-body-sm text-muted">
            {head.area.name} · {t(`emirate.${head.emirate}` as never)}
          </p>
        )}
      </header>

      <div className="mt-5 grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <Panel title={t("listing.unclaimed_title")}>
            <p className="max-w-[var(--measure-prose)] text-prose text-prose">
              {t("listing.unclaimed_body")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button disabled title={t("enquiry.disabled")}>
                {t("listing.claim_cta")}
              </Button>
              <Button variant="link" disabled title={t("enquiry.disabled")}>
                {t("listing.report")}
              </Button>
            </div>
          </Panel>

          <section className="mt-5">
            <h2 className="text-h2 text-ink">{t("storefront.at_a_glance")}</h2>
            <div className="mt-2">
              {/*
                Only the licence record. Absent fields are marked absent rather
                than dropped — and there is no rating, no review count, no
                hours and no empty star row anywhere on this page.
              */}
              <KeyValuePanel
                notProvidedLabel={t("table.not_provided")}
                entries={[
                  { key: "trade", label: t("storefront.about"), value: business.tradeName },
                  { key: "licence", label: t("storefront.licence"), value: business.licenceNumber, mono: true },
                  { key: "authority", label: t("storefront.authority"), value: business.licenceAuthority },
                  { key: "expiry", label: t("listing.licence_expiry"), value: formatDate(business.licenceExpiry) },
                  { key: "area", label: t("trade.emirate"), value: head ? `${head.area.name}, ${t(`emirate.${head.emirate}` as never)}` : undefined },
                  { key: "category", label: t("storefront.categories"), value: business.primaryCategory.name },
                  { key: "established", label: t("storefront.established") },
                  { key: "team", label: t("storefront.team") },
                  { key: "languages", label: t("storefront.languages") },
                  { key: "phone", label: t("storefront.phone") },
                ]}
              />
            </div>
          </section>
        </div>

        <aside className="min-w-0">
          {similar.businesses.length > 0 && (
            <Card padded={false}>
              <div className="border-b border-line px-4 py-3">
                <h2 className="text-h3 text-ink">{t(`listing.similar.${similar.basis}` as never)}</h2>
              </div>
              <div className="flex flex-col gap-2 p-3">
                {similar.businesses.map((other) => (
                  <ListingCard
                    enquireHref={`/rfq/new?to=${other.slug}`}
                    key={other.id}
                    context="map"
                    business={{
                      slug: other.slug,
                      displayName: other.displayName,
                      categoryName: other.primaryCategory.name,
                      categoryCode: other.primaryCategory.code,
                      areaName: other.locations[0]?.area.name ?? "",
                      emirateName: other.locations[0]
                        ? t(`emirate.${other.locations[0].emirate}` as never)
                        : "",
                      verificationTier: other.verificationTier,
                      verifiedAt: other.verifiedAt,
                      visitedAt: other.visitedAt,
                      responseTimeMedianMs: other.responseTimeMedianMs,
                      responseDurationLabel: other.responseTimeMedianMs
                        ? formatDuration(other.responseTimeMedianMs)
                        : undefined,
                      reviewCount: other.reviewCount,
                    }}
                  />
                ))}
              </div>
            </Card>
          )}
        </aside>
      </div>
    </PublicShell>
  );
}
