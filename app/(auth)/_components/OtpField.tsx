"use client";

import { useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * The code entry — six boxes, as board 7a draws them, over one real input.
 *
 * Six real inputs look like the design and behave worse:
 * `autocomplete="one-time-code"` — which is what makes iOS and Android offer the
 * code from the notification, and this flow is mobile-first — fills one field
 * reliably and six erratically, and paste, backspace and a screen reader each
 * need re-implementing across six. So there is one input, transparent and laid
 * over the row, and the boxes are a drawing of its value. The platform handles
 * everything the platform knows how to handle.
 *
 * **The row grows past six.** Supabase's code length is a project setting, and
 * the hosted project was issuing eight when this was written
 * (docs/auth-whatsapp-otp.md). Six boxes that silently truncated an eight-digit
 * code would lock everybody out, so the input takes four to ten digits and the
 * row draws as many boxes as it holds, never fewer than `length`.
 */

const MAX_DIGITS = 10;

export function OtpField({
  name = "code",
  label,
  hint,
  length = 6,
  invalid = false,
  autoFocus = false,
  disabled = false,
}: {
  name?: string;
  /** Visually hidden: the heading says what this is. Screen readers still hear it. */
  label: string;
  hint?: string;
  length?: number;
  invalid?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const boxes = Math.min(MAX_DIGITS, Math.max(length, value.length));
  const active = Math.min(value.length, boxes - 1);

  return (
    <div>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div
        // A width of its own rather than its parent's: in a row that sizes to
        // content, `w-full` resolves to nothing and six boxes become six lines.
        className={cn("relative max-w-full", boxes > length ? "w-[28rem]" : "w-[21rem]")}
        onClick={() => input.current?.focus()}
      >
        <div className="flex gap-2" aria-hidden="true">
          {Array.from({ length: boxes }, (_, index) => {
            const digit = value[index] ?? "";
            const current = focused && index === active && !disabled;
            return (
              <span
                key={index}
                className={cn(
                  "flex h-14 min-w-0 flex-1 basis-0 items-center justify-center rounded-ctl border bg-card font-mono text-h2 tabular-nums text-ink",
                  "transition-colors duration-120 ease-out",
                  invalid ? "border-bad-line-strong" : current ? "border-ink" : "border-line-strong",
                  current && "shadow-focus",
                  disabled && "border-line bg-disabled-fill text-disabled-text",
                )}
              >
                {digit}
              </span>
            );
          })}
        </div>
        <input
          ref={input}
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          // The one attribute that matters most on this screen.
          autoComplete="one-time-code"
          pattern="[0-9]*"
          minLength={4}
          maxLength={MAX_DIGITS}
          required
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          onChange={(event) => setValue(event.target.value.replace(/\D/g, "").slice(0, MAX_DIGITS))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-invalid={invalid || undefined}
          {...(hint ? { "aria-describedby": hintId } : {})}
          className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 disabled:cursor-not-allowed"
        />
      </div>
      {hint ? (
        <p id={hintId} className="mt-2 text-caption text-body">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
