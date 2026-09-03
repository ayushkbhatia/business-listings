"use client";

import { useState } from "react";
import { Drawer } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * The rail as a column above 1024, and behind a button below it.
 *
 * Rendered twice with one of the two always `display: none`, which is the same
 * arrangement board 1b's filter rail settled on and for the same reason: one
 * subtree cannot be both a column and a `<dialog>`, no CSS moves a node between
 * them, and hiding with `display` keeps exactly one in the accessibility tree.
 * Two visible copies would give a screen reader two identical sets of filters.
 *
 * Every control inside is an anchor, so the drawer is a viewport for the same
 * links rather than a second implementation of filtering.
 */
export function CatalogueFilters({
  appliedCount,
  rail,
}: {
  appliedCount: number;
  rail: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="hidden lg:block">{rail}</div>

      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-ctl border border-line bg-card px-3 py-2 text-body-sm font-medium text-ink hover:bg-paper focus-visible:outline-none focus-visible:shadow-focus"
        >
          {t("catalogue.filters_button", { count: appliedCount })}
        </button>

        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          side="start"
          title={t("catalogue.rail_label")}
          closeLabel={t("catalogue.close_filters")}
        >
          {rail}
        </Drawer>
      </div>
    </>
  );
}
