import "server-only";
import { resolveNotificationSenders } from "@/lib/notify/senders";
import { formatDateTime } from "@/lib/format";
import { absoluteUrl } from "@/lib/site";
import { t } from "@/lib/i18n";
import type { StaffRole } from "@/lib/auth/roles";

/**
 * Delivering a staff invitation. Board 4i.
 *
 * The same carrier `lib/team/invite-email.ts` uses and for the same reason: an
 * invitee has no `User` row, so `notify()` — which resolves a recipient by id —
 * has nobody to address. Email only; see `STAFF_EMAIL_DOMAINS`.
 *
 * Never throws. The invitation row and its audit row are already committed when
 * this runs, so a carrier that is down costs the ops lead a copy of the link,
 * not the invitation. The screen is told which happened.
 */

/** Under `/staff`, which nothing links to and `robots.ts` already disallows. */
export function staffInviteUrl(token: string): string {
  return absoluteUrl(`/staff/invite/${encodeURIComponent(token)}`);
}

export interface StaffInviteEmail {
  email: string;
  token: string;
  role: StaffRole;
  inviterName: string;
  expiresAt: Date;
}

export async function sendStaffInviteEmail(input: StaffInviteEmail): Promise<boolean> {
  const sender = resolveNotificationSenders().email;
  if (!sender) {
    console.warn("[staff] no email carrier configured; the invitation link was not sent");
    return false;
  }

  try {
    const role = t(`staff.role.${input.role}`);
    const result = await sender.send({
      channel: "email",
      to: input.email,
      subject: t("staff.invite.email_subject", { inviter: input.inviterName, role }),
      body: [
        t("staff.invite.email_body", { inviter: input.inviterName, role }),
        t("staff.invite.email_expiry", { when: formatDateTime(input.expiresAt) }),
        t("staff.invite.email_not_you"),
      ].join("\n\n"),
      actionLabel: t("staff.invite.email_cta"),
      actionUrl: staffInviteUrl(input.token),
    });
    if (!result.delivered) {
      // The address is not logged. It is a staff mailbox, and the log outlives
      // the invitation.
      console.error("[staff] the invitation email was refused", { detail: result.detail });
    }
    return result.delivered;
  } catch (cause) {
    console.error("[staff] the invitation email could not be sent", {
      cause: cause instanceof Error ? cause.name : "unknown",
    });
    return false;
  }
}
