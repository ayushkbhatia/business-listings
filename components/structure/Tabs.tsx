"use client";

import { cn } from "@/lib/cn";

/**
 * Tabs. Two flavours of the same component: `line` for a page's sections,
 * `enclosed` for a work surface where the tab is closer to a filter.
 *
 * Where the tabs are routes — the storefront's overview, products, branches,
 * reviews — pass `as="a"` with hrefs, so each one is a real link that can be
 * opened in a new tab and appears in history. A tab that is a route and behaves
 * like a button breaks both.
 */
export interface TabItem {
  key: string;
  label: string;
  href?: string;
  /** A count beside the label — an inbox, a queue. */
  badge?: number;
  disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  active: string;
  onChange?: (key: string) => void;
  /** Required: a tablist needs a name. */
  label: string;
  variant?: "line" | "enclosed";
  as?: "button" | "a";
}

export function Tabs({ items, active, onChange, label, variant = "line", as = "button" }: TabsProps) {
  const enabled = items.filter((i) => !i.disabled);

  function move(direction: 1 | -1) {
    const index = enabled.findIndex((i) => i.key === active);
    const next = enabled[(index + direction + enabled.length) % enabled.length];
    if (next) onChange?.(next.key);
  }

  return (
    <div
      role={as === "button" ? "tablist" : undefined}
      aria-label={label}
      onKeyDown={
        as === "button"
          ? (event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(1);
              }
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(-1);
              }
            }
          : undefined
      }
      className={cn(
        "flex items-stretch gap-1 overflow-x-auto",
        variant === "line" && "border-b border-line",
      )}
    >
      {items.map((item) => {
        const isActive = item.key === active;
        const inner = (
          <>
            {item.label}
            {item.badge !== undefined && item.badge > 0 && (
              <span
                className={cn(
                  "ml-1.5 rounded-pill px-1.5 py-px font-mono text-eyebrow tabular-nums",
                  isActive ? "bg-moss text-on-ink" : "bg-fill text-muted",
                )}
              >
                {item.badge}
              </span>
            )}
          </>
        );

        const classes = cn(
          "inline-flex shrink-0 items-center whitespace-nowrap px-3 py-2 text-body-sm",
          "transition-colors duration-120 ease-out",
          "focus-visible:outline-none focus-visible:shadow-focus",
          item.disabled && "pointer-events-none text-disabled-text",
          variant === "line"
            ? cn(
                "-mb-px border-b-2",
                isActive
                  ? "border-moss text-ink"
                  : "border-transparent text-muted hover:border-line-strong hover:text-ink",
              )
            : cn(
                "rounded-ctl border",
                isActive
                  ? "border-[1.5px] border-moss bg-moss-wash text-moss-deep"
                  : "border-transparent text-muted hover:bg-fill hover:text-ink",
              ),
        );

        if (as === "a") {
          return (
            <a
              key={item.key}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={classes}
            >
              {inner}
            </a>
          );
        }

        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange?.(item.key)}
            className={classes}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}
