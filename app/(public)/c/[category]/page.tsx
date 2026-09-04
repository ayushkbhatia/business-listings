import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb, PublicShell } from "@/components/structure";
import {
  categoryIdsFor,
  countResults,
  getBrowseStats,
  getCategoryBySlug,
  getSubcategoryChips,
} from "@/lib/db/queries";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { prisma } from "@/lib/db/client";
import { canonicalFor, robotsForFilteredView } from "@/lib/seo/canonical";
import { parseSearchQuery, trayParams } from "@/lib/search/query";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { Results } from "@/app/(public)/_results/Results";
import { BrowseHeader } from "@/app/(public)/_results/BrowseHeader";

export const revalidate = 300;

interface Props {
  params: Promise<{ category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { category: slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return {};
  const sp = await searchParams;
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
    /*
       Criterion 6. A filtered view canonicalises to the area page where one is
       live, and to this page otherwise — `/c/x?emirate=dubai` and the Al Quoz
       page answer the same query, and left alone they split the signal.
    */
    alternates: {
      canonical: await canonicalFor({
        basePath: `/c/${slug}`,
        categoryId: category.id,
        searchParams: sp,
      }),
    },
    /*
       A canonical on its own was never enough here.

       A filtered shelf is a view of this trade, not a page in its own right,
       and the sibling storefront tabs have said so with `noindex` since they
       shipped. This route said it with a canonical alone — which is a hint a
       crawler weighs against everything else it knows, not an instruction — so
       every one of the ~10^45 URLs the filter rail can address was indexable by
       default. `follow` stays on: the suppliers and products linked from the
       page are exactly what should be crawled onward from it.
    */
    ...robotsForFilteredView(sp),
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
  // Rebuilt from the parsed query rather than from the raw search params. The
  // raw form carried anything a caller invented straight back into every tray
  // link — see `trayParams`.
  const search = trayParams(query, tray);
  const ids = categoryIdsFor(category);

  const [stats, chips, area] = await Promise.all([
    getBrowseStats(query, ids),
    getSubcategoryChips(query, { id: category.id }),
    // Named for the heading only. The filter itself is already applied by slug.
    query.area
      ? prisma.area.findUnique({ where: { slug: query.area }, select: { name: true } })
      : Promise.resolve(null),
  ]);

  /*
     The heading names the scope, not the category.

     It is also the page title and the thing a buyer checks before trusting the
     list, so "in Dubai" and "in the UAE" have to be different sentences. An
     area narrows it one step further.
  */
  const emirateName = query.emirate ? t(`emirate.${query.emirate}` as never) : null;
  const areaName = area?.name ?? null;
  const heading = areaName && emirateName
    ? t("browse.heading_area", { category: category.name, area: areaName, emirate: emirateName })
    : emirateName
      ? t("browse.heading_emirate", { category: category.name, emirate: emirateName })
      : t("browse.heading_uae", { category: category.name });

  // The filters go with them. A buyer who narrowed to Dubai and DN100 is
  // sending an enquiry about Dubai and DN100, not about the whole trade.
  const enquireHref = `/rfq/new?category=${category.slug}${
    query.emirate ? `&emirate=${query.emirate}` : ""
  }`;

  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: t("categories.title"), href: "/categories" },
    { label: category.name },
  ];

  return (
    <PublicShell
      bleed
      nav={
        <DirectoryNav
          active="categories"
          scope={{
            action: `/c/${category.slug}`,
            // The two-letter mark and the emirate, which together are the
            // scope the results are already in.
            label: emirateName ? `${category.code} · ${emirateName}` : category.code,
            placeholder: t("browse.search_in", { category: category.name }),
          }}
        />
      }
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

      <BrowseHeader
        heading={heading}
        stats={stats}
        chips={chips}
        basePath={`/c/${category.slug}`}
        enquireHref={enquireHref}
        search={search}
      />

      {category.intro && (
        /*
           Board 6f. A category page with a heading and a grid of results is a
           page search engines have nothing to rank and a buyer has no reason to
           trust. Written by staff on the page matrix, where its word count is
           measured against the same floor that decides whether the page
           publishes at all.
        */
        <div className="mx-auto max-w-7xl px-5 pt-6">
          <p className="max-w-[var(--measure-prose)] text-prose text-prose">{category.intro}</p>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-5 py-6">
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
