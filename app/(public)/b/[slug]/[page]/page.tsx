import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { PageBlocks } from "@/components/storefront";
import { getBusinessBySlug } from "@/lib/db/queries";
import { redirectIfMoved, absorbedInto } from "@/lib/listing/redirect";
import { livePage } from "@/lib/storefront/pages";
import { storefrontPlan } from "@/lib/storefront/loader";
import { t } from "@/lib/i18n";
import { navPages } from "@/lib/storefront/pages";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { StorefrontHeader, storefrontCrumbs } from "../_storefront";

/**
 * A template page on a storefront — board 5d, rendered.
 *
 * Authored once per sector and served under every storefront in it. This is the
 * route that makes the editor worth having: without it, `TemplatePage` would be
 * another table staff can fill and nobody can read.
 *
 * The dynamic segment sits below the static ones — `products`, `branches`,
 * `reviews`, `p`, `d` — and Next resolves those first, which is why the service
 * refuses a page slug that would collide with one. A page at `products` would
 * silently never render rather than shadowing the catalogue.
 */

export const revalidate = 300;

interface Params {
  params: Promise<{ slug: string; page: string }>;
}

async function load(slug: string, pageSlug: string) {
  const business = await getBusinessBySlug(slug);
  if (!business?.sectorId) return null;
  const page = await livePage(business.sectorId, pageSlug);
  if (!page) return null;
  return { business, page };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, page: pageSlug } = await params;
  const found = await load(slug, pageSlug);
  if (!found) return {};

  return {
    title: `${found.page.title} — ${found.business.displayName}`,
    ...(found.page.metaDescription ? { description: found.page.metaDescription } : {}),
    // Staff can keep a page out of search without unpublishing it. Thin pages
    // at scale are the risk board 5d's content check exists for.
    ...(found.page.allowIndexing ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function TemplatePageRoute({ params }: Params) {
  const { slug, page: pageSlug } = await params;

  /*
   * One lookup, for two kinds of move.
   *
   * `Redirect` is keyed by path, and both things that move a page write into
   * it: a merged listing whose whole storefront moved, and a renamed page that
   * left a 301 per store behind it — criterion 9. `redirectIfMoved` redirects
   * internally rather than returning, so there is nothing to test here.
   */
  await redirectIfMoved(`/b/${slug}/${pageSlug}`);

  const found = await load(slug, pageSlug);
  if (!found) {
    const absorbed = await absorbedInto(slug);
    if (absorbed) permanentRedirect(`/b/${absorbed}/${pageSlug}`);
    notFound();
  }

  const { business, page } = found;
  const plan = await storefrontPlan({
    id: business.id,
    slug: business.slug,
    sectorId: business.sectorId,
    themePreset: business.themePreset,
  });

  // Template pages marked for the nav. Empty where the trade has no template.

  const pages = business.sectorId ? await navPages(business.sectorId) : [];


  return (
    <PublicShell
      bleed
      nav={<DirectoryNav />}
      breadcrumb={
        <Breadcrumb
          label={t("gallery.breadcrumb_label")}
          items={storefrontCrumbs(business, page.title)}
        />
      }
      footer={<DirectoryFooter />}
    >
      <div data-theme={plan.theme}>
        <StorefrontHeader business={business} active="overview" pages={pages} />

        <article className="mx-auto mt-6 max-w-3xl px-5 pb-[var(--section-pad)]">
          {/*
            An h2, not an h1. `StorefrontHeader` carries the h1 on every
            storefront route and it is the business name — two h1s is two
            answers to "what is this page about", and the other sub-pages
            already follow this. The page title reaches search through the
            document title rather than through a second top-level heading.
          */}
          <h2 className="text-h1-serif font-serif text-brand-ink">{page.title}</h2>
          <div className="mt-6">
            <PageBlocks
              blocks={page.blocks}
              documents={plan.data.documents}
              catalogueHref={`/b/${business.slug}/products`}
              enquireHref={`/rfq/new?to=${business.slug}`}
            />
          </div>
        </article>
      </div>
    </PublicShell>
  );
}
