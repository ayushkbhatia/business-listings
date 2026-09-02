import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { getCategoryBySlug } from "@/lib/db/queries";
import { categoryIdsFor } from "@/lib/db/queries";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { parseSearchQuery } from "@/lib/search/query";
import { emirateCategoryState, emiratePagePath, MATRIX_EMIRATES } from "@/lib/seo/emirate";
import { landingFacts } from "@/lib/seo/facts";
import { faqJsonLd, landingFaq } from "@/lib/seo/faq";
import { absoluteUrl } from "@/lib/site";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { Results } from "@/app/(public)/_results/Results";
import { Faq, Prose } from "@/app/(public)/_landing/Blocks";

/**
 * `/:emirate/:category` — one trade across one emirate.
 *
 * The eighty-four pages board 6c's matrix counts. They did not exist before
 * this: `AreaPage` is keyed on (area, category), and an area is "Al Quoz
 * Industrial 1" rather than Dubai, so every cell in that matrix pointed at
 * nothing. Without these the matrix is a table of numbers, and the category
 * index stops being the crawlable spine it is for.
 *
 * Two segments, and deliberately not three. `/:emirate/:area/:category` is the
 * area page and stays exactly as it was; Next matches on segment count, so the
 * two never collide and neither shadows the other.
 *
 * ## Why the second segment is called `area`
 *
 * Next refuses two different slug names at the same position — a sibling
 * `[emirate]/[category]` next to `[emirate]/[area]` throws "You cannot use
 * different slug names for the same dynamic path" on the first request. It
 * builds cleanly and fails at runtime, which is a trap worth naming.
 *
 * So the folder reuses the name already established one level down, and this
 * route reads it as a sector slug. The URL is unaffected —
 * `/dubai/hvac-and-ventilation` either way — and if an area index page is ever
 * wanted at this depth it belongs in this same file, choosing on what the slug
 * resolves to.
 *
 * ## Indexable is not the same as reachable
 *
 * A buyer following a link to a thin page should see what there is; a crawler
 * should not be told to index it. So this route renders whatever supply exists
 * and lets `robots` carry the decision, exactly as the subcategory route does.
 * `emirateCategoryState` is the single place that decides, and the matrix, this
 * page's robots tag and `sitemap.ts` all read it — which is what makes the set
 * of links on /categories equal the set of URLs in the sitemap rather than
 * approximately equal.
 */

export const revalidate = 300;

interface Props {
  /** `area` is the router's name for this segment; the value is a sector slug. */
  params: Promise<{ emirate: string; area: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function isEmirate(value: string): boolean {
  return (MATRIX_EMIRATES as readonly string[]).includes(value);
}

async function resolve(params: { emirate: string; area: string }) {
  if (!isEmirate(params.emirate)) return null;

  const category = await getCategoryBySlug(params.area);
  /*
     Top-level sectors only. A subcategory in an emirate would be a fourth page
     type nobody specified, and it would compete with the sector's own page for
     the same query — `/dubai/hvac-and-ventilation` and
     `/dubai/ducting` are the same intent at two depths.
  */
  if (!category || category.parentId !== null) return null;

  const state = await emirateCategoryState(params.emirate, category.id);
  if (!state) return null;

  return { category, state };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolved = await resolve(await params);
  if (!resolved) return {};

  const { category, state } = resolved;
  const emirateName = t(`emirate.${resolved.state.emirate}` as never);

  return {
    title: t("emirate_page.title", { category: category.name, emirate: emirateName }),
    description: t("emirate_page.description", {
      count: formatCount(state.listings),
      category: category.name.toLowerCase(),
      emirate: emirateName,
    }),
    alternates: { canonical: absoluteUrl(emiratePagePath(state.emirate, category.slug)) },
    // The floors, said to a crawler. Below them the page still serves — a
    // buyer who followed a link should see what there is — but it is not one
    // we ask anybody to index.
    robots: state.live ? undefined : { index: false, follow: true },
  };
}

export default async function EmirateCategoryPage({ params, searchParams }: Props) {
  const resolved = await resolve(await params);
  if (!resolved) notFound();

  const { category, state } = resolved;
  const emirateName = t(`emirate.${state.emirate}` as never);
  const subject = t("emirate_page.subject", { category: category.name, emirate: emirateName });

  const categoryIds = categoryIdsFor(category);
  const facts = await landingFacts({ categoryIds, emirate: state.emirate });
  const faq = landingFaq({ subject }, facts);

  const sp = await searchParams;
  // The emirate is fixed by the route, so it is not a facet the buyer can drop.
  const query = parseSearchQuery({ ...sp, emirate: state.emirate });

  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: t("categories.title"), href: "/categories" },
    { label: subject },
  ];

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
            ...(crumb.href ? { item: absoluteUrl(crumb.href) } : {}),
          })),
        }}
      />
      {faq.length > 0 && <JsonLd data={faqJsonLd(faq)} />}

      <header className="border-b border-line pb-5">
        <h1 className="font-serif text-h1-serif text-ink">{subject}</h1>
        <p className="mt-2.5 max-w-[var(--measure-prose)] text-prose text-prose">
          {t("emirate_page.lede", {
            count: formatCount(facts.listings),
            verified: formatCount(facts.verified),
            emirate: emirateName,
          })}
        </p>
      </header>

      {/*
         This page's own paragraph, from its `EmiratePage` row — not the
         sector's, which seven emirates would have shared. It is the third
         publish gate, so where it is missing the page is already not indexable
         and there is nothing to render.
      */}
      {state.intro && (
        <div className="mt-6">
          <Prose text={state.intro} />
        </div>
      )}

      <div className="mt-7">
        <Results query={query} basePath={emiratePagePath(state.emirate, category.slug)} />
      </div>

      {faq.length > 0 && (
        <div className="mt-8">
          <Faq items={faq} />
        </div>
      )}
    </PublicShell>
  );
}
