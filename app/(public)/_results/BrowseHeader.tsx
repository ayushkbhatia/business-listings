import { ChipLink, Eyebrow } from "@/components/display";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { BrowseStats, SubcategoryChip } from "@/lib/db/queries/browse";
import { SaveSearch } from "./SaveSearch";

/**
 * Board 1b's header — the scope, the size of it, and the two ways out.
 *
 * The `h1` names the current scope rather than the category, because it is also
 * the page title and the thing a buyer checks before they trust the list. "HVAC
 * & ventilation in Dubai" and "HVAC & ventilation in the UAE" are different
 * pages answering different questions, and a heading that said the same on both
 * would be the page failing to say where it is.
 *
 * The primary action's count is the *filtered* count, not the category's
 * (criterion 10). A buyer who has narrowed to eleven suppliers and is offered
 * "Send one enquiry to 1,842" has been told the control does something other
 * than what it does.
 *
 * "RFQ" appears nowhere. The route is `/rfq/new` because that is internal; the
 * button says what the buyer is doing, which is sending one enquiry.
 */
export interface BrowseHeaderProps {
  /** Already localised: "HVAC & ventilation in Dubai". */
  heading: string;
  stats: BrowseStats;
  chips: readonly SubcategoryChip[];
  /** Where a chip points, e.g. `/c/hvac-and-ventilation`. */
  basePath: string;
  /** The current subcategory slug, where the page is one. */
  activeChild?: string;
  /**
   * Unused since board 1h removed the fan-out button from this header. Kept on
   * the type because the category and search pages both still compute it and
   * removing it is their change, not this component's.
   */
  enquireHref?: string;
  /** The whole query string, so a saved search reproduces this exact view. */
  search: string;
}

/** Chips beyond this fold into a "+ N more" disclosure. */
const CHIPS_SHOWN = 8;

export function BrowseHeader({
  heading,
  stats,
  chips,
  basePath,
  activeChild,
  search,
}: BrowseHeaderProps) {
  const shown = chips.slice(0, CHIPS_SHOWN);
  const overflow = chips.slice(CHIPS_SHOWN);

  /*
     Three clauses, and a clause whose count is zero is dropped rather than
     printed as "0 with online catalogues". §08: say the number, and if the
     number is nothing then say something else instead.
  */
  const clauses = [
    t("browse.stat_suppliers", { count: stats.listings }),
    stats.withCatalogue > 0
      ? t("browse.stat_catalogues", { count: formatCount(stats.withCatalogue) })
      : null,
    stats.products > 0 ? t("browse.stat_products", { count: formatCount(stats.products) }) : null,
  ].filter(Boolean);

  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto max-w-7xl px-5 pt-6 pb-5">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <h1 className="font-serif text-[2.125rem] leading-[1.15] tracking-[-0.015em] text-ink">
              {heading}
            </h1>
            <p className="mt-2 text-body text-body">{clauses.join(" · ")}</p>
          </div>

          {/*
             No "enquire all N" button.

             Board 1h criterion 3 lists `1b` among the pages that contain no
             link to the fan-out, and the spec gives the reason: the board
             originally carried "Post an RFQ to 1,842" here and it was removed,
             because fan-out is capped at eight recipients and a button offering
             1,842 promises something the engine cannot do. A buyer at browse
             stage has not described a requirement yet either, so the composer
             would open cold — which is what the home page's own "Post RFQ"
             already covers.
          */}
          <div className="flex shrink-0 flex-wrap gap-2">
            <SaveSearch search={search} heading={heading} />
          </div>
        </div>

        {chips.length > 0 && (
          <div className="mt-5">
            <Eyebrow as="h2" className="sr-only">
              {t("browse.subcategories")}
            </Eyebrow>
            <div className="flex flex-wrap gap-2">
              {/*
                 "All" carries the unfiltered total and is the selected state on
                 the sector page itself, so the row always says which scope the
                 list below is in.
              */}
              <ChipLink
                href={basePath}
                selected={!activeChild}
                count={formatCount(stats.listings)}
              >
                {t("browse.all")}
              </ChipLink>
              {shown.map((chip) => (
                <ChipLink
                  key={chip.id}
                  href={`${basePath}/${chip.slug}`}
                  selected={activeChild === chip.slug}
                  count={formatCount(chip.count)}
                >
                  {chip.name}
                </ChipLink>
              ))}

              {overflow.length > 0 && (
                /*
                   A disclosure, not a link to somewhere else. `details` gives
                   the whole row without JavaScript, which matters because these
                   are the page's deepest internal links and a crawler must
                   reach every one of them.
                */
                <details className="group inline-block">
                  <summary
                    className={cn(
                      "inline-flex h-8 cursor-pointer list-none items-center rounded-pill border border-line bg-fill px-3.5",
                      "text-body-sm text-muted marker:hidden hover:text-ink",
                      "focus-visible:outline-none focus-visible:shadow-focus",
                    )}
                  >
                    {t("browse.more_subcategories", { count: overflow.length })}
                  </summary>
                  <div className="mt-2 flex w-full flex-wrap gap-2">
                    {overflow.map((chip) => (
                      <ChipLink
                        key={chip.id}
                        href={`${basePath}/${chip.slug}`}
                        selected={activeChild === chip.slug}
                        count={formatCount(chip.count)}
                      >
                        {chip.name}
                      </ChipLink>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
