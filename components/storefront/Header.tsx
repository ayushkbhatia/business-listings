import { formatPhone } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SectionProps } from "@/lib/storefront/render-data";

/**
 * Section 1 — the header and contact bar.
 *
 * Fixed: it cannot be moved, disabled or removed, and criterion 6 is about this
 * row. Every storefront needs a name and a way to reach the supplier, and a
 * template that could turn either off is a template that produces a page nobody
 * can act on.
 *
 * No seller-fillable fields. The name is the trade name on the licence.
 */
export function Header({ data }: SectionProps) {
  const head = data.locations.find((location) => location.type === "head_office") ?? data.locations[0];

  return (
    <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-brand-line pb-4">
      <div className="min-w-0">
        <h1 className="text-h2 text-brand-ink">{data.business.displayName}</h1>
        {head && (
          <p className="mt-1 text-caption text-muted">
            {[head.areaName, t(`emirate.${head.emirate}` as never)].filter(Boolean).join(", ")}
          </p>
        )}
      </div>

      {head?.phone && (
        <a
          href={`tel:${head.phone}`}
          className="rounded-tag font-mono text-caption text-brand underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {formatPhone(head.phone)}
        </a>
      )}
    </header>
  );
}
