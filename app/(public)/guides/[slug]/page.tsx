import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { formatDate } from "@/lib/format";
import { guideBySlug, publishedGuides } from "@/lib/guides/queries";
import { t } from "@/lib/i18n";
import { absoluteUrl } from "@/lib/site";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { GuideBody } from "../_Article";

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
    title: guide.title,
    description: guide.summary,
    alternates: { canonical: `/guides/${guide.slug}` },
    openGraph: {
      type: "article",
      title: guide.title,
      description: guide.summary,
      url: absoluteUrl(`/guides/${guide.slug}`),
      publishedTime: guide.publishedAt.toISOString(),
      modifiedTime: guide.updatedAt.toISOString(),
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

  const others = (await publishedGuides()).filter((other) => other.slug !== guide.slug).slice(0, 4);

  const crumbs = [
    { label: t("chrome.directory"), href: "/" },
    { label: t("guides.title"), href: "/guides" },
    { label: guide.title },
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
          "@type": "Article",
          headline: guide.title,
          description: guide.summary,
          datePublished: guide.publishedAt.toISOString(),
          dateModified: guide.updatedAt.toISOString(),
          mainEntityOfPage: absoluteUrl(`/guides/${guide.slug}`),
          // `author` is the platform unless a byline names somebody. Schema.org
          // wants a person or an organisation, not an empty string, so the key
          // carries one or the other and never a blank.
          author: guide.byline
            ? { "@type": "Person", name: guide.byline }
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
            item: crumb.href,
          })),
        }}
      />

      <article>
        <header className="border-b border-line pb-4">
          <p className="font-mono text-eyebrow uppercase text-faint">
            {t("guides.published", { date: formatDate(guide.publishedAt) })}
          </p>
          <h1 className="mt-1.5 max-w-[var(--measure-prose)] font-serif text-h1-serif text-ink">
            {guide.title}
          </h1>
          <p className="mt-3 max-w-[var(--measure-prose)] text-prose text-prose">
            {guide.summary}
          </p>
          {guide.byline && (
            <p className="mt-3 text-caption text-muted">
              {t("guides.byline", { name: guide.byline })}
            </p>
          )}
        </header>

        <div className="mt-5">
          <GuideBody blocks={guide.blocks} cta={guide.cta} />
        </div>
      </article>

      {others.length > 0 && (
        <section className="mt-8 border-t border-line pt-5">
          <h2 className="font-mono text-eyebrow uppercase text-faint">{t("guides.read_next")}</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {others.map((other) => (
              <li key={other.slug}>
                <Link
                  href={`/guides/${other.slug}`}
                  className="block rounded-card border border-line bg-card px-4 py-3 hover:border-brand-line focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <p className="text-body-sm text-ink">{other.title}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PublicShell>
  );
}
