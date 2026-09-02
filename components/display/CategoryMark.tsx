import { cn } from "@/lib/cn";

/**
 * The two-letter mono mark a category carries — `VF`, `PT`, `IN`.
 *
 * It stands in for a logo the platform does not have and will not invent. Two
 * letters from the taxonomy, never initials generated from a business name:
 * a mark that means "valves and fittings" is useful, one that means
 * "Al Marwan" is a worse version of the name already on screen.
 */
export interface CategoryMarkProps {
  /** The category's two-letter code from the database. */
  code: string;
  size?: "sm" | "md" | "lg" | "xl";
  /** On a dark surface. */
  onInk?: boolean;
}

/*
 * The four sizes the boards actually draw.
 *
 * `md` and `lg` are 30px and 34px because board 6c's sector header and board
 * 1a's category card are 30px and 34px. The scale used to be 24 / 32 / 44,
 * which offered neither, so the home page reached for `lg` and rendered a 44px
 * mark where the board specified 34 — the kind of drift that is invisible on
 * one page and obvious across five.
 *
 * `xl` keeps the old 44px for `LogoTile`, whose fallback mark stands in for a
 * logo tile rather than sitting beside a name.
 */
const SIZE = {
  sm: "size-6 text-eyebrow",
  md: "size-[30px] text-eyebrow",
  lg: "size-[34px] text-caption",
  xl: "size-11 text-body-sm",
} as const;

export function CategoryMark({ code, size = "md", onInk = false }: CategoryMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-chip border font-mono uppercase",
        SIZE[size],
        onInk ? "border-ink-line bg-ink-raised text-on-ink-muted" : "border-line bg-paper-sunk text-muted",
      )}
    >
      {code.slice(0, 2)}
    </span>
  );
}
