"use client";

import { useId } from "react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/primitives";
import type { TemplateSort } from "@/lib/notify/templates";
import { t } from "@/lib/i18n";
import { hrefFor, type Filters } from "./present";

/**
 * The list's order, as a URL. Changing it navigates rather than re-sorting in
 * place, so the order survives a reload and a pasted link, and the open
 * template stays open.
 */
export function SortSelect({
  options,
  filters,
}: {
  options: readonly { value: TemplateSort; label: string }[];
  filters: Filters;
}) {
  const router = useRouter();
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-caption text-muted">
        {t("notifications.sort.label")}
      </label>
      <div className="w-44">
        <Select
          id={id}
          size="sm"
          options={options}
          value={filters.sort}
          onChange={(event) => router.push(hrefFor(filters, { sort: event.target.value as TemplateSort }), { scroll: false })}
        />
      </div>
    </div>
  );
}
