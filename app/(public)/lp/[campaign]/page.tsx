import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClassName } from "@/components/primitives";
import { prisma } from "@/lib/db/client";
import { getDirectoryStats } from "@/lib/db/queries";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Prose } from "@/app/(public)/_landing/Blocks";

/**
 * Board 10i — a campaign landing page.
 *
 * "No site nav beyond the wordmark and one escape link, but always offers the
 * directory as an alternative — a page that traps the visitor converts worse
 * and ranks worse."
 *
 * So: no `PublicShell`, no search field, no footer nav. One wordmark that is a
 * link home, the campaign's own copy, one call to action, and a block that
 * plainly offers the directory to somebody who wants something else. We would
 * rather lose that click than keep it by having nowhere else to go.
 *
 * Criterion 9 is not here. `proxy.ts` captures the tag on any tagged request,
 * because a page component cannot set a cookie and a campaign link is not the
 * only kind that carries one.
 */

export const revalidate = 3600;

interface Props {
  params: Promise<{ campaign: string }>;
}

async function find(slug: string) {
  return prisma.campaign.findFirst({
    where: { slug, publishedAt: { not: null } },
    select: {
      id: true,
      slug: true,
      headline: true,
      standfirst: true,
      body: true,
      metaTitle: true,
      metaDescription: true,
      ctaCategory: { select: { slug: true, name: true } },
    },
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const campaign = await find((await params).campaign);
  if (!campaign) return {};

  return {
    title: campaign.metaTitle ?? campaign.headline,
    ...(campaign.metaDescription ? { description: campaign.metaDescription } : {}),
    alternates: { canonical: `/lp/${campaign.slug}` },
    /*
       Indexable, and canonical to itself. A campaign page is a real page with
       real copy — it is not a doorway, and hiding it would be admitting it was.
       What it must not do is compete with the trade page for the same query,
       which is what the call to action below is for.
    */
  };
}

export default async function CampaignPage({ params }: Props) {
  const campaign = await find((await params).campaign);
  if (!campaign) notFound();

  /*
     No attribution is written here. A page component cannot modify cookies in
     the App Router, and a tagged link can arrive on any page anyway — so
     `proxy.ts` captures it for all of them.
  */
  const stats = await getDirectoryStats();
  const ctaHref = campaign.ctaCategory ? `/c/${campaign.ctaCategory.slug}` : "/search";
  const ctaLabel = campaign.ctaCategory
    ? t("campaign.cta_category", { category: campaign.ctaCategory.name })
    : t("campaign.cta_search");

  return (
    <div className="min-h-dvh bg-canvas">
      {/*
        The whole of the chrome. One wordmark, and it is a link — a visitor who
        wants out should not have to use the back button.
      */}
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center px-5 py-4">
          <Link
            href="/"
            aria-label={t("campaign.escape_label")}
            className="rounded-tag font-serif text-h3 text-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("campaign.escape")}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-10">
        <h1 className="max-w-[var(--measure-prose)] font-serif text-h1-serif text-ink">
          {campaign.headline}
        </h1>
        {campaign.standfirst && (
          <p className="mt-4 max-w-[var(--measure-prose)] text-prose text-prose">
            {campaign.standfirst}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link href={ctaHref} className={buttonClassName()}>
            {ctaLabel}
          </Link>
          <Link
            href="/rfq/new"
            className="rounded-tag text-body-sm text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("campaign.cta_rfq")}
          </Link>
        </div>

        {/* Say the number, on a page whose whole job is being believed. */}
        <p className="mt-4 max-w-[var(--measure-prose)] text-caption text-muted">
          {t("campaign.trust", {
            listings: formatCount(stats.listings),
            verified: formatCount(stats.verified),
          })}
        </p>

        {campaign.body && <Prose text={campaign.body} />}

        {/*
          The alternative, stated plainly and near the bottom where somebody who
          has read the page and decided it is not for them will be looking.
        */}
        <section className="mt-10 max-w-[var(--measure-prose)] rounded-card border border-line bg-card px-5 py-4">
          <p className="text-body-sm text-prose">
            {t("campaign.alternative", { listings: formatCount(stats.listings) })}
          </p>
          <Link
            href="/"
            className="mt-3 inline-block rounded-tag text-body-sm text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("campaign.escape_label")}
          </Link>
        </section>
      </main>
    </div>
  );
}
