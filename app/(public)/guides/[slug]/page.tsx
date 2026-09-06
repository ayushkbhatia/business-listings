import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { formatDate } from "@/lib/format";
import { MIN_HEADINGS_FOR_CONTENTS } from "@/lib/guides/blocks";
import { guideBySlug, publishedGuides, verifiedSellerCount } from "@/lib/guides/queries";
import { t } from "@/lib/i18n";
import { absoluteUrl } from "@/lib/site";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { GuideBody } from "../_Article";
import { Contents, ContentsDisclosure } from "./Contents";
import { RelatedGuides, WhyWeWrite } from "./Rail";

/**
 * Board 6d — a guide article.
 *
 * `Article` structured data and a working directory call to action are the
 * step 1 checkpoint. Both are here; neither is decorative. The structured data
 * is what makes the article eligible for anything beyond a blue link, and the
 * call to action is the only reason the article exists — a guide that does not
 * end in the directory is a blog post.
 */

export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

/**
 * Prerender the published set.
 *
 * Twenty-two articles that change rarely: this is the page type where static
 * generation is unambiguously right, and criterion 10 measures Core Web Vitals
 * on one of them.
 */
export async function generateStaticParams() {
  const guides = await publishedGuides();
  return guides.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const guide = await guideBySlug(slug);
  if (!guide) return {};

  return {
    /*
       §SEO: the article `h1` plus the brand, and **no year**. Appending one to
       an evergreen guide dates the page the moment it turns over;
       `regulatoryCheckedAt` is how freshness is communicated instead.
    */
    title: guide.title,
    description: guide.standfirst,
    alternates: { canonical: absoluteUrl(`/guides/${guide.slug}`) },
    openGraph: {
      type: "article",
      title: guide.title,
      description: guide.standfirst,
      url: absoluteUrl(`/guides/${guide.slug}`),
      publishedTime: guide.publishedAt.toISOString(),
      // The regulatory check, not `updatedAt`. A typo fix moves the row; only
      // an editor re-reading the external facts moves this.
      modifiedTime: (guide.regulatoryCheckedAt ?? guide.publishedAt).toISOString(),
    },
  };
}

