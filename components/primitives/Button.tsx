import { cn } from "@/lib/cn";
import { Spinner } from "./icons";

/**
 * Five variants, four sizes, five states. Variants are props on one component —
 * `<Button variant="danger">`, never `<DangerButton>`.
 *
 * Sizes are an explicit axis here and only here. Density is inherited from the
 * shell via data-density; a component never takes a size prop for density.
 *
 * Loading keeps the button's width so a row does not reflow mid-request, and
 * keeps the label readable rather than replacing it with a bare spinner: a
 * seller who has clicked "Send quote" should still be able to see what they
 * clicked.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg" | "xl";

export interface ButtonProps extends Omit<React.ComponentPropsWithoutRef<"button">, "className"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Rendered before the label. Decorative — the label carries the meaning. */
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  /** Fills its container. For a mobile action bar or a single-column form. */
  block?: boolean;
}

const BASE = cn(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-ctl",
  "border font-medium",
  "transition-colors duration-120 ease-out",
  "focus-visible:outline-none focus-visible:shadow-focus",
  "disabled:cursor-not-allowed",
);

const VARIANT: Record<ButtonVariant, string> = {
  // Moss marks action and nothing else.
  primary: cn(
    "border-moss bg-moss text-on-ink",
    "hover:border-moss-hover hover:bg-moss-hover",
    "disabled:border-disabled-fill disabled:bg-disabled-fill disabled:text-disabled-text",
  ),
  secondary: cn(
    "border-line-strong bg-card text-ink",
    "hover:border-line-strong hover:bg-fill",
    "disabled:border-line disabled:bg-fill disabled:text-disabled-text",
  ),
  ghost: cn(
    "border-transparent bg-transparent text-body",
    "hover:bg-fill hover:text-ink",
    "disabled:bg-transparent disabled:text-disabled-text",
  ),
  danger: cn(
    "border-bad bg-bad text-on-ink",
    "hover:border-bad-hover hover:bg-bad-hover",
    // A danger control focuses in its own status colour, not in moss.
    "focus-visible:shadow-focus-danger",
    "disabled:border-bad-disabled disabled:bg-bad-disabled disabled:text-bad-disabled-text",
  ),
  link: cn(
    "h-auto border-transparent bg-transparent p-0 text-moss underline-offset-4",
    "hover:text-moss-hover hover:underline",
    "disabled:text-disabled-text disabled:no-underline",
  ),
};

/**
 * The accessibility floor is 32px on desktop and 44px on mobile. `sm` sits on
 * the desktop floor exactly; anything smaller belongs to IconButton inside a
 * table row, where the row itself is the target.
 */
const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-caption",
  md: "h-9 px-3.5 text-body-sm",
  lg: "h-11 px-5 text-body",
  xl: "h-13 px-6 text-h3",
};

/**
 * The same clothes, for something that is not a button.
 *
 * An anchor that looks like a button must stay an anchor: it navigates, it
 * opens in a new tab on a middle click, and a screen reader announces it as a
 * link. Making Button polymorphic would let a caller put an href on something
 * that submits a form, which is the mistake this avoids by keeping the two
 * elements separate and sharing only the paint.
 *
 *   <Link href="/rfq/new" className={buttonClassName({ block: true })}>
 */
export function buttonClassName({
  variant = "primary",
  size = "md",
  block = false,
}: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean } = {}): string {
  return cn(BASE, VARIANT[variant], variant === "link" ? undefined : SIZE[size], block && "w-full");
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  leadingIcon,
  trailingIcon,
  block = false,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      // Loading is a busy state, not a disabled one, for anyone listening.
      aria-busy={loading || undefined}
      className={buttonClassName({ variant, size, block })}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : leadingIcon}
      {children}
      {!loading && trailingIcon}
    </button>
  );
}
