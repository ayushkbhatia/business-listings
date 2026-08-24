import type { Metadata } from "next";
import { Button, SearchField } from "@/components/primitives";
import { Card, PublicShell } from "@/components/structure";
import { CategoryMark, StatCard } from "@/components/display";
import { ListingCard } from "@/components/domain";
import {
  getDirectoryStats,
  getEmirateCounts,
  getFeaturedBusinesses,
  getHomeCategories,
} from "@/lib/db/queries";
import { formatCount, formatDuration, formatPercent } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "./_chrome";
import { JsonLd } from "./_json-ld";

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const stats = await getDirectoryStats();
  return {
    title: "Business Listings — UAE trade directory",
    description: t("seo.home_description", {
      listings: formatCount(stats.listings),
      categories: stats.categories,
    }),
    alternates: { canonical: "/" },
  };
}

export default async function HomePage() {
  const [stats, categories, featured, emirates] = await Promise.all([
    getDirectoryStats(),
    getHomeCategories(),
    getFeaturedBusinesses(6),
    getEmirateCounts(),
  ]);

  return (
    <PublicShell
      nav={<DirectoryNav />}
      footer={<DirectoryFooter listingCount={stats.listings} />}
    >
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Business Listings",
          url: "/",
          potentialAction: {
            "@type": "SearchAction",
            target: { "@type": "EntryPoint", urlTemplate: "/search?q={search_term_string}" },
            "query-input": "required name=search_term_string",
          },
        }}
      />

      <section className="border-b border-line pb-[var(--section-pad)]">
        <h1 className="max-w-3xl font-serif text-display text-ink">{t("home.hero_title")}</h1>
        {/*
          Say the number. "218 suppliers in Al Quoz", never "many suppliers" —
          a directory that will not tell you how big it is has told you
          something.
        */}
        <p className="mt-3 max-w-[var(--measure-prose)] text-prose text-prose">
          {t("home.hero_body", {
            listings: formatCount(stats.listings),
            verified: formatCount(stats.verified),
          })}
        </p>

        <form action="/search" method="get" className="mt-5 flex max-w-2xl flex-wrap gap-2">
          {/*
            A real GET form. Search works before any JavaScript arrives, which
            is the state a buyer on a warehouse floor is most often in.
          */}
          <div className="min-w-0 flex-1">
            <SearchField
              size="lg"
              name="q"
              label={t("search.label")}
              clearLabel={t("search.clear")}
              placeholder={t("search.placeholder")}
            />
          </div>
          <Button size="lg" type="submit">
            {t("home.search_cta")}
          </Button>
        </form>
      </section>

      <section className="pt-[var(--section-pad)]">
        <h2 className="text-h2 text-ink">{t("home.browse_title")}</h2>
        <div className="mt-3 grid gap-[var(--gutter)] sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <a
              key={category.id}
              href={`/c/${category.slug}`}
              className="rounded-card focus-visible:outline-none focus-visible:shadow-focus"
            >
              <Card interactive>
                <div className="flex items-start gap-3">
                  <CategoryMark code={category.code} size="lg" />
                  <div className="min-w-0">
                    <h3 className="text-h3 text-ink">{category.name}</h3>
                    <p className="font-mono text-eyebrow tabular-nums text-muted">
                      {t("home.suppliers_in", { count: category._count.primaryFor })}
                    </p>
                  </div>
                </div>
              </Card>
            </a>
          ))}
        </div>
      </section>

      <section className="pt-[var(--section-pad)]">
        <h2 className="text-h2 text-ink">{t("home.verified_title")}</h2>
        <p className="mt-1 max-w-[var(--measure-prose)] text-body-sm text-muted">
          {t("home.verified_body")}
        </p>
        <div className="mt-3 grid gap-[var(--gutter)] lg:grid-cols-2">
          {featured.map((business) => (
            <ListingCard
              key={business.id}
              context="grid"
              business={{
                slug: business.slug,
                displayName: business.displayName,
                categoryName: business.primaryCategory.name,
                categoryCode: business.primaryCategory.code,
                areaName: business.locations[0]?.area.name ?? "",
                emirateName: business.locations[0]
                  ? t(`emirate.${business.locations[0].emirate}` as never)
                  : "",
                verificationTier: business.verificationTier,
                verifiedAt: business.verifiedAt,
                visitedAt: business.visitedAt,
                productCount: business._count.products,
                reviewCount: business.reviewCount,
                responseTimeMedianMs: business.responseTimeMedianMs,
                responseDurationLabel: business.responseTimeMedianMs
                  ? formatDuration(business.responseTimeMedianMs)
                  : undefined,
              }}
            />
          ))}
        </div>
      </section>

      <section className="pt-[var(--section-pad)]">
        <h2 className="text-h2 text-ink">{t("home.geography_title")}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {emirates.map((row) => (
            <a
              key={row.emirate}
              href={`/search?emirate=${row.emirate}`}
              className="inline-flex items-baseline gap-2 rounded-chip border border-line bg-card px-3 py-1.5 text-body-sm text-body transition-colors duration-120 ease-out hover:border-line-strong hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
            >
              {t(`emirate.${row.emirate}` as never)}
              <span className="font-mono text-eyebrow tabular-nums text-muted">
                {formatCount(row.count)}
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="pt-[var(--section-pad)]">
        <h2 className="sr-only">{t("home.stat_listings")}</h2>
        <div className="grid gap-[var(--gutter)] sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={t("home.stat_listings")} value={formatCount(stats.listings)} />
          <StatCard
            label={t("home.stat_verified")}
            value={formatCount(stats.verified)}
            caption={formatPercent(stats.listings ? stats.verified / stats.listings : 0)}
          />
          <StatCard label={t("home.stat_products")} value={formatCount(stats.products)} />
          <StatCard label={t("home.stat_categories")} value={formatCount(stats.categories)} />
        </div>
      </section>

      <section className="pt-[var(--section-pad)]">
        <h2 className="text-h2 text-ink">{t("home.how_title")}</h2>
        <ol className="mt-3 grid gap-[var(--gutter)] lg:grid-cols-3">
          {[1, 2, 3].map((step) => (
            <li key={step}>
              <Card>
                <p className="font-mono text-eyebrow tabular-nums text-faint">0{step}</p>
                <h3 className="mt-1 text-h3 text-ink">{t(`home.how_${step}_title` as never)}</h3>
                <p className="mt-1 text-body-sm text-body">{t(`home.how_${step}_body` as never)}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>
    </PublicShell>
  );
}
