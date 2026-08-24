"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

/**
 * The code entry.
 *
 * One input, not six boxes. Six boxes look like the design and behave worse:
 * `autocomplete="one-time-code"` — which is what makes iOS and Android offer
 * the code from the notification, and this flow is mobile-first — fills one
 * field reliably and six erratically. Paste, backspace and a screen reader all
 * behave the way the platform already knows how to make them behave.
 *
 * Length is tolerant on purpose — see OTP_LENGTH in lib/auth/constants.
 */

export function OtpField({
  name = "code",
  label,
  hint,
  invalid = false,
  describedBy,
  autoFocus = false,
  disabled = false,
}: {
  name?: string;
  label: string;
  hint?: string;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const described = [hint ? hintId : null, describedBy].filter(Boolean).join(" ");

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-body-sm text-ink">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        // The one attribute that matters most on this screen.
        autoComplete="one-time-code"
        pattern="[0-9]*"
        minLength={4}
        maxLength={10}
        required
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        {...(described ? { "aria-describedby": described } : {})}
        className={cn(
          "h-12 w-full rounded-ctl border bg-card px-3 text-center font-mono text-h3 tabular-nums text-ink",
          "tracking-[0.4em] focus-visible:shadow-focus focus-visible:outline-none",
          invalid ? "border-bad-line-strong" : "border-line-strong",
          disabled && "cursor-not-allowed bg-disabled-fill text-disabled-text",
        )}
      />
      {hint ? (
        <p id={hintId} className="mt-1.5 text-caption text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
