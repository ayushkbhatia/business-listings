import { cn } from "@/lib/cn";

/**
 * A rating, as five squares.
 *
 * Squares rather than stars, and that is not decoration. A star is the shape
 * every directory in this market prints over ratings nobody trusts; the whole
 * argument of `/b/:slug/reviews` is that these were earned through a gate, and
 * borrowing the visual language of the pages that were not is the wrong first
 * impression. Rounded 1.5px corners, filled `--moss` for earned and
 * `--line-strong` for the rest.
 *
 * **No partial mark, ever.** Board 1m: the numeral carries the decimal. A half
 * square is a rendering of 4.6 that a reader has to decode, and it is a lie at
 * any width narrower than the difference between 4.6 and 4.7 — so the marks
 * round to whole and the number beside them is the precise figure.
 *
 * The marks are `aria-hidden`; the accessible name is the sentence the caller
 * passes in `label`. Five filled squares announced one at a time is five
 * announcements of nothing.
 */
export interface RatingMarksProps {
  /** 1–5. Rounded to whole marks; the caller prints the decimal. */
  value: number;
  /** The whole rating as a sentence, e.g. "Rated 4 out of 5". Required. */
  label: string;
  /** 11px on the summary card, 10px in a review row. Board 1m's two sizes. */
  size?: "sm" | "md";
}

const OUT_OF = 5;

const SIZE: Record<NonNullable<RatingMarksProps["size"]>, string> = {
  sm: "size-2.5",
  md: "size-[11px]",
};

export function RatingMarks({ value, label, size = "md" }: RatingMarksProps) {
  const filled = Math.max(0, Math.min(OUT_OF, Math.round(value)));

  return (
    <span className="inline-flex items-center gap-[3px] align-middle" role="img" aria-label={label}>
      {Array.from({ length: OUT_OF }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cn(
            "block rounded-[1.5px]",
            SIZE[size],
            index < filled ? "bg-moss" : "bg-line-strong",
          )}
        />
      ))}
    </span>
  );
}