export default async function GuidePage({ params }: Props) {
  const { slug } = await params;
  const guide = await guideBySlug(slug);
  // An unpublished guide is a draft, and `guideBySlug` filters those out. A
  // draft reachable by URL is exactly the thin page this handoff exists to
  // keep out of the index.
  if (!guide) notFound();

  const verifiedCount = await verifiedSellerCount();

  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: t("guides.title"), href: "/guides" },
    { label: guide.title },
  ];

  /*
     §3 and §States: below three headings there is no rail, and the article
     column widens. Two entries is a contents list for a page you can already
     see, and it costs 262px to say so.
  */
  const hasContents = guide.headings.length >= MIN_HEADINGS_FOR_CONTENTS;

  return (
    <PublicShell
      bleed
      /* §1: a guide belongs to no top-level nav section, same as `6b`. */
      nav={<DirectoryNav />}
      footer={<DirectoryFooter />}
    >
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Article",
          headline: guide.title,
          description: guide.standfirst,
          datePublished: guide.publishedAt.toISOString(),
          /*
             Acceptance 7: `dateModified` **is** `regulatoryCheckedAt`.

             It used to be `updatedAt`, which moves on a typo fix, a rebuild and
             a redeploy. A crawler told the content changed with nothing to show
             for it discounts the next signal, and on a page whose subject is
             trustworthiness that is the wrong thing to spend.
          */
          dateModified: (guide.regulatoryCheckedAt ?? guide.publishedAt).toISOString(),
          mainEntityOfPage: absoluteUrl(`/guides/${guide.slug}`),
          /*
             §SEO: `author` must be a real `Person` or a named editorial entity.
             Open question 1 is whose name goes here — an anonymous byline on an
             article instructing buyers about licensing and VAT is a rankings
             cost as well as a trust one. Until it is answered the fallback is
             the organisation, which is at least true.
          */
          author: guide.byline
            ? {
                "@type": "Person",
                name: guide.byline,
                ...(guide.bylineRole ? { jobTitle: guide.bylineRole } : {}),
              }
            : { "@type": "Organization", name: "Business Listings" },
          publisher: { "@type": "Organization", name: "Business Listings" },
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
            ...("href" in crumb && crumb.href ? { item: absoluteUrl(crumb.href) } : {}),
          })),
        }}
      />
      {/*
         Acceptance 12: no `FAQPage`. The red-flag card is a callout, not a FAQ,
         and marking it up as one to chase a rich result is the behaviour `6b`
         exists to distinguish us from.
      */}

      <div className="border-b border-line bg-paper px-[var(--gutter)] py-3">
        <div className="mx-auto max-w-7xl">
          <Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />
        </div>
      </div>

      {/*
         §2, the three-column shell — and where the leftover width goes.

         The article column is capped at a 760px measure, so above about 1,322px
         it asks to grow wider than the cap allows. The board let that slack
         collect after the last column and stranded the right rail 165px off the
         margin. `ms-auto` on the rail pins it to the margin and puts the
         surplus in the article-to-rail gutter instead: both rails stay on the
         page margins at every width and only the middle gutter breathes.
      */}
      {/*
         Wider than `max-w-7xl`, and that is the point of §2's arithmetic.

         262 + 760 + 300 is 1,322px of columns. Inside the 1,280px shell every
         other public page uses, the article column is squeezed to about 570 —
         well under the 760px measure the spec calls "a measure, not a layout
         preference". So this one page opens out far enough to hold all three at
         their stated widths, and the surplus above that lands in the
         article-to-rail gutter rather than after the last column.
      */}
      <div className="mx-auto flex w-full max-w-[87.75rem] flex-col gap-9 px-[var(--gutter)] py-11 lg:flex-row lg:gap-14">
        {hasContents && (
          /*
             A `div`, not an `aside`.

             Both rails were `aside`, which makes two `complementary` landmarks
             with no accessible name between them — `landmark-unique`, and a
             screen-reader user offered two identical destinations. The contents
             `nav` and the two rail cards each name themselves, so the wrappers
             are layout and nothing else.
          */
          <div className="w-full shrink-0 lg:w-[262px]">
            <div className="hidden lg:block">
              <Contents headings={guide.headings} />
            </div>
          </div>
        )}

        <article className="min-w-0 flex-1 lg:max-w-[var(--measure-article)]">
          {/*
             `data-caption`, like the count under the closing button: a marker
             for "label, not reading prose". §Type allows 9.5px mono for an
             uppercase eyebrow and §Responsive sets a 15px floor for body text
             in this column, and both are right — the attribute is what lets the
             second be asserted without hand-listing exceptions in a test.
          */}
          <p data-caption className="font-mono text-eyebrow uppercase text-muted">
            {guide.topic
              ? t("guides.kicker", { topic: guide.topic, minutes: guide.readMinutes })
              : t("guides.kicker_untopiced", { minutes: guide.readMinutes })}
          </p>

          <h1 className="mt-3 font-serif text-display text-ink">{guide.title}</h1>

          {/* §Responsive: under `lg` the rail becomes a disclosure above the
              standfirst, closed by default. */}
          {hasContents && (
            <div className="mt-5">
              <ContentsDisclosure headings={guide.headings} />
            </div>
          )}

          {/*
             16.5px, per §4. It is the snippet Google shows and the sentence
             that decides whether the page is read, so it sits above the body
             size rather than at it.
          */}
          <p className="mt-5 text-[length:1.03rem] leading-relaxed text-body">
            {guide.standfirst}
          </p>

          {/*
             The byline strip, and the two dates that keep the article honest.
             §Evergreen: the article names a specific authority and a specific
             VAT rate, and both change — so it says when they were last read.
          */}
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-y border-line py-3.5">
            {guide.byline && (
              <span className="text-body-sm font-medium text-ink">
                {guide.bylineRole
                  ? t("guides.byline_role", { name: guide.byline, role: guide.bylineRole })
                  : guide.byline}
              </span>
            )}
            <span className="font-mono text-eyebrow uppercase text-muted">
              {guide.regulatoryCheckedAt
                ? t("guides.dates", {
                    published: formatDate(guide.publishedAt),
                    checked: formatDate(guide.regulatoryCheckedAt),
                  })
                : t("guides.dates_unchecked", { published: formatDate(guide.publishedAt) })}
            </span>
          </div>

          <div className="mt-7">
            <GuideBody blocks={guide.blocks} cta={guide.cta} verifiedCount={verifiedCount} />
          </div>
        </article>

        <div className="flex w-full shrink-0 flex-col gap-3.5 lg:ms-auto lg:w-[300px]">
          {/* §States: with no related guides yet, the rail renders only the
              second card. It does not render an empty card or placeholder
              links. */}
          <RelatedGuides guides={guide.related} />
          <WhyWeWrite />
        </div>
      </div>
    </PublicShell>
  );
}
