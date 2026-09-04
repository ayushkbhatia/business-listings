"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { nudgeRecipient } from "../nudge-action";

/**
 * One nudge, per recipient, ever.
 *
 * Disabled rather than hidden before the 24 hours are up, with the reason on
 * the title — a buyer who cannot see the control cannot learn that it exists,
 * and "you can nudge after a day" is the answer to the question they are
 * actually asking, which is "can I hurry this along".
 */
export function NudgeButton({
  businessId,
  enquiryRef,
  token,
  disabled,
  label,
  waitLabel,
}: {
  businessId: string;
  enquiryRef: string;
  token: string | null;
  disabled: boolean;
  label: string;
  waitLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  return (
    <button
      type="button"
      disabled={disabled || pending || sent}
      title={disabled ? waitLabel : undefined}
      onClick={() =>
        startTransition(async () => {
          const result = await nudgeRecipient({ ref: enquiryRef, businessId, token });
          if (result.ok) setSent(true);
        })
      }
      className={cn(
        "inline-flex min-h-9 items-center rounded-ctl border border-line bg-card px-3",
        "text-body-sm font-medium text-ink hover:bg-paper",
        "focus-visible:outline-none focus-visible:shadow-focus",
        "disabled:cursor-default disabled:text-muted disabled:hover:bg-card",
      )}
    >
      {label}
    </button>
  );
}
