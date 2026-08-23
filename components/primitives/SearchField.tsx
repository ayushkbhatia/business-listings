"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { Close, Search, Spinner } from "./icons";
import { controlShell, type ControlSize } from "./field-shell";

/**
 * The search input. It sits in the public nav bar, in the table toolbar and in
 * the filter rail, so it has to hold up at three sizes on three surfaces.
 *
 * type="search" gives mobile keyboards a Search key. The clear button appears
 * only when there is something to clear, and is a real button so it can be
 * tabbed to — a clear affordance that only works with a mouse strands anyone
 * who filled the field by keyboard.
 */
export interface SearchFieldProps
  extends Omit<React.ComponentPropsWithoutRef<"input">, "className" | "size" | "type"> {
  size?: ControlSize;
  /** Accessible name. The magnifier is decorative. */
  label: string;
  /** Accessible name for the clear button. */
  clearLabel: string;
  onClear?: () => void;
  /** Shows a spinner in place of the magnifier while results are in flight. */
  loading?: boolean;
}

export function SearchField({
  size = "md",
  label,
  clearLabel,
  onClear,
  loading = false,
  disabled,
  value,
  defaultValue,
  onChange,
  id,
  ...rest
}: SearchFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  const controlled = value !== undefined;
  const [internal, setInternal] = useState(String(defaultValue ?? ""));
  const text = controlled ? String(value ?? "") : internal;
  const hasText = text.length > 0;

  return (
    <div className="relative w-full">
      <span
        className={cn(
          "pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2",
          disabled ? "text-disabled-text" : "text-faint",
        )}
      >
        {loading ? <Spinner size={14} /> : <Search size={14} />}
      </span>

      <input
        id={fieldId}
        type="search"
        aria-label={label}
        disabled={disabled}
        value={controlled ? text : undefined}
        defaultValue={controlled ? undefined : defaultValue}
        onChange={(event) => {
          if (!controlled) setInternal(event.target.value);
          onChange?.(event);
        }}
        className={cn(
          controlShell({
            size,
            disabled: Boolean(disabled),
            hasLeading: true,
            hasTrailing: hasText,
          }),
          // The platform clear affordance is inconsistent and unlabelled.
          "[&::-webkit-search-cancel-button]:appearance-none",
        )}
        {...rest}
      />

      {hasText && !disabled && (
        <button
          type="button"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={() => {
            if (!controlled) setInternal("");
            onClear?.();
          }}
          className={cn(
            "absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center",
            "rounded-chip text-muted",
            "transition-colors duration-120 ease-out",
            "hover:bg-fill hover:text-ink",
            "focus-visible:outline-none focus-visible:shadow-focus",
          )}
        >
          <Close size={12} />
        </button>
      )}
    </div>
  );
}
