"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./icons";

/**
 * A toggle applies immediately. A checkbox applies on save. Never mix the two
 * in one section.
 *
 * Because it applies immediately it can fail, so it carries a pending state:
 * the switch moves optimistically and the spinner says the server has not
 * agreed yet. A toggle that silently reverts three seconds later is worse than
 * one that never moved.
 *
 * role="switch" rather than a checkbox: the announcement is "on"/"off", which
 * is what the control means.
 */
export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: string;
  /** Hide the label visually where the surrounding row already names it. */
  hideLabel?: boolean;
  disabled?: boolean;
  pending?: boolean;
  size?: "sm" | "md";
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  hideLabel = false,
  disabled = false,
  pending = false,
  size = "md",
}: ToggleProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = `${id}-description`;
  const track = size === "sm" ? "h-4 w-7" : "h-5 w-9";
  const knob = size === "sm" ? "size-3" : "size-4";
  const travel = size === "sm" ? "translate-x-3" : "translate-x-4";

  return (
    <div className="flex items-start gap-2.5">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        // <label for> only binds to a labelable element, and a button is not
        // one. Pointing at the text explicitly is the only thing that actually
        // gives this control a name.
        aria-labelledby={hideLabel ? undefined : labelId}
        aria-label={hideLabel && typeof label === "string" ? label : undefined}
        aria-describedby={description && !hideLabel ? descriptionId : undefined}
        aria-busy={pending || undefined}
        disabled={disabled || pending}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-px inline-flex shrink-0 items-center rounded-pill border",
          "transition-colors duration-120 ease-out",
          "focus-visible:outline-none focus-visible:shadow-focus",
          "disabled:cursor-not-allowed",
          track,
          checked ? "border-moss bg-moss" : "border-line-strong bg-track",
          disabled && "border-line bg-disabled-fill",
        )}
      >
        <span
          className={cn(
            "pointer-events-none ml-0.5 flex items-center justify-center rounded-pill bg-card",
            "transition-transform duration-120 ease-out",
            knob,
            checked && travel,
            disabled && "bg-paper-sunk",
          )}
        >
          {pending && <Spinner size={10} className="text-muted" />}
        </span>
      </button>

      {!hideLabel && (
        <span className="flex flex-col gap-0.5">
          <span
            id={labelId}
            // Clicking the text flips the switch, matching what a real <label>
            // would do. The switch itself remains the keyboard target.
            onClick={() => {
              if (!disabled && !pending) onChange(!checked);
            }}
            className={cn(
              "text-body-sm",
              disabled ? "cursor-not-allowed text-disabled-text" : "cursor-pointer text-body",
            )}
          >
            {label}
          </span>
          {description && (
            <span id={descriptionId} className="text-caption text-muted">
              {description}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
