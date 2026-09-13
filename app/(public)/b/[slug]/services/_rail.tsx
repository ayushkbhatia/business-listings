import { FilterRail } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { crawlRel } from "@/lib/seo/crawl-policy";
import { cn } from "@/lib/cn";
import { Check } from "@/components/primitives/icons";
import {
  filterNoteKind,
  servicesQueryString,
  showsFilterGroups,
  type FacetOption,
  type ServicesCatalogueQuery,
} from "@/lib/storefront/services-catalogue";

/**
 * Board `1e-s` — the filter panel, and the note that admits what it is for.
 *
 * Two groups — engagement and fee basis. The render's third, *taking work*, is
 * cut with the rest of D11: nothing on this page can say a firm is at capacity.
 *
 * Every option is an anchor, not a checkbox wired to JavaScript, which is board
 * 1e's catalogue rail's reasoning carried across: a filter that needs a script
 * to navigate is a filter a crawler, a slow phone and a keyboard user each meet
 * differently. They look like checkboxes because that is the grammar the board
 * draws, and they carry `aria-current` because that is what they are — the
 * current view. Each filtered href is `nofollow` through `crawlRel`, so the
 * combinations stay out of the crawl graph (`lib/seo/crawl-policy.ts`).
 */
export function ServicesFilterPanel({
  basePath,
  query,
  total,
  facets,
}: {
  basePath: string;
  query: ServicesCatalogueQuery;
  total: number;
  facets: { engagement: FacetOption[]; fee: FacetOption[] };
}) {
  const href = (over: Partial<ServicesCatalogueQuery>) => {
    const qs = servicesQueryString(query, { ...over, page: 1 });
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const applied = query.engagement.length + query.fee.length;

  const toggle = (list: readonly string[], value: string) =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  return (
    <div className="flex flex-col gap-4">
      {showsFilterGroups(total) && (
        <FilterRail
          label={t("storefront_services.filters_label")}
          appliedCount={applied}
          appliedLabel={t("storefront_services.filters_applied", { count: applied })}
          clearAllLabel={t("storefront_services.filters_clear")}
          clearAllHref={basePath}
          sections={[
            {
              key: "engagement",
              label: t("storefront_services.field.engagement"),
              activeCount: query.engagement.length,
              children: (
                <ul className="flex list-none flex-col gap-1.5 p-0">
                  <li>
                    <OptionLink
                      href={href({ engagement: [] })}
                      label={t("storefront_services.filters_all")}
                      selected={query.engagement.length === 0}
                    />
                  </li>
                  {facets.engagement.map((option) => (
                    <li key={option.value}>
                      <OptionLink
                        href={href({ engagement: toggle(query.engagement, option.value) })}
                        label={t(`engagement.${option.value}` as "engagement.ongoing_contract")}
                        count={option.count}
                        selected={option.selected}
                      />
                    </li>
                  ))}
                </ul>
              ),
            },
            ...(facets.fee.length > 0
              ? [
                  {
                    key: "fee",
                    label: t("storefront_services.field.fee_basis"),
                    activeCount: query.fee.length,
                    children: (
                      <ul className="flex list-none flex-col gap-1.5 p-0">
                        {facets.fee.map((option) => (
                          <li key={option.value}>
                            <OptionLink
                              href={href({ fee: toggle(query.fee, option.value) })}
                              label={option.label ?? option.value}
                              count={option.count}
                              selected={option.selected}
                            />
                          </li>
                        ))}
                      </ul>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}

      {/*
         B6 — on every firm. The first wording is a claim about this firm's
         list and is only true while the list is short; past that the note says
         what the filters are doing instead of pretending they do nothing.
      */}
      <p className="rounded-card border border-line bg-card p-4 text-body-sm text-body">
        {filterNoteKind(total) === "few"
          ? t("storefront_services.filters_note_few", { count: total, formatted: formatCount(total) })
          : t("storefront_services.filters_note_many", { formatted: formatCount(total) })}
      </p>
    </div>
  );
}

function OptionLink({
  href,
  label,
  count,
  selected,
}: {
  href: string;
  label: string;
  count?: number;
  selected: boolean;
}) {
  return (
    <a
      href={href}
      rel={crawlRel(href)}
      aria-current={selected ? "true" : undefined}
      className="group flex items-center gap-2.5 rounded-tag py-0.5 text-body-sm text-body hover:text-ink focus-visible:shadow-focus focus-visible:outline-none"
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-tag border",
          selected ? "border-moss bg-moss text-on-ink" : "border-line-strong bg-card group-hover:border-moss",
        )}
      >
        {selected && <Check size={11} />}
      </span>
      <span className={cn(selected && "font-medium text-ink")}>{label}</span>
      {count !== undefined && (
        <span className="font-mono text-caption tabular-nums text-muted">{formatCount(count)}</span>
      )}
    </a>
  );
}
