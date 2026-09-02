import { cn } from "@/lib/cn";
import { Eyebrow } from "@/components/display";
import { EMIRATES } from "@/lib/uae";

/**
 * The hero search bar — board 1a's one job, in one control.
 *
 * "Get a buyer into a category, a search, or an RFQ within one interaction."
 * Everything below the fold on that page exists for somebody who did not use
 * this, so it has to work on the first try and without waiting for anything.
 *
 * ## Why this is a server component with a native select
 *
 * It is a plain GET form. No client JavaScript, no state, no round trip before
 * the buyer can type — which is what makes the LCP target reachable and what
 * makes the bar work at all for somebody on a warehouse floor with one bar of
 * signal. Enter submits from either field because that is what a form does.
 *
 * The board says the WHERE cell opens `EmirateAreaPicker`. That component is
 * two linked controls plus a free-zone toggle and it needs the area list, which
 * is right on the RFQ composer where a buyer is stating a delivery address, and
 * wrong here: on the home page the question is which of seven emirates, the
 * answer is one token in a query string, and `/search` has a full filter rail
 * for narrowing further. A native select answers it, ships no JavaScript, and
 * is the only version of this control that a screen reader, a keyboard and a
 * phone's native picker all already understand.
 *
 * Three cells divided by 1px lines rather than three bordered inputs: the bar
 * reads as one object, which is the point of putting WHAT and WHERE side by
 * side instead of stacking two fields.
 */
export interface DirectorySearchBarProps {
  /**
   * The form's accessible name, already localised.
   *
   * `role="search"` makes this a landmark, and a landmark needs a name that
   * distinguishes it — the public nav carries a second search form and two
   * identically-named landmarks are worse for a screen reader than one named
   * and one not. The nav's stays deliberately unnamed; this one says what it
   * searches.
   */
  formLabel: string;
  /** Already localised. The mono eyebrow over each cell. */
  whatLabel: string;
  whereLabel: string;
  whatPlaceholder: string;
  /** The "All UAE" option, which is the default and not a null state. */
  anywhereLabel: string;
  submitLabel: string;
  /** Prefilled when a buyer arrives back from a search. */
  defaultQuery?: string;
  defaultEmirate?: string;
}

const CELL = "flex flex-col justify-center gap-1 px-4 py-2";

export function DirectorySearchBar({
  formLabel,
  whatLabel,
  whereLabel,
  whatPlaceholder,
  anywhereLabel,
  submitLabel,
  defaultQuery,
  defaultEmirate,
}: DirectorySearchBarProps) {
  return (
    <form
      action="/search"
      method="get"
      role="search"
      aria-label={formLabel}
      className={cn(
        "flex w-full max-w-[760px] flex-col overflow-hidden rounded-card border border-line-strong bg-card shadow-raised",
        // Below 768 the three cells stack full width with the button last, and
        // every target clears the 44px floor. Above it they are one 58px row.
        "sm:h-[58px] sm:flex-row sm:items-stretch",
      )}
    >
      <label className={cn(CELL, "min-w-0 flex-1 border-b border-line sm:border-b-0 sm:border-e")}>
        <Eyebrow>{whatLabel}</Eyebrow>
        <input
          type="search"
          name="q"
          defaultValue={defaultQuery}
          placeholder={whatPlaceholder}
          className={cn(
            "w-full bg-transparent text-body-sm text-ink outline-none",
            "placeholder:text-muted",
            // The platform's own clear control is unlabelled and inconsistent.
            "[&::-webkit-search-cancel-button]:appearance-none",
          )}
        />
      </label>

      <label className={cn(CELL, "border-b border-line sm:w-[210px] sm:border-b-0 sm:border-e")}>
        <Eyebrow>{whereLabel}</Eyebrow>
        <select
          name="emirate"
          defaultValue={defaultEmirate ?? ""}
          className="w-full bg-transparent text-body-sm text-ink outline-none"
        >
          <option value="">{anywhereLabel}</option>
          {EMIRATES.map((emirate) => (
            // Not translated, and not from the catalogue. Dubai is Dubai in
            // every locale; the Arabic names live on the taxonomy records.
            <option key={emirate.value} value={emirate.value}>
              {emirate.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center p-3 sm:ps-3.5 sm:pe-3">
        <button
          type="submit"
          className={cn(
            "inline-flex h-11 w-full items-center justify-center rounded-ctl border border-moss bg-moss px-6",
            "text-body-sm font-medium text-on-ink whitespace-nowrap",
            "transition-colors duration-120 ease-out hover:border-moss-hover hover:bg-moss-hover",
            "focus-visible:outline-none focus-visible:shadow-focus",
            "sm:h-[42px] sm:w-auto",
          )}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
