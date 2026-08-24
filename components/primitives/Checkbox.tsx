"use client";

import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/cn";
import { Check, Minus } from "./icons";

/**
 * A checkbox, including the indeterminate state the DataTable select-all needs.
 *
 * A checkbox applies on save. A Toggle applies immediately. Never mix the two
 * conventions inside one section — a user who has learned that this panel saves
 * on a button will not go looking for one that did not need pressing.
 *
 * Indeterminate is set on the DOM node, because it is a property and not an
 * attribute and React will not write it for you.
 *
 * The tick and the filled box are driven by `:checked` in CSS, not by the
 * `checked` prop. Reading the prop worked for a controlled checkbox and left an
 * uncontrolled one — `defaultChecked`, or just a user clicking it — permanently
 * blank, because `checked` is undefined in that case and the tick was hidden
 * behind it. Radio was already written this way; this now matches.
 */
export interface CheckboxProps
  extends Omit<React.ComponentPropsWithoutRef<"input">, "className" | "type" | "size"> {
  label?: React.ReactNode;
  /** Some but not all children selected. Overrides the tick with a dash. */
  indeterminate?: boolean;
  /** A line of explanation under the label. */
  description?: string;
  invalid?: boolean;
}

export function Checkbox({
  label,
  indeterminate = false,
  description,
  invalid = false,
  disabled,
  checked,
  id,
  ...rest
}: CheckboxProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <div className="flex items-start gap-2">
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        <input
          ref={ref}
          id={fieldId}
          type="checkbox"
          {...(checked === undefined ? {} : { checked })}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          className={cn(
            "peer size-4 cursor-pointer appearance-none rounded-tag border",
            "transition-colors duration-120 ease-out",
            "focus-visible:outline-none focus-visible:shadow-focus",
            "disabled:cursor-not-allowed",
            invalid ? "border-bad-line-strong bg-card" : "border-line-strong bg-card hover:border-moss",
            // The state, from the DOM rather than from a prop.
            "checked:border-moss checked:bg-moss indeterminate:border-moss indeterminate:bg-moss",
            disabled && "border-line bg-disabled-fill",
          )}
          {...rest}
        />
        <span
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center justify-center",
            disabled ? "text-disabled-text" : "text-on-ink",
            "opacity-0 peer-checked:opacity-100 peer-indeterminate:opacity-100",
          )}
        >
          {indeterminate ? <Minus size={12} /> : <Check size={12} />}
        </span>
      </span>

      {label && (
        <span className="flex flex-col gap-0.5 pt-px">
          <label
            htmlFor={fieldId}
            className={cn(
              "cursor-pointer text-body-sm",
              disabled ? "cursor-not-allowed text-disabled-text" : "text-body",
            )}
          >
            {label}
          </label>
          {description && <span className="text-caption text-muted">{description}</span>}
        </span>
      )}
    </div>
  );
}
