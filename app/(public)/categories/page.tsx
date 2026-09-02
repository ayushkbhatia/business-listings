import type { Metadata } from "next";
import Link from "next/link";
import { Tag } from "@/components/display";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { categoryIndex } from "@/lib/seo/taxonomy";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";

/**
 * Board 6c — the category index.
 *
 * Every trade and every subcategory, with its real size beside it. Pure data:
 * criterion 2 says adding a subcategory must need no code change, and this page
 * is the first place that would break if one did — there is no list of names
 * anywhere in it.
 *
 * A subcategory below the board 6f floors is still listed and still linked. It
 * is a page a buyer may want; it is simply not one we ask search engines to
 * index, and the chip says so rather than the link quietly disappearing.
 */

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const sectors = await categoryIndex();
  const listings = sectors.reduce((total, sector) => total + sector.listings, 0);
  const verified = sectors.reduce((total, sector) => total + sector.verified, 0);

  return {
    title: t("categories.title"),
    description: t("categories.lede", {
      categories: formatCount(sectors.length),
      listings: formatCount(listings),
      verified: formatCount(verified),
    }),
    alternates: { canonical: "/categories" },
  };
}

export default async function CategoriesPage() {
  const sectors = await categoryIndex();
  const listings = sectors.reduce((total, sector) => total + sector.listings, 0);
  const verified = sectors.reduce((total, sector) => total + sector.verified, 0);
  const crumbs = [{ label: t("chrome.directory"), href: "/" }, { label: t("categories.title") }];

  return (
    <PublicShell
      nav={<DirectoryNav active="categories" />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
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

      <header className="border-b border-line pb-4">
        <h1 className="font-serif text-h1-serif text-ink">{t("categories.title")}</h1>
        <p className="mt-3 max-w-[var(--measure-prose)] text-prose text-prose">
          {t("categories.lede", {
            categories: formatCount(sectors.length),
            listings: formatCount(listings),
            verified: formatCount(verified),
          })}
        </p>
      </header>

      {sectors.length === 0 ? (
        <p className="mt-5 text-body-sm text-muted">{t("categories.empty")}</p>
      ) : (
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          {sectors.map((sector) => (
            <section key={sector.id} className="rounded-card border border-line bg-card px-5 py-4">
              <h2 className="text-h3 text-ink">
                <Link
                  href={`/c/${sector.slug}`}
                  className="rounded-tag underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {sector.name}
                </Link>
              </h2>
              <p className="mt-1 text-caption text-muted">
                {t("categories.listings", { count: sector.listings })}
                {sector.children.length > 0 && (
                  <> · {t("categories.subcategories", { count: sector.children.length })}</>
                )}
              </p>

              {sector.children.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {sector.children.map((trade) => (
                    <li key={trade.id}>
                      <Tag href={`/c/${sector.slug}/${trade.slug}`}>
                        {trade.name} ({formatCount(trade.listings)})
                      </Tag>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </PublicShell>
  );
}
