"use client";

import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";

/**
 * Resend, behind board 7a's 24-second lock.
 *
 * The lock is enforced server-side in lib/auth/throttle.ts — this is the part
 * that stops somebody pressing a button that is going to refuse them, and that
 * tells them how long. It is also the cost control's visible face: a WhatsApp
 * authentication message to the UAE is priced per delivery.
 *
 * The initial seconds come from the server, so a reload does not reset the
 * countdown to zero and invite another send.
 *
 * The button itself arrives as `children`, built by the server page with its
 * `formAction`. An element crosses the server-client boundary; a function
 * handed over as a prop is the repo's most repeated bug. The countdown label
 * takes the remaining time and is built here — `t()` is pure and runs the same
 * on either side.
 */
export function ResendButton({ initialSeconds, children }: { initialSeconds: number; children: React.ReactNode }) {
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  if (seconds > 0) {
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    return (
      <p className="flex flex-col text-caption text-body" role="timer" aria-live="off">
        <span>{t("auth.verify.resend_in")}</span>
        <span className="font-mono tabular-nums">{clock}</span>
      </p>
    );
  }

  return <>{children}</>;
}
