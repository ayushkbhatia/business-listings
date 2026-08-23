"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * A numeric range, as two native sliders sharing one track.
 *
 * Two real <input type="range"> elements rather than a div with drag handlers:
 * arrow keys, Home, End and Page Up all work for free, and they are how anyone
 * filtering by lead time on a keyboard will actually use this.
 *
 * The value is always shown as text beside the track. A slider whose position
 * is the only readout is unusable for anyone who cannot see it, and imprecise
 * for everyone else.
 */
export interface RangeSliderProps {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  /** Accessible names for the two thumbs. */
  minLabel: string;
  maxLabel: string;
  /** Renders the current pair, e.g. "7 – 28 days". */
  formatValue?: (value: [number, number]) => string;
  disabled?: boolean;
}

export function RangeSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  minLabel,
  maxLabel,
  formatValue,
  disabled = false,
}: RangeSliderProps) {
  const id = useId();
  const [low, high] = value;
  const span = max - min || 1;
  const leftPct = ((low - min) / span) * 100;
  const rightPct = ((high - min) / span) * 100;

  const thumb = cn(
    "pointer-events-none absolute inset-x-0 top-1/2 h-5 w-full -translate-y-1/2 appearance-none bg-transparent",
    "focus-visible:outline-none",
    "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-4",
    "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-pill",
    "[&::-webkit-slider-thumb]:border-[1.5px] [&::-webkit-slider-thumb]:border-moss",
    "[&::-webkit-slider-thumb]:bg-card",
    "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-4",
    "[&::-moz-range-thumb]:rounded-pill [&::-moz-range-thumb]:border-[1.5px]",
    "[&::-moz-range-thumb]:border-moss [&::-moz-range-thumb]:bg-card",
    "focus-visible:[&::-webkit-slider-thumb]:shadow-focus",
    "focus-visible:[&::-moz-range-thumb]:shadow-focus",
    disabled && "[&::-webkit-slider-thumb]:border-line-strong [&::-moz-range-thumb]:border-line-strong",
  );

  return (
    <div className="w-full">
      <div className="relative h-5">
        <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-pill bg-track" />
        <span
          className={cn(
            "absolute top-1/2 h-1 -translate-y-1/2 rounded-pill",
            disabled ? "bg-disabled-fill" : "bg-moss",
          )}
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
        />
        <input
          id={`${id}-min`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={low}
          disabled={disabled}
          aria-label={minLabel}
          aria-valuetext={String(low)}
          onChange={(event) => onChange([Math.min(Number(event.target.value), high), high])}
          className={thumb}
        />
        <input
          id={`${id}-max`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={high}
          disabled={disabled}
          aria-label={maxLabel}
          aria-valuetext={String(high)}
          onChange={(event) => onChange([low, Math.max(Number(event.target.value), low)])}
          className={thumb}
        />
      </div>

      <div
        className={cn(
          "mt-1 font-mono text-caption tabular-nums",
          disabled ? "text-disabled-text" : "text-muted",
        )}
      >
        {formatValue ? formatValue(value) : `${low} – ${high}`}
      </div>
    </div>
  );
}
