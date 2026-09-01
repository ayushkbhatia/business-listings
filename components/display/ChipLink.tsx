import { cn } from "@/lib/cn";

/**
 * A pill that navigates.
 *
 * `FilterChip` is the other one, and they are not the same object. That chip
 * means "this filter is applied, here is how to remove it" — it lives above a
 * results list, it is always removable, and it is moss because it is a thing
 * the buyer did. This one means "here is somewhere to go": the popular searches
 * under the home page's search bar, the emirate row, the free-zone toggle.
 * Merging them would give one component a remove control that half its callers
 * must remember to switch off, which is how a dead X ends up on a link.
 *
 * Three shapes, from board 1a:
 *
 *   `sm`         26px, the popular-search row under the hero.
 *   `md`         32px, the emirate row, which also carries a count.
 *   `selected`   ink fill, for the one emirate a visitor has a preference for.
 *   `dashed`     a cross-cutting filter rather than a place. Free zones are not
 *                an eighth emirate: a JAFZA company is in Dubai *and* in a free
 *                zone, so the control that finds it cannot sit in the same row
 *                as the seven and look like one of them.
 *
 * The count is `--text-muted`, not the `--text-faint` the board draws it in.
 * `--text-faint` measures 2.56:1 on paper and design-system §09.2 sets the floor
 * at 4.5:1 — see docs/contrast.md, where that token is one of ten pairings the
 * project has pinned rather than silently shipped. A new surface does not get
 * to add nodes to that list.
 */
export interface ChipLinkProps
  extends Omit<React.ComponentPropsWithoutRef<"a">, "className" | "children"> {
  href: string;
  children: React.ReactNode;
  /** A live count, rendered in mono beside the label. */
  count?: string;
  size?: "sm" | "md";
  /** Ink fill. One at a time, and only when the visitor has said so. */
  selected?: boolean;
  /** A filter rather than a place. */
  dashed?: boolean;
}

export function ChipLink({
  href,
  children,
  count,
  size = "md",
  selected = false,
  dashed = false,
  ...rest
}: ChipLinkProps) {
  return (
    <a
      href={href}
      aria-current={selected ? "true" : undefined}
      {...rest}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-pill whitespace-nowrap border",
        "transition-colors duration-120 ease-out",
        "focus-visible:outline-none focus-visible:shadow-focus",
        size === "sm" ? "h-[26px] px-2.5 text-caption" : "h-8 px-3.5 text-body-sm",
        selected
          ? "border-ink-surface bg-ink-surface font-medium text-on-ink hover:border-ink-line"
          : cn(
              "bg-card text-body hover:border-line-strong hover:text-ink",
              dashed ? "border-dashed border-line-strong" : "border-line",
            ),
      )}
    >
      {children}
      {count !== undefined && (
        <span
          className={cn(
            "font-mono text-eyebrow tabular-nums",
            selected ? "text-on-ink-muted" : "text-muted",
          )}
        >
          {count}
        </span>
      )}
    </a>
  );
}
