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
  size?: "sm" | "md" | "lg";
  /** On a dark surface. */
  onInk?: boolean;
}

const SIZE = {
  sm: "size-6 text-eyebrow",
  md: "size-8 text-caption",
  lg: "size-11 text-body-sm",
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
