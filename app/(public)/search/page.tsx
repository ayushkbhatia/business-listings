import type { Metadata } from "next";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { t } from "@/lib/i18n";
import { parseSearchQuery } from "@/lib/search/query";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { Results } from "@/app/(public)/_results/Results";

/**
 * Results are per-query and there is nothing to cache across buyers.
 * robots.txt disallows this route; the metadata says so too, so a stray link
 * does not put a query string in the index.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("search.results_title"),
  robots: { index: false, follow: true },
};

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SearchPage({ searchParams }: Props) {
  const query = parseSearchQuery(await searchParams);

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={
        <Breadcrumb
          label={t("gallery.breadcrumb_label")}
          items={[
            { label: t("chrome.directory"), href: "/" },
            { label: query.q ? t("search.results_for", { query: query.q }) : t("search.results_title") },
          ]}
        />
      }
      footer={<DirectoryFooter />}
    >
      <header className="border-b border-line pb-4">
        <h1 className="font-serif text-h1-serif text-ink">
          {query.q ? t("search.results_for", { query: query.q }) : t("search.results_title")}
        </h1>
      </header>

      <div className="mt-5">
        <Results query={query} basePath="/search" />
      </div>
    </PublicShell>
  );
}
