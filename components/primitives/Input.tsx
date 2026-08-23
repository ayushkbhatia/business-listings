import { cn } from "@/lib/cn";
import { controlShell, type ControlSize } from "./field-shell";

/**
 * A single-line text input.
 *
 * `invalid` is a prop rather than something the component works out, because
 * validation timing belongs to the form: format errors on blur, required-field
 * errors on submit, then revalidate as the user types once a field has failed.
 * A control that validated on every keystroke would fight that rule.
 *
 * A trailing adornment is for a unit or a suffix — `mm`, `AED`, `%`. Not for a
 * button; a control with an action inside it is a SearchField or a Stepper.
 */
export interface InputProps
  extends Omit<React.ComponentPropsWithoutRef<"input">, "className" | "size"> {
  size?: ControlSize;
  invalid?: boolean;
  leadingIcon?: React.ReactNode;
  /** A unit or suffix, e.g. `mm`. Rendered in mono, never interactive. */
  suffix?: string;
  /** Machine strings — SKU, TRN, licence number — render in mono. */
  mono?: boolean;
}

export function Input({
  size = "md",
  invalid = false,
  leadingIcon,
  suffix,
  mono = false,
  disabled,
  readOnly,
  type = "text",
  ...rest
}: InputProps) {
  return (
    <div className="relative w-full">
      {leadingIcon && (
        <span
          className={cn(
            "pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2",
            disabled ? "text-disabled-text" : "text-faint",
          )}
        >
          {leadingIcon}
        </span>
      )}
      <input
        type={type}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={invalid || undefined}
        className={cn(
          controlShell({
            size,
            invalid,
            disabled: Boolean(disabled),
            readOnly: Boolean(readOnly),
            hasLeading: Boolean(leadingIcon),
            hasTrailing: Boolean(suffix),
          }),
          mono && "font-mono",
        )}
        {...rest}
      />
      {suffix && (
        <span
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2",
            "font-mono text-caption",
            disabled ? "text-disabled-text" : "text-muted",
          )}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}
