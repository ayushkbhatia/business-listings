import type { Metadata } from "next";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { guideIndex } from "@/lib/guides/queries";
import { absoluteUrl } from "@/lib/site";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { JsonLd } from "@/app/(public)/_json-ld";
import { GuideIndexView } from "./_Index";

/**
 * Board 10b — the guide index.
 *
 * Guides come first in handoff 5 because they are the only content that works
 * before supply density exists: an article about payment terms is worth reading
 * on the day the directory has forty listings, and it earns the links the 84
 * area pages need to rank at all. That makes this page the internal link hub
 * for the whole programme — the one URL that connects every article to every
 * other and to the directory.
 */

export const revalidate = 300;

export const metadata: Metadata = {
  title: t("guides.title"),
  description: t("guides.lede"),
  alternates: { canonical: "/guides" },
};

export default async function GuidesPage() {
  const index = await guideIndex();
  const crumbs = [{ label: t("chrome.directory"), href: "/" }, { label: t("guides.title") }];

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
      bleed
    >
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: crumbs.map((crumb, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: crumb.label,
            item: absoluteUrl(crumb.href ?? "/guides"),
          })),
        }}
      />
      {/*
         §SEO: `CollectionPage` with an `ItemList` of every published guide, and
         no `FAQPage` — the same rule as 6d. The list is the whole set rather
         than the visible cards, for the reason the board exists: an index whose
         structured data covered seven of twenty-two would describe a different
         page from the one it serves.
      */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: t("guides.title"),
          url: absoluteUrl("/guides"),
          mainEntity: {
            "@type": "ItemList",
            numberOfItems: index.all.length,
            itemListElement: index.all.map((card, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: absoluteUrl(`/guides/${card.slug}`),
              name: card.title,
            })),
          },
        }}
      />

      <GuideIndexView index={index} subject={null} />
    </PublicShell>
  );
}
