import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { formatDate } from "@/lib/format";
import { publishedGuides } from "@/lib/guides/queries";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";

/**
 * Board 10b — the guide index.
 *
 * Guides come first in handoff 5 because they are the only content that works
 * before supply density exists: an article about payment terms is worth reading
 * on the day the directory has forty listings, and it earns the links the 84
 * area pages need to rank at all.
 */

export const revalidate = 3600;

export const metadata: Metadata = {
  title: t("guides.title"),
  description: t("guides.lede"),
  alternates: { canonical: "/guides" },
};

export default async function GuidesPage() {
  const guides = await publishedGuides();
  const crumbs = [{ label: t("chrome.directory"), href: "/" }, { label: t("guides.title") }];

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
        <h1 className="font-serif text-h1-serif text-ink">{t("guides.title")}</h1>
        <p className="mt-3 max-w-[var(--measure-prose)] text-prose text-prose">
          {t("guides.lede")}
        </p>
        {guides.length > 0 && (
          <p className="mt-3 font-mono text-eyebrow uppercase text-faint">
            {t("guides.meta", { count: guides.length })}
          </p>
        )}
      </header>

      {guides.length === 0 ? (
        /*
           The empty state is a real page, not a blank one. An index with
           nothing on it still gets crawled, and "no guides yet" plus a way into
           the directory is worth more than a heading on its own.
        */
        <div className="mt-5 max-w-[var(--measure-prose)] rounded-card border border-line bg-card px-5 py-4">
          <p className="text-body-sm text-ink">{t("guides.empty")}</p>
          <p className="mt-1.5 text-body-sm text-prose">{t("guides.empty_body")}</p>
          <Link
            href="/"
            className="mt-3 inline-block rounded-tag text-body-sm text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("notfound.home")}
          </Link>
        </div>
      ) : (
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {guides.map((guide) => (
            <li key={guide.slug}>
              <Link
                href={`/guides/${guide.slug}`}
                className="flex h-full flex-col rounded-card border border-line bg-card px-5 py-4 hover:border-brand-line focus-visible:outline-none focus-visible:shadow-focus"
              >
                <p className="font-mono text-eyebrow uppercase text-faint">
                  {t("guides.published", { date: formatDate(guide.publishedAt) })}
                </p>
                <h2 className="mt-1.5 text-h3 text-ink">{guide.title}</h2>
                <p className="mt-2 text-body-sm text-prose">{guide.summary}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PublicShell>
  );
}
