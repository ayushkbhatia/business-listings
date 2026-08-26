import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { redirectIfMoved, absorbedInto } from "@/lib/listing/redirect";
import { Button } from "@/components/primitives";
import { Breadcrumb, Card, KeyValuePanel, Panel, PublicShell } from "@/components/structure";
import { Tag } from "@/components/display";
import { ListingCard, VerificationLadder, tierSpec } from "@/components/domain";
import { getBusinessBySlug, getSimilarClaimedBusinesses } from "@/lib/db/queries";
import { formatDate, formatDuration, maskTRN } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { StorefrontHeader, storefrontCrumbs } from "./_storefront";
import { renderSection } from "@/components/storefront";
import { storefrontPlan } from "@/lib/storefront/loader";
import { ContactCard } from "./ContactCard";
import { EnquireButton } from "./EnquireDrawer";
import { EMIRATES } from "@/lib/uae";
import { getActor } from "@/lib/auth/session";
import { navPages } from "@/lib/storefront/pages";

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
  if (!business) {
    /*
     * Before the 404, the two ways a listing legitimately moves: a rename wrote
     * a redirect, or a merge absorbed it. Both have been writing rows nothing
     * read since handoff 0.
     */
    await redirectIfMoved(`/b/${slug}`);
    notFound();
  }

  const movedTo = await absorbedInto(slug);
  if (movedTo) permanentRedirect(`/b/${movedTo}`);

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
  const plan = await storefrontPlan({
    id: business.id,
    slug: business.slug,
    sectorId: business.sectorId,
    themePreset: business.themePreset,
  });
  /*
   * Still needed here for the structured data, which describes the business
   * rather than the page. Schema.org wants a postal address whether or not a
   * template happens to enable the branches section.
   */
  const head = business.locations[0];
  const crumbs = storefrontCrumbs(business);

  // Template pages marked for the nav. Empty where the trade has no template.

  const pages = business.sectorId ? await navPages(business.sectorId) : [];


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
        Rendered from the sector's storefront template, not from this file.
        Until now these sections were a fixed sequence of JSX here, which made
        criterion 2 — "reordering, enabling or disabling a section changes every
        live storefront on that template and nothing else" — a statement about a
        function no route called.

        The seller theme scopes here and nowhere above it. It recolours the
        heading, links and buttons inside; the verification badge is drawn from
        the status palette and is unaffected by design.
      */}
      <div data-theme={plan.theme}>
        <StorefrontHeader business={business} active="overview" pages={pages} />

        <div className="mt-6 grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-8">
            {plan.sections
              /*
                The header section is chrome and `StorefrontHeader` already drew
                it. Rendering both would put the trade name on the page twice.
              */
              .filter((section) => section.type !== "header")
              .map((section) => (
                <div key={section.id}>
                  {renderSection({
                    section,
                    data: plan.data,
                    content: plan.content[section.id] ?? {},
                    enquireHref: `/rfq/new?to=${business.slug}`,
                  })}
                </div>
              ))}
          </div>

          {/*
            The aside is chrome, not a section, and that is not a shortcut.

            It carries the licence number, the authority, the masked TRN and the
            verification ladder — platform-owned facts. Non-negotiable 2 says
            trust signals render identically on every storefront, which is an
            argument that a template must not be able to reorder them, restyle
            them or switch them off. A sector whose template dropped the licence
            panel would be a sector where we quietly stopped showing what we
            checked.

            The contact card sits here for the same reason: the reveal is the
            event that proves the platform delivered the enquiry, and it is not
            a seller's to compose away.
          */}

          <aside className="min-w-0">
            {/*
              The ladder, moved out of the main column and into chrome.

              It was a section of hardcoded JSX beside the catalogue. It is the
              clearest statement the platform makes about what it checked and
              what it has not, and it renders identically on every storefront
              for the same reason the badge does — so it is not a section a
              template may reorder or switch off.
            */}
            <Card>
              <h2 className="text-h3 text-brand-ink">{t("verify.ladder")}</h2>
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
            </Card>

            <div className="mt-3">
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
            </div>

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
