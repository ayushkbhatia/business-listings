import { cn } from "@/lib/cn";
import { ChevronDown } from "./icons";
import { controlShell, type ControlSize } from "./field-shell";

/**
 * A native <select>.
 *
 * Deliberately native, not a custom listbox. On a phone in a warehouse this
 * gets the platform picker, which is the thing a buyer already knows how to
 * use with one thumb. MultiSelect is custom because the platform has no
 * multi-select worth having; a single select does.
 *
 * The placeholder option is disabled, so it cannot be chosen back.
 */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<React.ComponentPropsWithoutRef<"select">, "className" | "size" | "children"> {
  options: readonly SelectOption[];
  /** Shown first and unselectable, e.g. "Choose an emirate". */
  placeholder?: string;
  size?: ControlSize;
  invalid?: boolean;
  /** Optional grouping. Options carry no group when this is absent. */
  groups?: { label: string; options: readonly SelectOption[] }[];
}

export function Select({
  options,
  placeholder,
  size = "md",
  invalid = false,
  disabled,
  groups,
  value,
  defaultValue,
  ...rest
}: SelectProps) {
  return (
    <div className="relative w-full">
      <select
        disabled={disabled}
        aria-invalid={invalid || undefined}
        value={value}
        defaultValue={defaultValue ?? (placeholder ? "" : undefined)}
        className={cn(
          controlShell({ size, invalid, disabled: Boolean(disabled), hasTrailing: true }),
          "appearance-none",
          // A placeholder still showing is not a value; it reads as one.
          !value && !defaultValue && placeholder ? "text-faint" : undefined,
        )}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {groups
          ? groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))
          : options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
      </select>
      <ChevronDown
        size={14}
        className={cn(
          "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2",
          disabled ? "text-disabled-text" : "text-muted",
        )}
      />
    </div>
  );
}
