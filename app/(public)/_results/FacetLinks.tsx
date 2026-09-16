import { cn } from "@/lib/cn";
import { Check } from "@/components/primitives/icons";
import { formatCount } from "@/lib/format";
import { toSearchParams, withoutFacet, type SearchQuery } from "@/lib/search/query";
import { crawlRel } from "@/lib/seo/crawl-policy";
import type { FacetGroup } from "@/lib/db/queries";

/**
 * A facet's options, as links.
 *
 * Links rather than checkboxes and a submit button: the results page is
 * server-rendered, so every filter state is a URL. That makes each one
 * shareable, back-buttonable, indexable where we want it and — the part that
 * matters most on a phone in a warehouse — working before any JavaScript has
 * loaded.
 */
export function FacetLinks({
  group,
  query,
  basePath,
  selectedLabel,
}: {
  group: FacetGroup;
  query: SearchQuery;
  basePath: string;
  /** Already localised, e.g. "selected — activate to remove". */
  selectedLabel: string;
}) {
  function toggled(value: string): string {
    const cleared = withoutFacet(query, group.key);
    const option = group.options.find((o) => o.value === value);
    if (option?.selected) return `${basePath}?${toSearchParams(cleared)}`;

    switch (group.key) {
      case "tier":
        return `${basePath}?${toSearchParams({ ...cleared, tier: Number(value), page: 1 })}`;
      case "emirate":
        return `${basePath}?${toSearchParams({ ...cleared, emirate: value, page: 1 })}`;
      case "freeZone":
        return `${basePath}?${toSearchParams({ ...cleared, freeZone: true, page: 1 })}`;
      case "availability":
        return `${basePath}?${toSearchParams({ ...cleared, availability: [value], page: 1 })}`;
      case "replyWithinHours":
        return `${basePath}?${toSearchParams({ ...cleared, replyWithinHours: Number(value), page: 1 })}`;
      case "yearsTrading":
        return `${basePath}?${toSearchParams({ ...cleared, yearsTrading: Number(value), page: 1 })}`;
      default: {
        const current = query.spec[group.key] ?? [];
        const next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
        return `${basePath}?${toSearchParams({
          ...query,
          spec: { ...query.spec, [group.key]: next },
          page: 1,
        })}`;
      }
    }
  }

  return (
    <>
      {group.options.map((option) => (
        <FacetOptionLink
          key={option.value}
          href={toggled(option.value)}
          label={option.label}
          count={option.count}
          selected={option.selected}
          selectedLabel={selectedLabel}
        />
      ))}
    </>
  );
}

/**
 * One option in a filter rail, as a link — the goods rail's and board `1c-s`'s.
 *
 * Extracted so the two rails render one control. The blended rail's options
 * toggle different keys, so the href is the caller's; the look, the target
 * size, the state words and the crawl attribute are this component's, and a
 * buyer moving from a valves shelf to a VAT search sees the same checkbox.
 */
export function FacetOptionLink({
  href,
  label,
  count,
  selected,
  selectedLabel,
  disabled = false,
  disabledLabel,
}: {
  href: string;
  label: string;
  count: number;
  selected: boolean;
  /** Already localised, e.g. "selected — activate to remove". */
  selectedLabel: string;
  /**
   * `10c`+`10c-s` B9, third zero state — *disable the facet with its zero, do
   * not let it be chosen.*
   *
   * Rendered rather than hidden: the option is a fact about these results, and
   * a rail that quietly drops a value the buyer can see in the list is how a
   * filter set becomes unexplainable. Not an `<a>` at all, so there is nothing
   * to tab to and nothing to follow.
   */
  disabled?: boolean;
  /** Already localised, e.g. "no results with the current filters". */
  disabledLabel?: string | undefined;
}) {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        /*
           `text-muted`, not `text-faint`. The nought is the point — *disable the
           facet with its zero* — and a label nobody can read states nothing. The
           affordance it loses is the box, the hover and the tab stop, which is
           what makes it unchoosable without making it unreadable.
        */
        className="flex min-h-11 items-center gap-2 rounded-tag py-0.5 text-body-sm text-muted md:min-h-8"
      >
        <span
          aria-hidden="true"
          className="flex size-4 shrink-0 items-center justify-center rounded-tag border border-line bg-paper-sunk"
        />
        <span className="min-w-0 flex-1 truncate">
          {label}
          {disabledLabel && <span className="sr-only"> — {disabledLabel}</span>}
        </span>
        <span className="font-mono text-eyebrow tabular-nums text-faint">{formatCount(count)}</span>
      </span>
    );
  }
  return (
    <a
      href={href}
      /*
         The link that made this the most expensive surface on the site.

         Every facet anchor ADDS its value to whatever is already active, so
         the rail on a two-facet page links to three-facet pages and those
         link to four. On one shelf that is ~10^45 URLs, and on 2026-09-04 a
         training crawler walked 794 of them in 75 minutes — each an uncached
         function invocation ~16 Postgres round trips deep.

         `crawlRel` reads the href rather than taking a hardcoded attribute,
         which gets the case that matters at the boundary: toggling the last
         active facet OFF yields a clean URL, and that one link should stay
         followable. See lib/seo/crawl-policy.ts.
      */
      rel={crawlRel(href)}
      // aria-pressed belongs to a button. These are links: applying a
      // filter is a navigation, and aria-current is the attribute that
      // says "this one is on" for an item in a set.
      aria-current={selected ? "true" : undefined}
      className={cn(
        // The accessibility floor is 44px on mobile and 32px on desktop.
        // A 22px facet row is a fine mouse target and a bad thumb target,
        // and a filter rail on a phone is all thumb.
        "flex min-h-11 items-center gap-2 rounded-tag py-0.5 text-body-sm md:min-h-8",
        "transition-colors duration-120 ease-out",
        "focus-visible:outline-none focus-visible:shadow-focus",
        selected ? "text-ink" : "text-body hover:text-ink",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-tag border",
          selected ? "border-moss bg-moss text-on-ink" : "border-line-strong bg-card",
        )}
      >
        {selected && <Check size={11} />}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {label}
        {/* Not ARIA-only: the state is a word for anyone listening, and
            the link's job flips from apply to remove when it is on. */}
        {selected && <span className="sr-only"> {selectedLabel}</span>}
      </span>
      <span className="font-mono text-eyebrow tabular-nums text-faint">{formatCount(count)}</span>
    </a>
  );
}
