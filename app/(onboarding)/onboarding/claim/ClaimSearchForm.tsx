import Form from "next/form";
import { Button } from "@/components/primitives";
import { t } from "@/lib/i18n";

/**
 * Board 2a's search bar.
 *
 * A GET form, not a server action. Three things fall out of that and each is
 * worth more than the client state it replaces:
 *
 *   - The query is in the URL, so the recruitment CRM can link straight to
 *     `/onboarding/claim?q=DED-441908` and the search has already run by the
 *     time the page paints. Acceptance criterion 13 asks for exactly that, and
 *     an effect that fires a search after hydration is a slower, flickering
 *     version of it.
 *   - It works with no JavaScript. An outbound recruitment message lands on a
 *     phone on a building site, and the first screen of the supply side should
 *     not be the one that needs a good connection to function. `required` and
 *     `minLength` are the browser's own validation rather than a disabled
 *     button, which would be a dead control for anybody without JavaScript.
 *   - The back button goes back to the previous search rather than to a blank
 *     page, because there is no state to lose.
 *
 * `next/form` keeps it a client-side navigation, so the results card streams in
 * behind a Suspense boundary and the three skeleton rows are the real loading
 * state rather than a spinner drawn over stale results.
 */
export function ClaimSearchForm({ initialQuery }: { initialQuery: string }) {
  return (
    <Form action="/onboarding/claim" className="mt-7">
      <div
        className={[
          "flex flex-col gap-2 rounded-card border border-line-strong bg-card p-1.5 shadow-raised",
          // The board's 54px bar above `sm`; stacked below it, where the button
          // goes full width and sits on the 44px mobile target floor.
          "sm:h-[3.375rem] sm:flex-row sm:items-center sm:gap-0 sm:py-0 sm:pe-1.5 sm:ps-4",
        ].join(" ")}
      >
        <input
          id="claim-query"
          name="q"
          type="search"
          required
          minLength={2}
          maxLength={120}
          defaultValue={initialQuery}
          autoComplete="organization"
          placeholder={t("claim.search_placeholder")}
          className={[
            "min-w-0 flex-1 rounded-ctl bg-transparent px-2.5 py-2.5 text-body text-ink",
            "placeholder:text-muted",
            "focus-visible:outline-none focus-visible:shadow-focus sm:px-0 sm:py-0",
            "[&::-webkit-search-cancel-button]:appearance-none",
          ].join(" ")}
        />
        <div className="w-full sm:w-auto">
          <Button type="submit" size="lg" block>
            {t("claim.search_action")}
          </Button>
        </div>
      </div>

      {/*
        The label is the helper line, rather than a second sentence saying the
        same thing quietly. It sits under the field where the board draws it and
        is still the field's accessible name, so what a screen reader hears and
        what a sighted user reads are the same words.
      */}
      <label htmlFor="claim-query" className="mt-2.5 block text-center text-caption text-muted">
        {t("claim.search_label")}
      </label>
    </Form>
  );
}
