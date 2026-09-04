import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Breadcrumb, PublicShell } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { getActor } from "@/lib/auth/session";
import { formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { forgetSearch } from "./actions";

/**
 * Board 10e — the searches a buyer kept.
 *
 * Deliberately small. "Save this search" on board 1b writes a row, and a row
 * nobody can find again is a button that pretends to work; this is the page
 * that stops it pretending. Alerts on a saved search are the rest of 10e and
 * are not here.
 *
 * The stored `query` is the query string, so opening one reproduces the exact
 * view — the same property that makes a pasted URL work is what makes this two
 * lines rather than a serialisation format.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: t("saved.title"),
  robots: { index: false, follow: false },
};

export default async function SavedSearchesPage() {
  const actor = await getActor();
  if (!actor) redirect("/signin?next=/account/saved");

  const rows = await prisma.savedSearch.findMany({
    where: { userId: actor.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, query: true, createdAt: true },
  });

  const crumbs = [{ label: t("chrome.directory"), href: "/" }, { label: t("saved.title") }];

  return (
    <PublicShell
      nav={<DirectoryNav />}
      breadcrumb={<Breadcrumb label={t("gallery.breadcrumb_label")} items={crumbs} />}
      footer={<DirectoryFooter />}
    >
      <header className="border-b border-line pb-4">
        <h1 className="font-serif text-h1-serif text-ink">{t("saved.title")}</h1>
        <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-muted">
          {t("saved.lede")}
        </p>

        {/*
           Across to the other half of "saved".

           Two lists, two pages, and until now the pair was reachable in one
           direction only: `/account/saved/shortlist` puts this page in its
           breadcrumb, and nothing here pointed back. A buyer who pressed "Save
           for later" on a storefront and then opened their saved things would
           find searches, no suppliers, and conclude the save did nothing.

           Labelled with the other page's own title rather than a phrase of its
           own. A cross-link whose wording differs from the heading it lands on
           makes a buyer stop and check they arrived where they meant to — and
           there is no count on it, because a count here is a second query and
           the page it leads to already states the true one.
        */}
        <p className="mt-3 text-body-sm">
          <Link
            href="/account/saved/shortlist"
            className="rounded-tag font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("shortlist.title")}
          </Link>
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="mt-5 text-body-sm text-muted">{t("saved.empty")}</p>
      ) : (
        <ul className="mt-5 flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-card px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                {/*
                   The stored query string, replayed. `/search` rather than the
                   category page it was saved from: the filters name the scope
                   on their own, and one route that can render any of them beats
                   storing which page it came from and hoping the slug survives.
                */}
                <Link
                  href={row.query ? `/search?${row.query}` : "/search"}
                  className="rounded-tag text-body font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {row.name}
                </Link>
                <p className="mt-0.5 font-mono text-eyebrow text-muted">
                  {formatRelative(row.createdAt)}
                </p>
              </div>

              {/* A real form, so removing one works without JavaScript. */}
              <form action={forgetSearch}>
                <input type="hidden" name="id" value={row.id} />
                <button
                  type="submit"
                  className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {t("saved.forget")}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </PublicShell>
  );
}
