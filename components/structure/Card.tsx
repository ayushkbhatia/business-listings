import { cn } from "@/lib/cn";

/**
 * A discrete object on the page — one listing, one product, one plan.
 *
 * `--card` is a raised surface and never a page background, so a Card always
 * sits on paper. Elevation is flat by default: a 1px line is the design
 * system's default and a shadow is reserved for something that has genuinely
 * lifted off the page.
 *
 * `promoted` is one per screen. It is what marks the recommended plan or the
 * sponsored slot, and its meaning dies the moment there are two.
 *
 * `surface="paper"` is the inversion board 6a draws for its first result. A
 * `--card` section is white, so a white card inside one is invisible; the row
 * the page is recommending takes `--paper` and the stronger line instead. It is
 * not the selection treatment — selection is moss, it means "you picked this",
 * and rank 1 is the page's opinion rather than the reader's.
 */
export type CardElevation = "flat" | "raised" | "promoted";

export interface CardProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "className"> {
  elevation?: CardElevation;
  /** Renders as <article> where the card is a self-contained thing. */
  as?: "div" | "article" | "li";
  /** Moss border and tint. The design system's selection treatment. */
  selected?: boolean;
  /**
   * `paper` for a card that has to read as raised against a `--card` section.
   *
   * Never a page background — `--card` remains the raised surface everywhere a
   * card sits on paper, which is everywhere but this inversion.
   */
  surface?: "card" | "paper";
  interactive?: boolean;
  padded?: boolean;
}

const ELEVATION: Record<CardElevation, string> = {
  flat: "border-line",
  raised: "border-line shadow-raised",
  promoted: "border-line-strong shadow-promoted",
};

export function Card({
  elevation = "flat",
  as: Tag = "div",
  selected = false,
  surface = "card",
  interactive = false,
  padded = true,
  children,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-card border",
        surface === "paper" ? "border-line-strong bg-paper" : "bg-card",
        surface === "card" && ELEVATION[elevation],
        padded && "p-4",
        selected && "border-[1.5px] border-moss bg-moss-wash",
        interactive &&
          cn(
            "transition-colors duration-120 ease-out",
            "hover:border-line-strong",
            "focus-within:outline-none focus-within:shadow-focus",
          ),
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
