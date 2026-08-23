"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { controlShell } from "./field-shell";

/**
 * Multi-line text with a character counter.
 *
 * The counter is quiet until it matters: muted while there is room, warn inside
 * the last tenth, bad once over. It never blocks typing — `maxLength` on the
 * element would silently swallow a paste, and a buyer pasting a requirement
 * from an email should see it truncated by their own hand, not by ours.
 */
export interface TextareaProps
  extends Omit<React.ComponentPropsWithoutRef<"textarea">, "className" | "maxLength"> {
  invalid?: boolean;
  /** Shows the counter. Soft — typing past it is allowed and flagged. */
  limit?: number;
  /** `{used} / {limit}`, already localised. */
  counterLabel?: (used: number, limit: number) => string;
  rows?: number;
}

export function Textarea({
  invalid = false,
  limit,
  counterLabel,
  rows = 4,
  disabled,
  readOnly,
  value,
  defaultValue,
  onChange,
  id,
  ...rest
}: TextareaProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const counterId = `${fieldId}-counter`;

  const controlled = value !== undefined;
  const [internal, setInternal] = useState(String(defaultValue ?? ""));
  const text = controlled ? String(value ?? "") : internal;
  const used = text.length;

  const over = limit !== undefined && used > limit;
  const near = limit !== undefined && !over && used >= limit * 0.9;

  return (
    <div className="w-full">
      <textarea
        id={fieldId}
        rows={rows}
        disabled={disabled}
        readOnly={readOnly}
        value={controlled ? text : undefined}
        defaultValue={controlled ? undefined : defaultValue}
        aria-invalid={invalid || over || undefined}
        aria-describedby={limit !== undefined ? counterId : undefined}
        onChange={(event) => {
          if (!controlled) setInternal(event.target.value);
          onChange?.(event);
        }}
        className={cn(
          controlShell({
            invalid: invalid || over,
            disabled: Boolean(disabled),
            readOnly: Boolean(readOnly),
            auto: true,
          }),
          "resize-y leading-normal",
        )}
        {...rest}
      />
      {limit !== undefined && (
        <div
          id={counterId}
          // Polite: a counter must not interrupt somebody mid-sentence.
          aria-live="polite"
          className={cn(
            "mt-1 text-right font-mono text-eyebrow tabular-nums",
            over ? "text-bad-ink" : near ? "text-warn-ink" : "text-faint",
          )}
        >
          {counterLabel ? counterLabel(used, limit) : `${used} / ${limit}`}
        </div>
      )}
    </div>
  );
}
