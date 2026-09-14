import Link from "next/link";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/**
 * The month picker the render draws as `Aug 2026 ▾`.
 *
 * A disclosure of links rather than a select, so it works with no script, each
 * month is a URL somebody can paste, and the export beside it carries the same
 * `period` the page was opened with. The month in progress is listed and says
 * so, because its figures are not comparable with a whole month.
 */

export interface PeriodOption {
  key: string;
  label: string;
  partial: boolean;
}

export interface PeriodMenuProps {
  current: PeriodOption;
  options: readonly PeriodOption[];
  /** Where a month links to, e.g. `/admin/revenue`. */
  basePath: string;
}

export function PeriodMenu({ current, options, basePath }: PeriodMenuProps) {
  return (
    <details className="relative">
      <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-ctl border border-line bg-card px-3.5 text-body-sm text-ink hover:border-line-strong focus-visible:shadow-focus focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span className="sr-only">{t("admin.revenue.period.label")} </span>
        {current.label}
        <span aria-hidden="true" className="text-caption text-body">
          ▾
        </span>
      </summary>
      <nav
        aria-label={t("admin.revenue.period.label")}
        className="absolute end-0 z-30 mt-1 w-[14rem] rounded-card border border-line bg-card p-2 shadow-overlay"
      >
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {options.map((option) => {
            const active = option.key === current.key;
            return (
              <li key={option.key}>
                <Link
                  href={`${basePath}?period=${option.key}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-tag px-2 py-1.5 text-body-sm focus-visible:shadow-focus focus-visible:outline-none",
                    active ? "bg-ink text-on-ink" : "text-ink hover:bg-fill",
                  )}
                >
                  <span>{option.label}</span>
                  {option.partial ? (
                    <span className={cn("text-caption", active ? "text-on-ink-muted" : "text-body")}>
                      {t("admin.revenue.period.so_far")}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </details>
  );
}
