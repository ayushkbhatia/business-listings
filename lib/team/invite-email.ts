import "server-only";
import { resolveNotificationSenders } from "@/lib/notify/senders";
import { formatDate } from "@/lib/format";
import { absoluteUrl } from "@/lib/site";
import { t } from "@/lib/i18n";
import type { Role } from "@/lib/auth/roles";
import { describeRoles } from "./invite";

/**
 * Delivering an invitation.
 *
 * **Not through `notify()`.** The notification service resolves a recipient by
 * `recipientUserId` and writes a `NotificationDelivery` row against it, and an
 * invitee has no `User` row at all — that is the entire point of an invitation.
 * Adding a `NotificationEvent` for this would mean either a nullable recipient
 * on a table whose whole job is "who was told what", or a placeholder account
 * created for somebody who may never accept. So this reaches for the carrier
 * directly, which is one line further down the same stack, and reuses the
 * Resend sender rather than opening a second HTTP client against the same API.
 *
 * **It never throws, and it reports what happened.** The invitation row exists
 * before this is called and stays whether or not the email lands; the owner's
 * fallback is the link, which `inviteSeat` now returns for exactly this reason.
 * A send that failed and a send that could not be attempted are both `false`,
 * because the owner's next action is the same in either case — copy the link
 * and send it themselves.
 */

/** The address on the invitation link. Absolute: a relative link in an email is a dead link. */
export function inviteUrl(token: string): string {
  return absoluteUrl(`/invite/${encodeURIComponent(token)}`);
}

export interface InviteEmailInput {
  /** The invited address, as stored on the row. */
  email: string;
  token: string;
  /** `displayName`. The name the invitee will see on the storefront they are joining. */
  businessName: string;
  inviterName: string;
  roles: readonly Role[];
  expiresAt: Date;
}

export async function sendInviteEmail(input: InviteEmailInput): Promise<boolean> {
  const sender = resolveNotificationSenders().email;
  if (!sender) {
    // Honest rather than silent: in production with no Resend key there is no
    // carrier, and the caller has to offer the link instead of claiming a send.
    console.warn("[team] no email carrier configured; the invitation link was not sent", {
      to: input.email,
    });
    return false;
  }

  try {
    /*
       Rendered inside the try along with the send. `t()` throws outside
       production on a key it does not recognise, and `formatDate` throws on an
       invalid date — both are bugs worth being loud about, and neither is worth
       losing the invitation over on the one path a supplier is waiting on.
    */
    const body = [
      t("invite.email_body", {
        inviter: input.inviterName,
        business: input.businessName,
        roles: describeRoles(input.roles),
      }),
      t("invite.email_expiry", { date: formatDate(input.expiresAt) }),
    ].join("\n\n");

    const result = await sender.send({
      channel: "email",
      to: input.email,
      subject: t("invite.subject", {
        inviter: input.inviterName,
        business: input.businessName,
      }),
      body,
      actionLabel: t("invite.email_cta"),
      actionUrl: inviteUrl(input.token),
    });

    if (!result.delivered) {
      console.error("[team] the invitation email was refused", {
        to: input.email,
        detail: result.detail,
      });
    }
    return result.delivered;
  } catch (cause) {
    /*
       A carrier that threw must not take the invitation with it. The row is
       already written and the token already works; losing the whole action
       because Resend was unreachable would leave the owner with no seat, no
       link, and a form that looked like it had failed to save.
    */
    console.error("[team] the invitation email could not be sent", {
      to: input.email,
      cause: cause instanceof Error ? cause.name : "unknown",
    });
    return false;
  }
}
