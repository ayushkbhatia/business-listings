import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/display/Alert";
import { buttonClassName } from "@/components/primitives";
import { Card, PublicShell } from "@/components/structure";
import { accountCounts } from "@/lib/account/overview";
import { requireBuyerSeat } from "@/lib/auth/buyer";
import { getViewer } from "@/lib/auth/viewer";
import { CADENCES, savedSearchesFor } from "@/lib/saved-search/service";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { AccountTabs } from "../_tabs";
import { CADENCE_LABEL, SavedSearchRow } from "../_components/SavedSearchRow";
import { changeCadence, forgetSearch } from "./actions";

/**
 * Board 10e — saved searches and alerts, the whole list.
 *
 * Q2, our position taken: the inbox's panel is the three-row summary, this tab
 * is the full list, and *View all N* links them. The rows are the same
 * component on both, so a search reads the same wherever it is shown.
 *
 * Each row carries its cadence as a select with its own Save — a choice that
 * changes what arrives in somebody's inbox applies on save, not on change
 * (design-system §Interaction rules) — and a remove. A search that found
 * nothing is never removed for being empty: it is the demand record board 12d
 * reads, and the only way it leaves is the buyer removing it.
 */
export const dynamic = "force-dynamic";

// `robots` is inherited from ../layout.tsx, which owns it for the subtree.
export const metadata: Metadata = {
  title: t("saved.title"),
};

export default async function SavedSearchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);
  const { actor } = await requireBuyerSeat("/account/saved");

  const [searches, counts, viewer] = await Promise.all([
    savedSearchesFor(actor.id),
    accountCounts(actor.id),
    getViewer(),
  ]);

  return (
    <PublicShell bleed nav={<DirectoryNav viewer={viewer} />} footer={<DirectoryFooter />}>
      <AccountTabs active="saved" counts={counts} />

      <div className="mx-auto w-full max-w-4xl px-5 py-8">
        <h1 className="font-serif text-h1-serif text-ink">{t("saved.title")}</h1>
        <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-body">{t("saved.lede")}</p>

        {one("changed") ? (
          <div className="mt-4">
            <Alert tone="ok" live="polite">
              {t("saved.cadence_saved")}
            </Alert>
          </div>
        ) : null}
        {one("removed") ? (
          <div className="mt-4">
            <Alert tone="ok" live="polite">
              {t("saved.removed")}
            </Alert>
          </div>
        ) : null}
        {one("error") === "cadence" ? (
          <div className="mt-4">
            <Alert tone="bad" live="assertive" fix={t("saved.cadence_error_fix")}>
              {t("saved.cadence_error")}
            </Alert>
          </div>
        ) : null}

        {searches.length === 0 ? (
          <div className="mt-6">
            <Card padded>
              <h2 className="text-h3 text-ink">{t("saved.empty_title")}</h2>
              <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-body">{t("saved.empty")}</p>
              <p className="mt-3">
                <Link href="/search" className={buttonClassName({ variant: "secondary", size: "sm" })}>
                  {t("saved.empty_action")}
                </Link>
              </p>
            </Card>
          </div>
        ) : (
          <ul className="mt-6 divide-y divide-line overflow-hidden rounded-card border border-line bg-card">
            {searches.map((search) => (
              <li key={search.id} id={search.id} className="scroll-mt-24">
                <SavedSearchRow search={search} editHref={null} />
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-dashed border-line bg-paper px-5 py-2.5">
                  <form action={changeCadence} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={search.id} />
                    <label htmlFor={`cadence-${search.id}`} className="text-caption text-body">
                      {t("saved.cadence_label")}
                    </label>
                    <select
                      id={`cadence-${search.id}`}
                      name="cadence"
                      defaultValue={search.cadence}
                      className="h-8 rounded-ctl border border-line-strong bg-card px-2 text-body-sm text-ink focus-visible:shadow-focus focus-visible:outline-none"
                    >
                      {CADENCES.map((cadence) => (
                        <option key={cadence} value={cadence}>
                          {t(CADENCE_LABEL[cadence])}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className={buttonClassName({ variant: "secondary", size: "sm" })}>
                      {t("saved.cadence_save")}
                    </button>
                  </form>
                  <span className="text-caption text-muted">{t("saved.saved_on", { date: formatDate(search.createdAt) })}</span>
                  <form action={forgetSearch} className="ml-auto">
                    <input type="hidden" name="id" value={search.id} />
                    <button
                      type="submit"
                      aria-label={t("saved.forget_label", { name: search.name })}
                      className="rounded-tag text-caption text-body underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      {t("saved.forget")}
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PublicShell>
  );
}
