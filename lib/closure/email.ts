import "server-only";
import { resolveNotificationSenders } from "@/lib/notify/senders";
import { formatDate } from "@/lib/format";
import { absoluteUrl } from "@/lib/site";
import { t, type MessageKey } from "@/lib/i18n";

/**
 * Board `11i` — the four messages a closure sends, straight to the owner's
 * sign-in address.
 *
 * ## Not through `notify()`
 *
 * Since boards 7d and 7e a notification is delivered only to a verified
 * `SeatChannel`, and that is correct for a message about an enquiry: it must
 * reach somebody who can open the lead. It is exactly wrong here. Closure
 * revokes every seat, and build note `B3` makes this email *the* way back — a
 * reversal link that went nowhere because the owner never verified a WhatsApp
 * number is a closure nobody can undo. So this goes to `User.email` directly,
 * the way a team invitation does, and reports honestly when there is no carrier
 * or no address: the confirmation screen then says so and names the other way
 * back, which is signing in again.
 *
 * Never throws. The closure has already happened by the time these run; losing
 * it over a carrier being down would leave a listing half-closed.
 */

export type ClosureEmailKind = "requested" | "reopened" | "notice" | "applied";

export interface ClosureEmailInput {
  kind: ClosureEmailKind;
  to: string | null;
  /** `displayName`, never `tradeName` — the name the seller sees on their own storefront. */
  businessName: string;
  /** `requested`, `applied`: the last day a reversal is possible. `notice`: the day it takes effect. */
  date?: Date;
  /** `notice`: when the licence expired. */
  licenceExpiredOn?: Date;
  /** `requested` only. The token itself, which exists nowhere but this email. */
  token?: string;
}

const SUBJECT: Record<ClosureEmailKind, MessageKey> = {
  requested: "closure.email.requested.subject",
  reopened: "closure.email.reopened.subject",
  notice: "closure.email.notice.subject",
  applied: "closure.email.applied.subject",
};

export function reversalUrl(token: string): string {
  return absoluteUrl(`/account/reopen/${encodeURIComponent(token)}`);
}

function bodyFor(input: ClosureEmailInput): { body: string; label: string | null; url: string | null } {
  const date = input.date ? formatDate(input.date) : "";
  const name = input.businessName;

  switch (input.kind) {
    case "requested":
      return {
        body: [
          t("closure.email.requested.p1", { business: name }),
          t("closure.email.requested.p2", { date }),
          t("closure.email.requested.p3"),
        ].join("\n\n"),
        label: t("closure.email.requested.cta"),
        url: input.token ? reversalUrl(input.token) : null,
      };
    case "reopened":
      return {
        body: [t("closure.email.reopened.p1", { business: name }), t("closure.email.reopened.p2")].join(
          "\n\n",
        ),
        label: t("closure.email.reopened.cta"),
        url: absoluteUrl("/dashboard"),
      };
    case "notice":
      return {
        body: [
          t("closure.email.notice.p1", {
            business: name,
            expired: input.licenceExpiredOn ? formatDate(input.licenceExpiredOn) : "",
          }),
          t("closure.email.notice.p2", { date }),
          t("closure.email.notice.p3"),
        ].join("\n\n"),
        label: t("closure.email.notice.cta"),
        url: absoluteUrl("/dashboard/verification"),
      };
    case "applied":
      return {
        body: [t("closure.email.applied.p1", { business: name }), t("closure.email.applied.p2", { date })].join(
          "\n\n",
        ),
        label: null,
        url: null,
      };
  }
}

/** Send it. True only when a carrier accepted the message. */
export async function sendClosureEmail(input: ClosureEmailInput): Promise<boolean> {
  const sender = resolveNotificationSenders().email;
  if (!sender || !input.to) {
    console.warn("[closure] no email carrier or no address; the message was not sent", {
      kind: input.kind,
      hasAddress: Boolean(input.to),
    });
    return false;
  }

  try {
    const { body, label, url } = bodyFor(input);
    const result = await sender.send({
      channel: "email",
      to: input.to,
      subject: t(SUBJECT[input.kind], { business: input.businessName }),
      body,
      actionLabel: label,
      actionUrl: url,
    });
    if (!result.delivered) {
      console.error("[closure] the email was refused", { kind: input.kind, detail: result.detail });
    }
    return result.delivered;
  } catch (cause) {
    console.error("[closure] the email could not be sent", {
      kind: input.kind,
      cause: cause instanceof Error ? cause.name : "unknown",
    });
    return false;
  }
}
