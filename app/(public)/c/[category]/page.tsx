import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { Tag } from "@/components/display";
import { categoryIdsFor, countResults, getCategoryBySlug } from "@/lib/db/queries";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { parseSearchQuery } from "@/lib/search/query";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { Results } from "@/app/(public)/_results/Results";

export const revalidate = 300;

interface Props {
  params: Promise<{ category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category: slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return {};
  const count = await countResults(
    parseSearchQuery({}),
    categoryIdsFor(category),
  );
  return {
    title: t("category.suppliers_in", { category: category.name }),
    description: t("seo.category_description", {
      count: formatCount(count),
      category: category.name.toLowerCase(),
    }),
    alternates: { canonical: `/c/${slug}` },
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { category: slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category || category.parentId) notFound();

  const sp = await searchParams;
  const query = parseSearchQuery(sp);
  // The comparison tray rides in the URL so adding a supplier is a navigation
  // and keeps every other facet intact — no client state, works without JS.
  const trayRaw = Array.isArray(sp.compare) ? (sp.compare[0] ?? "") : (sp.compare ?? "");
  const tray = trayRaw
    .split(",")
    .filter(Boolean)
    .slice(0, 4);
  const search = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      v === undefined ? [] : [[k, Array.isArray(v) ? v.join(",") : v] as [string, string]],
    ),
  ).toString();
  const ids = categoryIdsFor(category);
  const crumbs = [{ label: t("chrome.directory"), href: "/" }, { label: category.name }];

  return (
    <PublicShell
      nav={<DirectoryNav />}
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
        <h1 className="font-serif text-h1-serif text-ink">
          {t("category.suppliers_in", { category: category.name })}
        </h1>
        {category.children.length > 0 && (
          <div className="mt-3">
            <p className="font-mono text-eyebrow uppercase text-faint">
              {t("category.subcategories")}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {category.children.map((child) => (
                <Tag key={child.id} href={`/c/${category.slug}/${child.slug}`}>
                  {child.name}
                </Tag>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="mt-5">
        <Results
          query={query}
          basePath={`/c/${category.slug}`}
          tray={tray}
          search={search}
          category={{ id: category.id, slug: category.slug, name: category.name, ids }}
        />
      </div>
    </PublicShell>
  );
}
