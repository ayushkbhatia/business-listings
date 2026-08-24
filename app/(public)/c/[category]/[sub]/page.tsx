import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { countResults, getCategoryBySlug } from "@/lib/db/queries";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { parseSearchQuery } from "@/lib/search/query";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { Results } from "@/app/(public)/_results/Results";

export const revalidate = 300;

interface Props {
  params: Promise<{ category: string; sub: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sub } = await params;
  const category = await getCategoryBySlug(sub);
  if (!category) return {};
  const count = await countResults(parseSearchQuery({}), [category.id]);
  return {
    title: t("category.suppliers_in", { category: category.name }),
    description: t("seo.category_description", {
      count: formatCount(count),
      category: category.name.toLowerCase(),
    }),
    alternates: { canonical: `/c/${(await params).category}/${sub}` },
  };
}

export default async function SubcategoryPage({ params, searchParams }: Props) {
  const { category: parentSlug, sub } = await params;
  const [parent, category] = await Promise.all([
    getCategoryBySlug(parentSlug),
    getCategoryBySlug(sub),
  ]);
  // The subcategory has to actually belong to the parent in the URL, or two
  // routes address the same page and the canonical is a guess.
  if (!parent || !category || category.parentId !== parent.id) notFound();

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
  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: parent.name, href: `/c/${parent.slug}` },
    { label: category.name },
  ];

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
      </header>

      <div className="mt-5">
        <Results
          query={query}
          basePath={`/c/${parent.slug}/${category.slug}`}
          tray={tray}
          search={search}
          category={{ id: category.id, slug: category.slug, name: category.name, ids: [category.id] }}
        />
      </div>
    </PublicShell>
  );
}
