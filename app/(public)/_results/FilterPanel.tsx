"use client";

import { useState } from "react";
import { Button } from "@/components/primitives";
import { Drawer } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * The filter rail, and the drawer it becomes on a narrow screen.
 *
 * Board 1b: at 1024px and up the rail sits beside the results; below that it
 * collapses behind a "Filters (3)" button and opens as a `Drawer`. Criterion 12
 * is that every filter stays reachable through it — none may be dropped from
 * the small layout, because a filter you cannot reach on a phone is a filter
 * that does not exist for most of the traffic.
 *
 * ## Why the rail is rendered twice
 *
 * One instance cannot be both a column and a dialog: `<dialog>` moves its
 * subtree to the top layer, and no CSS moves a node between the two places. So
 * the same nodes are rendered in both, and exactly one of them is ever exposed
 * — the column is `display: none` below `lg`, and the drawer is a closed
 * `<dialog>` above it. Assistive technology sees one set, not two.
 *
 * The duplicate anchors cost nothing to a crawler either: every facet link is a
 * filtered permutation, and the spec marks those `noindex` beyond emirate and
 * area precisely so they are not competing for anything.
 *
 * The button carries the applied count rather than a bare "Filters", because on
 * a phone the rail is out of sight and the count is the only thing telling a
 * buyer why they are looking at eleven results instead of two hundred.
 */
export function FilterPanel({
  rail,
  appliedCount,
}: {
  /** The rendered rail. Server-built, handed across as nodes. */
  rail: React.ReactNode;
  appliedCount: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="hidden min-w-0 lg:block">{rail}</div>

      <div className="lg:hidden">
        <Button
          variant="secondary"
          size="md"
          block
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          {appliedCount > 0
            ? t("results.filters_count", { count: appliedCount })
            : t("results.filters")}
        </Button>

        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          side="start"
          size="md"
          title={t("results.filters")}
          closeLabel={t("overlay.close")}
          footer={
            /*
               Applying is navigation — every facet link is an anchor that
               reloads the page — so this only dismisses the panel. It is here
               because a drawer with no way out but the corner X is a drawer
               people get stuck in on a phone.
            */
            <Button block onClick={() => setOpen(false)}>
              {t("results.show_results")}
            </Button>
          }
        >
          {rail}
        </Drawer>
      </div>
    </>
  );
}
