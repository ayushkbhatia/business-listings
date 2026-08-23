"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import { Minus, Plus } from "./icons";

/**
 * A small integer with two buttons. Quantities on an enquiry line, seats on a
 * plan, a minimum order.
 *
 * The number is a real input, so a buyer ordering 240 valves types 240 rather
 * than pressing a button 240 times. The buttons are for the ±1 case and for
 * touch, and they disable at the bounds rather than silently doing nothing.
 */
export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Accessible name for the field. */
  label: string;
  decrementLabel: string;
  incrementLabel: string;
  /** A unit shown after the number, e.g. "pcs". */
  suffix?: string;
  disabled?: boolean;
  invalid?: boolean;
  size?: "sm" | "md";
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  label,
  decrementLabel,
  incrementLabel,
  suffix,
  disabled = false,
  invalid = false,
  size = "md",
}: StepperProps) {
  const id = useId();
  const h = size === "sm" ? "h-8" : "h-9";
  const btn = size === "sm" ? "size-8" : "size-9";
  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  const button = cn(
    "inline-flex shrink-0 items-center justify-center",
    "text-muted transition-colors duration-120 ease-out",
    "hover:bg-fill hover:text-ink",
    "focus-visible:outline-none focus-visible:shadow-focus",
    "disabled:cursor-not-allowed disabled:text-disabled-text disabled:hover:bg-transparent",
    btn,
  );

  return (
    <div
      className={cn(
        "inline-flex items-center overflow-hidden rounded-ctl border bg-card",
        h,
        invalid ? "border-bad-line-strong" : "border-line-strong",
        disabled && "border-line bg-fill",
      )}
    >
      <button
        type="button"
        aria-label={decrementLabel}
        title={decrementLabel}
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - step))}
        className={cn(button, "border-r border-line")}
      >
        <Minus size={14} />
      </button>

      <input
        id={id}
        type="number"
        inputMode="numeric"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(clamp(next));
        }}
        className={cn(
          "h-full w-14 border-0 bg-transparent text-center font-mono text-body-sm tabular-nums text-ink",
          "outline-none",
          "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          disabled && "text-disabled-text",
        )}
      />

      {suffix && (
        <span
          className={cn(
            "pr-2 font-mono text-caption",
            disabled ? "text-disabled-text" : "text-muted",
          )}
        >
          {suffix}
        </span>
      )}

      <button
        type="button"
        aria-label={incrementLabel}
        title={incrementLabel}
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + step))}
        className={cn(button, "border-l border-line")}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
