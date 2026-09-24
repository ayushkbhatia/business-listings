"use client";

import { useRef } from "react";
import { emitEvent } from "@/components/telemetry";

/**
 * Counts a buyer picking something out of a results page. Board `11e`.
 *
 * The click half of the demand signal a sponsored slot is priced from. Its
 * counterpart — how often buyers were *shown* this scope — has been counted
 * since board `3l` by `recordCategoryPositions` on the server. A click was
 * attributable to no page at all until this.
 *
 * ## Delegated, not a handler per card
 *
 * The results are server components, and a server component cannot hand a
 * function to a client one — the most repeated defect in this project. So this
 * takes the rendered results as `children`, which are elements and cross the
 * boundary happily, and listens on the wrapper. No card learns anything about
 * telemetry, and a new card type is covered the day it is added.
 *
 * `onClickCapture`, so a link that stops propagation on its own still counts,
 * and a modified click — a new tab, a download — counts as well, which is
 * right: opening a supplier in a new tab is choosing them.
 *
 * ## Once per page view
 *
 * A buyer who opens four suppliers from one search has shown interest in the
 * page once, not four times. Counting each would make a scope's demand a
 * function of how many tabs somebody opens, and the price is derived from this
 * number.
 *
 * Nothing renders. No wrapper styling and no layout of its own — a `display:
 * contents` div so the grid the caller built is untouched.
 */
export function ResultClicks({
  categoryId,
  emirate,
  children,
}: {
  /** The scope this page is. Null on a page with no category — nothing is counted. */
  categoryId: string | null;
  emirate?: string | null;
  children: React.ReactNode;
}) {
  const sent = useRef(false);

  if (!categoryId) return <>{children}</>;

  return (
    <div
      style={{ display: "contents" }}
      onClickCapture={(event) => {
        if (sent.current) return;
        const target = event.target as HTMLElement | null;
        /*
           A storefront, a product page or an enquiry composer aimed at one
           supplier. All three are the buyer choosing out of this page; a facet
           chip or a pagination link is not.

           Board `6a-s` adds one more: a link marked `data-scope-action`, which
           the services landing page puts on its fan-out. A buyer who asks the
           market for this trade in this place has acted on the scope as surely
           as one who opened a firm, and it is the stronger signal of the two.
        */
        const link = target?.closest?.("a[href^='/b/'], a[href^='/rfq/new?to='], a[data-scope-action]");
        if (!link) return;
        sent.current = true;
        emitEvent("result_clicked", {
          categoryId,
          ...(emirate ? { emirate } : {}),
        });
      }}
    >
      {children}
    </div>
  );
}
