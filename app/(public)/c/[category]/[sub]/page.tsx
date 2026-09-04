import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { countResults, getCategoryBySlug, getSpecFacets } from "@/lib/db/queries";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { canonicalFor, isFiltered } from "@/lib/seo/canonical";
import { parseSearchQuery, trayParams } from "@/lib/search/query";
import { landingFacts } from "@/lib/seo/facts";
import { faqJsonLd, landingFaq } from "@/lib/seo/faq";
import { isCategoryPublishable } from "@/lib/seo/taxonomy";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { Results } from "@/app/(public)/_results/Results";
import { EmirateBreakdown, Faq, RelatedTrades, SpecChips } from "@/app/(public)/_landing/Blocks";

/**
 * Board 10a — the subcategory landing page.
 *
 * 418 of these, so it has to scale further than any other template: everything
 * on it beyond the intro paragraph is derived, and adding a subcategory adds a
 * page with no code change anywhere. That is criterion 2, and this route is
 * where it is provable.
 *
 * The parts the SEO layer adds over the handoff-1 page: suppliers grouped by
 * emirate, filter chips from the trade's own specification template, an FAQ
 * whose answers are assembled from platform counts, and — the important
 * negative — `noindex` when the page does not clear the board 6f floors.
 */

export const revalidate = 300;

interface Props {
  params: Promise<{ category: string; sub: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { category: parentSlug, sub } = await params;
  const category = await getCategoryBySlug(sub);
  if (!category) return {};

  const sp = await searchParams;
  const [count, publishable] = await Promise.all([
    countResults(parseSearchQuery({}), [category.id]),
    isCategoryPublishable(category.id),
  ]);

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
        basePath: `/c/${parentSlug}/${sub}`,
        categoryId: category.id,
        searchParams: sp,
      }),
    },
    /*
       A thin page is not a 404. Somebody following a link to it should see the
       suppliers there are — there simply are not enough of them for this to be
       a page worth putting in front of a stranger who searched. `follow` stays
       on, because the listings it links to are each worth indexing.

       `app/sitemap.ts` leaves the same page out, computed by the same function,
       which is what criterion 12 asks for.

       The second condition is the crawl fix, and it is a different argument
       from the first: a filtered view of this subcategory is `noindex` even
       when the subcategory itself is publishable. This route renders the same
       filter rail as `/c/:category`, so it addresses the same combinatorial
       URL space and needs the same answer.
    */
    ...(publishable && !isFiltered(sp) ? {} : { robots: { index: false, follow: true } }),
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
  // Rebuilt from the parsed query rather than from the raw search params. The
  // raw form carried anything a caller invented straight back into every tray
  // link — see `trayParams`.
  const search = trayParams(query, tray);

  const basePath = `/c/${parent.slug}/${category.slug}`;

  /*
     The unfiltered facts, deliberately.

     The block below the results describes the trade, not the current filter —
     a buyer who has narrowed to DN100 still wants to know how many suppliers
     the trade has and where they are. `Results` above it answers the filter.
  */
  const [facts, specGroups, siblingCounts] = await Promise.all([
    landingFacts({ categoryIds: [category.id] }),
    // Its own products, its parent's template. A subcategory rarely carries a
    // template of its own and the fields are the trade's, not the niche's.
    getSpecFacets([category.id], parseSearchQuery({}), [category.id, parent.id]),
    Promise.all(
      parent.children
        .filter((child) => child.id !== category.id)
        .map(async (child) => ({
          slug: child.slug,
          name: child.name,
          listings: await countResults(parseSearchQuery({}), [child.id]),
        })),
    ),
  ]);

  const faq = landingFaq({ subject: category.name }, facts);

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
      {/* Only the questions the page actually renders, so the markup and the
          page never disagree — which is the one thing Google penalises here. */}
      {faq.length > 0 && <JsonLd data={faqJsonLd(faq)} />}

      <header className="border-b border-line pb-4">
        <h1 className="font-serif text-h1-serif text-ink">
          {t("category.suppliers_in", { category: category.name })}
        </h1>
        {facts.listings > 0 && (
          <p className="mt-2 font-mono text-eyebrow uppercase text-faint">
            {t("landing.verified_share", {
              verified: formatCount(facts.verified),
              listings: formatCount(facts.listings),
            })}
          </p>
        )}
        {/* Board 6f, same as the parent. Written on the page matrix. */}
        {category.intro && (
          <p className="mt-4 max-w-[var(--measure-prose)] text-prose text-prose">
            {category.intro}
          </p>
        )}
      </header>

      <div className="mt-5">
        <Results
          query={query}
          basePath={basePath}
          tray={tray}
          search={search}
          category={{
            id: category.id,
            slug: category.slug,
            name: category.name,
            ids: [category.id],
            templateIds: [category.id, parent.id],
          }}
        />
      </div>

      <EmirateBreakdown rows={facts.emirates} basePath={basePath} />
      <SpecChips
        groups={specGroups.map((group) => ({
          key: group.key,
          label: group.label,
          options: group.options,
        }))}
        basePath={basePath}
      />
      <Faq items={faq} />
      <RelatedTrades parentName={parent.name} parentSlug={parent.slug} trades={siblingCounts} />
    </PublicShell>
  );
}
