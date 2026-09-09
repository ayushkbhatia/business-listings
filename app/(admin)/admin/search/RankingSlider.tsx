"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * One weight, as a native range input with its number beside it.
 *
 * Board-local rather than a design-system primitive. `RangeSlider` is the
 * two-thumb filter control and this is not a variant of it: it carries a
 * ceiling marker that only means something where a weight has a cap, and the
 * inventory in §09.3 is a canvas decision rather than a file count.
 *
 * A real `<input type="range">` so that arrow keys, Home, End and Page Up all
 * work without being reimplemented, and the value is always shown as text: a
 * slider whose position is the only readout is unusable for anyone who cannot
 * see it and imprecise for everyone else.
 */
export interface RankingSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  max?: number;
  /** Drawn on the track and enforced elsewhere. Plan tier is the only one. */
  ceiling?: number;
  /** "pinned", "pinned, ceiling 10" — sits beside the label, never a tooltip. */
  hint?: string;
  /** A line under the track. The reason a number is what it is. */
  note?: string;
  disabled?: boolean;
  /** Announced with the value, for a weight whose cap has been reached. */
  describedBy?: string;
}

export function RankingSlider({
  label,
  value,
  onChange,
  max = 100,
  ceiling,
  hint,
  note,
  disabled = false,
  describedBy,
}: RankingSliderProps) {
  const id = useId();
  const filled = Math.max(0, Math.min(100, (value / max) * 100));
  const capAt = ceiling === undefined ? null : Math.max(0, Math.min(100, (ceiling / max) * 100));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-caption font-medium text-ink">
          {label}
          {/*
             The separator is inside the text, not made of margin. An accessible
             name is a concatenation with no spacing, so a margin-only gap reads
             as "Plan tier· pinned, ceiling 10" to anything that listens rather
             than looks — and to the locators that assert on it.
          */}
          {hint && <span className="font-normal text-body">{" · "}{hint}</span>}
        </label>
        <span className="font-mono text-body-sm tabular-nums text-ink">{value}</span>
      </div>

      <div className="relative h-5">
        {/* The track. `aria-hidden` because the input below carries the value. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-pill bg-track"
        >
          <div
            className={cn("h-full rounded-pill", disabled ? "bg-line-strong" : "bg-moss")}
            style={{ width: `${filled}%` }}
          />
          {capAt !== null && (
            <span
              className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-line-strong"
              style={{ left: `${capAt}%` }}
            />
          )}
        </div>

        <input
          id={id}
          type="range"
          min={0}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          aria-describedby={describedBy}
          onChange={(event) => onChange(Number(event.target.value))}
          className={cn(
            "absolute inset-x-0 top-1/2 h-5 w-full -translate-y-1/2 appearance-none bg-transparent",
            "focus-visible:outline-none",
            "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none",
            "[&::-webkit-slider-thumb]:rounded-pill [&::-webkit-slider-thumb]:border-[1.5px]",
            "[&::-webkit-slider-thumb]:border-moss [&::-webkit-slider-thumb]:bg-card",
            "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-pill",
            "[&::-moz-range-thumb]:border-[1.5px] [&::-moz-range-thumb]:border-moss",
            "[&::-moz-range-thumb]:bg-card",
            "focus-visible:[&::-webkit-slider-thumb]:shadow-focus",
            "focus-visible:[&::-moz-range-thumb]:shadow-focus",
            disabled &&
              "cursor-not-allowed [&::-moz-range-thumb]:border-line-strong [&::-webkit-slider-thumb]:border-line-strong",
          )}
        />
      </div>

      {note && <p className="max-w-prose text-caption text-body">{note}</p>}
    </div>
  );
}
