import { cn } from "@/lib/cn";

/**
 * Where you are in the directory tree. Also the thing Google reads as
 * BreadcrumbList, so every crumb bar the last is a real link.
 *
 * The last crumb is the current page and is not a link — a link to where you
 * already are is noise, and aria-current says so.
 */
export interface Crumb {
  label: string;
  href?: string;
}

export interface BreadcrumbProps {
  items: readonly Crumb[];
  /** Required: several breadcrumbs can appear on one page. */
  label: string;
  /** Collapses the middle past this many crumbs. */
  maxItems?: number;
}

export function Breadcrumb({ items, label, maxItems = 4 }: BreadcrumbProps) {
  const collapsed =
    items.length > maxItems
      ? [items[0]!, { label: "…" } as Crumb, ...items.slice(items.length - (maxItems - 2))]
      : items;

  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-1.5">
        {collapsed.map((item, i) => {
          const last = i === collapsed.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && (
                <span aria-hidden="true" className="text-faint">
                  /
                </span>
              )}
              {item.href && !last ? (
                <a
                  href={item.href}
                  className={cn(
                    "rounded-tag text-caption text-muted underline-offset-2",
                    "transition-colors duration-120 ease-out hover:text-ink hover:underline",
                    "focus-visible:outline-none focus-visible:shadow-focus",
                  )}
                >
                  {item.label}
                </a>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={cn("text-caption", last ? "text-body" : "text-faint")}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
