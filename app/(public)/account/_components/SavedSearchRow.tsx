import Link from "next/link";
import { StatusBadge } from "@/components/display/StatusBadge";
import { buttonClassName } from "@/components/primitives";
import type { SavedSearchView } from "@/lib/saved-search/service";
import { formatDateShort } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import type { SavedSearchCadence } from "@/lib/db/generated/client";
import { openSearch } from "../saved/actions";

export const CADENCE_LABEL: Record<SavedSearchCadence, MessageKey> = {
  daily: "saved.cadence.daily",
  weekly: "saved.cadence.weekly",
  when_listed: "saved.cadence.when_listed",
};

/**
 * One saved search, as board 10e draws it — on the inbox's summary panel and
 * on the full list alike, so the two cannot word the same search two ways.
 *
 * Three second lines, one per state: new matches since the last look, no new
 * matches, or — the row the board says is the interesting one — an alert from a
 * search that found nothing, still waiting for something to be listed.
 */
export function SavedSearchRow({ search, editHref }: { search: SavedSearchView; editHref: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-body text-ink">
          {search.newCount > 0 ? (
            // Opening clears the count (`B7`), so with something to clear the
            // name posts the same form as *View N* rather than being a link that
            // opens the results and leaves the count standing.
            <button
              type="submit"
              form={`open-${search.id}`}
              className="rounded-tag text-left underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {search.name}
            </button>
          ) : (
            <Link
              href={search.href}
              className="rounded-tag underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {search.name}
            </Link>
          )}
          {search.stillEmpty ? <span className="text-muted"> · {t("saved.nothing_yet")}</span> : null}
        </p>
        <p
          className={
            search.stillEmpty
              ? "mt-0.5 font-mono text-eyebrow uppercase tracking-eyebrow text-warn-ink"
              : "mt-0.5 font-mono text-eyebrow uppercase tracking-eyebrow text-muted"
          }
        >
          {search.stillEmpty
            ? t("saved.zero_alert")
            : search.newCount > 0
              ? t("saved.new_since", { count: search.newCount, date: formatDateShort(search.countingFrom) })
              : t("saved.no_new")}
        </p>
      </div>

      <StatusBadge tone={search.cadence === "when_listed" ? "warn" : "neutral"} size="sm" shape="chip">
        {t(CADENCE_LABEL[search.cadence])}
      </StatusBadge>

      {search.newCount > 0 ? (
        <form id={`open-${search.id}`} action={openSearch} aria-label={t("saved.open_label", { name: search.name })}>
          <input type="hidden" name="id" value={search.id} />
          <button type="submit" className={buttonClassName({ variant: "ghost", size: "sm" })}>
            {t("saved.view_new", { count: search.newCount })}
          </button>
        </form>
      ) : editHref ? (
        <Link href={editHref} className={buttonClassName({ variant: "ghost", size: "sm" })}>
          {t("saved.edit")}
        </Link>
      ) : null}
    </div>
  );
}
