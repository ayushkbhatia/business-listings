import { cn } from "@/lib/cn";

/**
 * Shared shell for every text-entry control, so an Input, a Textarea, a Select
 * and a SearchField cannot drift apart by a pixel.
 *
 * Not a component — a control that wraps its own children in a div loses the
 * ability to be a real <input>, and the design system's rule about real markup
 * applies to forms as much as to tables.
 */
export type ControlSize = "sm" | "md" | "lg";

export const CONTROL_HEIGHT: Record<ControlSize, string> = {
  sm: "h-8",
  md: "h-9",
  lg: "h-11",
};

export const CONTROL_TEXT: Record<ControlSize, string> = {
  sm: "text-caption",
  md: "text-body-sm",
  lg: "text-body",
};

export function controlShell(opts: {
  size?: ControlSize;
  invalid?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** Extra left padding for a leading icon. */
  hasLeading?: boolean;
  hasTrailing?: boolean;
  /** Textarea sets its own height. */
  auto?: boolean;
}): string {
  const { size = "md", invalid, disabled, readOnly, hasLeading, hasTrailing, auto } = opts;

  return cn(
    "w-full rounded-ctl border bg-card text-ink",
    "placeholder:text-faint",
    "transition-colors duration-120 ease-out",
    "focus-visible:outline-none",
    auto ? "py-2" : CONTROL_HEIGHT[size],
    CONTROL_TEXT[size],
    hasLeading ? "pl-8" : "pl-3",
    hasTrailing ? "pr-8" : "pr-3",
    invalid
      ? "border-bad-line-strong focus:border-bad focus:shadow-focus-danger"
      : "border-line-strong focus:border-moss focus:shadow-focus",
    readOnly && "bg-paper-sunk text-body",
    disabled && "cursor-not-allowed border-line bg-fill text-disabled-text placeholder:text-disabled-text",
  );
}
