import Link from "next/link";
import { ChipLink, Eyebrow, FilterChip } from "@/components/display";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  appliedKeys,
  toSearchParams,
  withoutFacet,
  type SearchQuery,
} from "@/lib/search/query";

/**
 * Board 1c's filter bar — one wrapping row above the split.
 *
 * Applied filters come first and are removable; available ones follow. That
 * order is the board's and it is the right way round: what a buyer has already
 * done to the result set explains the number beside it, and burying it after
 * four dropdowns is how somebody ends up staring at eleven results wondering
 * where the other two hundred went.
 *
 * ## The chip the board draws that this does not build
 *
 * `Price ▾`. The spec calls it a pivot leftover and says to replace it with
 * `Availability ▾`, which is what this renders. There is no price on any public
 * surface and there is no price column on `Product` to filter by — a price chip
 * here would be a control with nothing behind it.
 *
 * Every chip is an anchor. Filtering must work with JavaScript off, and each
 * permutation is a real URL a buyer can send somebody.
 */

export interface SearchFilterBarProps {
  query: SearchQuery;
  basePath: string;
  businessTotal: number;
  productTotal: number;
  /** Localised names for the facets a buyer has set, keyed by query-string key. */
  appliedLabels: { key: string; facet: string; value: string }[];
}

/** The four availability values, as the board lists them. */
const AVAILABILITY = ["in_stock", "made_to_order", "indent"] as const;

export function SearchFilterBar({
  query,
  basePath,
  businessTotal,
  productTotal,
  appliedLabels,
}: SearchFilterBarProps) {
  const applied = appliedKeys(query);
  const total = query.tab === "products" ? productTotal : businessTotal;

  const hrefFor = (over: Partial<SearchQuery>) =>
    `${basePath}?${toSearchParams(query, { ...over, page: 1 })}`;

  return (
    <div className="border-b border-line bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5">
        {/*
           The count first, and it is the live one for the tab in view. A bar
           whose number disagrees with the list under it is worse than no number.
        */}
        <p className="text-body-sm font-medium tabular-nums text-ink">
          {t("search.result_count", { count: total, formatted: formatCount(total) })}
        </p>

        {/* ── Applied, removable ─────────────────────────────────────────── */}
        {appliedLabels.map((facet) => (
          <FilterChip
            key={`${facet.key}:${facet.value}`}
            facet={facet.facet}
            removeHref={`${basePath}?${toSearchParams(withoutFacet(query, facet.key))}`}
            removeLabel={t("results.remove_filter", { facet: facet.facet, value: facet.value })}
          >
            {facet.value}
          </FilterChip>
        ))}

        {/* ── Available ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/*
             Availability, in the slot the board drew a price chip in. Three
             anchors rather than a dropdown: a `select` needs JavaScript to
             navigate, and these are the whole vocabulary.
          */}
          {AVAILABILITY.map((value) => {
            const on = query.availability?.includes(value) ?? false;
            const next = on
              ? (query.availability ?? []).filter((v) => v !== value)
              : [...(query.availability ?? []), value];
            return (
              <ChipLink
                key={value}
                size="sm"
                href={hrefFor({ availability: next })}
                selected={on}
              >
                {t(`availability.${value}` as never)}
              </ChipLink>
            );
          })}
        </div>

        {/* ── Tab switch, right-aligned, both counts live ─────────────────── */}
        <div className="ms-auto flex items-center gap-1 rounded-ctl bg-paper-sunk p-0.5">
          {(
            [
              { tab: "businesses" as const, label: t("results.businesses_tab"), count: businessTotal },
              { tab: "products" as const, label: t("results.products_tab"), count: productTotal },
            ]
          ).map((entry) => {
            const active = query.tab === entry.tab;
            return (
              <Link
                key={entry.tab}
                href={hrefFor({ tab: entry.tab })}
                {...(active ? { "aria-current": "page" as const } : {})}
                className={cn(
                  "rounded-ctl px-3 py-1.5 text-body-sm font-medium tabular-nums",
                  "focus-visible:outline-none focus-visible:shadow-focus",
                  active ? "bg-card text-ink shadow-sm" : "text-body hover:text-ink",
                )}
              >
                {entry.label} ({formatCount(entry.count)})
              </Link>
            );
          })}
        </div>
      </div>

      {applied.length > 0 && (
        <p className="sr-only">{t("results.applied", { count: applied.length })}</p>
      )}
    </div>
  );
}

/**
 * The sort strip — the mono line that names the actual sort and origin.
 *
 * It says what happened, not what was asked for. When there is no origin it
 * does not print a place: distance scored as unknown for every row, and
 * "SORTED BY DISTANCE FROM —" would be claiming an ordering the ranking never
 * applied.
 */
export function SortStrip({
  originLabel,
  drawHref,
}: {
  originLabel?: string | undefined;
  drawHref?: string | undefined;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5">
      <Eyebrow as="p">
        {originLabel
          ? t("search.sorted_by_distance", { origin: originLabel })
          : t("search.sorted_by_relevance")}
      </Eyebrow>
      {drawHref && (
        <Link
          href={drawHref}
          className="rounded-tag text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {t("search.draw_area")}
        </Link>
      )}
    </div>
  );
}
