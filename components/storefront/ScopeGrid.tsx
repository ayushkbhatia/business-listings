import Link from "next/link";
import { serviceFieldValue } from "@/components/domain/service-views";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { picks, type SectionProps } from "@/lib/storefront/render-data";
import { readSettings } from "@/lib/storefront/section-settings";

/** Rows past this link to the services tab rather than growing the page. */
export const SCOPE_GRID_ROWS = 12;

/**
 * Board `5c-s` — the scope grid.
 *
 * `1e-s`'s rows, available as a section: a service, its deliverable line, and
 * the columns the template chose from the same four fields in the same words.
 * A view over the seller's scope sheets and nothing else (B2). There is no
 * prop a fee amount could arrive in, and the loader behind `data.work` does not
 * select one.
 *
 * **Gaps read *Not stated*** (B6), never a blank cell and never a dropped row —
 * this table is read down its columns, and a missing cell moves every cell
 * after it.
 *
 * **Order is the public list's** (B8): 90-day enquiry volume, seller order
 * breaking ties, as the loader returns it. A seller's picks narrow the rows;
 * they do not reorder them.
 */
export function ScopeGrid({ section, data, content, preview }: SectionProps) {
  const { columns } = readSettings("scope_grid", section.settings);
  const all = data.work?.services ?? [];
  const chosen = picks(content, "services");
  const services = chosen.length > 0 ? all.filter((service) => chosen.includes(service.id)) : all;
  const shown = services.slice(0, SCOPE_GRID_ROWS);
  const name = data.business.displayName;

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h2 text-brand-ink">{t("section.scope_grid.title")}</h2>
        {services.length > shown.length && (
          <Link
            href={`/b/${data.business.slug}/services`}
            className="rounded-tag text-body-sm text-ink underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("storefront_services.all_services", {
              count: services.length,
              formatted: formatCount(services.length),
            })}
          </Link>
        )}
      </div>

      {shown.length === 0 ? (
        /*
           Said, never hidden — the board's *no services published* state. A
           seller previewing needs to see what the section will do; a buyer on
           the storefront reads `1d-s`'s cold-start line, because the firm is
           still taking enquiries.
        */
        <p className="mt-3 max-w-[var(--measure-prose)] text-body-sm text-muted">
          {preview ? t("section.scope_grid.empty_preview") : t("storefront_services.services_none", { name })}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-card border border-line bg-card">
          <table className="w-full min-w-[36rem] border-collapse text-body-sm">
            <caption className="sr-only">{t("section.scope_grid.caption", { name })}</caption>
            <thead>
              <tr className="border-b border-line bg-paper-sunk">
                <th
                  scope="col"
                  className="py-2.5 pe-4 ps-5 text-start font-mono text-colhead font-normal uppercase text-muted"
                >
                  {t("storefront_services.coverage_col_service")}
                </th>
                {columns.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="w-[18%] py-2.5 pe-5 text-start font-mono text-colhead font-normal uppercase text-muted"
                  >
                    {t(`storefront_services.field.${column}` as "storefront_services.field.engagement")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((service) => (
                <tr key={service.id} className="border-b border-line last:border-b-0">
                  <th scope="row" className="py-3.5 pe-4 ps-5 text-start align-top font-normal">
                    <Link
                      href={`/b/${data.business.slug}/s/${service.slug}`}
                      className="rounded-tag font-medium text-ink underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                    >
                      {service.name}
                    </Link>
                    {service.scope && (
                      <span className="mt-1 line-clamp-2 block max-w-[var(--measure-prose)] text-body-sm text-body">
                        {service.scope}
                      </span>
                    )}
                  </th>
                  {columns.map((column) => {
                    const value = serviceFieldValue(column, service);
                    return (
                      <td
                        key={column}
                        className={cn("py-3.5 pe-5 align-top", value === null ? "text-muted" : "text-body")}
                      >
                        {value ?? t("storefront_services.not_stated")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
