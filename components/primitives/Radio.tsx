"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * One of a set. A radio never unselects itself, so a group needs a real default
 * or an explicit "no preference" option — never an empty group that silently
 * submits nothing.
 *
 * RadioGroup renders the fieldset and legend, because a set of radios without
 * one is announced as loose controls with no question attached.
 */
export interface RadioProps
  extends Omit<React.ComponentPropsWithoutRef<"input">, "className" | "type" | "size"> {
  label: React.ReactNode;
  description?: string;
}

export function Radio({ label, description, disabled, id, ...rest }: RadioProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className="flex items-start gap-2">
      <span className="relative flex size-5 shrink-0 items-center justify-center">
        <input
          id={fieldId}
          type="radio"
          disabled={disabled}
          className={cn(
            "peer size-4 cursor-pointer appearance-none rounded-pill border bg-card",
            "transition-colors duration-120 ease-out",
            "focus-visible:outline-none focus-visible:shadow-focus",
            "checked:border-moss",
            "disabled:cursor-not-allowed disabled:border-line disabled:bg-disabled-fill",
            "border-line-strong hover:border-moss",
          )}
          {...rest}
        />
        <span
          className={cn(
            "pointer-events-none absolute size-2 rounded-pill",
            "opacity-0 peer-checked:opacity-100",
            disabled ? "bg-disabled-text" : "bg-moss",
          )}
        />
      </span>

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
    </div>
  );
}

export interface RadioGroupProps {
  legend: string;
  children: React.ReactNode;
  /** Laid out in a row where the options are short. */
  orientation?: "vertical" | "horizontal";
  hint?: string;
}

export function RadioGroup({ legend, children, orientation = "vertical", hint }: RadioGroupProps) {
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-1.5 text-caption font-medium text-body">{legend}</legend>
      {hint && <p className="mb-1.5 text-caption text-muted">{hint}</p>}
      <div className={cn("flex gap-3", orientation === "vertical" ? "flex-col" : "flex-row flex-wrap")}>
        {children}
      </div>
    </fieldset>
  );
}
