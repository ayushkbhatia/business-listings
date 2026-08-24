"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/primitives";
import { t } from "@/lib/i18n";

/**
 * Resend, behind a countdown.
 *
 * The cooldown is enforced server-side in lib/auth/throttle.ts — this is the
 * part that stops somebody pressing a button that is going to refuse them, and
 * that tells them how long. It is also the cost control's visible face: a
 * WhatsApp authentication message to the UAE is priced per delivery.
 *
 * The initial seconds come from the server, so a reload does not reset the
 * countdown to zero and invite another send.
 *
 * It resolves its own labels. One of them takes the remaining seconds, and a
 * function cannot cross from a server component to a client one — `t()` is
 * pure and runs the same on either side, so the label is built here rather
 * than handed over.
 */
export function ResendButton({
  initialSeconds,
  pending = false,
}: {
  initialSeconds: number;
  pending?: boolean;
}) {
  const [seconds, setSeconds] = useState(initialSeconds);

  useEffect(() => {
    if (seconds <= 0) return;
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const waiting = seconds > 0;
  return (
    <Button type="submit" variant="ghost" size="sm" disabled={waiting || pending} loading={pending}>
      {waiting ? t("auth.verify.resend_in", { seconds }) : t("auth.verify.resend")}
    </Button>
  );
}
