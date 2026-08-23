import { cn } from "@/lib/cn";
import { Spinner } from "./icons";
import type { ButtonSize, ButtonVariant } from "./Button";

/**
 * A button whose only content is an icon, so the accessible name has to come
 * from somewhere else. `label` is required, not optional — an unlabelled icon
 * button is the most common way a table becomes unusable with a screen reader.
 *
 * The label is also the tooltip, because a lone icon is a guess for sighted
 * users too.
 */
export interface IconButtonProps
  extends Omit<React.ComponentPropsWithoutRef<"button">, "className" | "children"> {
  /** Required. Becomes both aria-label and title. */
  label: string;
  icon: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const SIZE: Record<ButtonSize, string> = {
  sm: "size-8",
  md: "size-9",
  lg: "size-11",
  xl: "size-13",
};

const VARIANT: Record<ButtonVariant, string> = {
  primary: "border-moss bg-moss text-on-ink hover:bg-moss-hover disabled:border-disabled-fill disabled:bg-disabled-fill disabled:text-disabled-text",
  secondary: "border-line-strong bg-card text-ink hover:bg-fill disabled:border-line disabled:bg-fill disabled:text-disabled-text",
  ghost: "border-transparent bg-transparent text-muted hover:bg-fill hover:text-ink disabled:text-disabled-text",
  danger: "border-bad bg-bad text-on-ink hover:bg-bad-hover focus-visible:shadow-focus-danger disabled:border-bad-disabled disabled:bg-bad-disabled disabled:text-bad-disabled-text",
  link: "border-transparent bg-transparent text-moss hover:text-moss-hover disabled:text-disabled-text",
};

export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-ctl border",
        "transition-colors duration-120 ease-out",
        "focus-visible:outline-none focus-visible:shadow-focus",
        "disabled:cursor-not-allowed",
        SIZE[size],
        VARIANT[variant],
      )}
      {...rest}
    >
      {loading ? <Spinner size={15} /> : icon}
    </button>
  );
}
