import "server-only";
import { resolveNotificationSenders } from "@/lib/notify/senders";
import { absoluteUrl } from "@/lib/site";
import { t } from "@/lib/i18n";

/**
 * The four account emails board 7a's states promise: the reset link, the notice
 * that a password changed, and the two halves of a suspension.
 *
 * ## Not through `notify()`
 *
 * `notify()` delivers only to a verified `SeatChannel` on a business, which is
 * right for a message about an enquiry and wrong for every one of these. A reset
 * link is how somebody who cannot sign in gets back in; a suspension is sent to
 * an account that has just lost every session. They go to `User.email` directly,
 * the way board 11i's closure emails do, and say honestly when there is no
 * carrier or no address.
 *
 * Never throws. Each returns true only when a carrier accepted the message.
 */

export function hasEmailCarrier(): boolean {
  return Boolean(resolveNotificationSenders().email);
}

async function send(
  kind: string,
  to: string | null,
  message: { subject: string; body: string; actionLabel: string | null; actionUrl: string | null },
): Promise<boolean> {
  const sender = resolveNotificationSenders().email;
  if (!sender || !to) {
    console.warn("[auth] no email carrier or no address; the message was not sent", {
      kind,
      hasAddress: Boolean(to),
    });
    return false;
  }
  try {
    const result = await sender.send({ channel: "email", to, ...message });
    if (!result.delivered) console.error("[auth] the email was refused", { kind, detail: result.detail });
    return result.delivered;
  } catch (cause) {
    console.error("[auth] the email could not be sent", {
      kind,
      cause: cause instanceof Error ? cause.name : "unknown",
    });
    return false;
  }
}

/** The link lands on a route that reads the token and never consumes it — see app/auth/reset. */
export function resetLinkUrl(token: string): string {
  return absoluteUrl(`/auth/reset?token=${encodeURIComponent(token)}`);
}

export function sendResetLinkEmail(to: string, token: string): Promise<boolean> {
  return send("reset_link", to, {
    subject: t("auth.email.reset.subject"),
    body: [t("auth.email.reset.p1"), t("auth.email.reset.p2"), t("auth.email.reset.p3")].join("\n\n"),
    actionLabel: t("auth.email.reset.cta"),
    actionUrl: resetLinkUrl(token),
  });
}

export function sendPasswordChangedEmail(to: string | null): Promise<boolean> {
  return send("password_changed", to, {
    subject: t("auth.email.changed.subject"),
    body: [t("auth.email.changed.p1"), t("auth.email.changed.p2")].join("\n\n"),
    actionLabel: t("auth.email.changed.cta"),
    actionUrl: absoluteUrl("/reset"),
  });
}

/**
 * Board 7a `B7`: the reason is emailed, and the sign-in screen never shows it.
 *
 * The reason is the one staff wrote on the audit row, verbatim. It is the only
 * place the account holder can read it, which is what makes the sign-in screen's
 * "the reason is in your email" a promise rather than a deflection.
 */
export function sendSuspensionEmail(to: string | null, reason: string): Promise<boolean> {
  return send("account_suspended", to, {
    subject: t("auth.email.suspended.subject"),
    body: [
      t("auth.email.suspended.p1"),
      t("auth.email.suspended.reason", { reason: reason.trim() }),
      t("auth.email.suspended.p2"),
    ].join("\n\n"),
    actionLabel: t("auth.email.suspended.cta"),
    actionUrl: `mailto:${t("auth.support_address")}`,
  });
}

export function sendReinstatedEmail(to: string | null): Promise<boolean> {
  return send("account_reinstated", to, {
    subject: t("auth.email.reinstated.subject"),
    body: t("auth.email.reinstated.p1"),
    actionLabel: t("auth.email.reinstated.cta"),
    actionUrl: absoluteUrl("/signin"),
  });
}
