import "server-only";
import { resolveNotificationSenders } from "@/lib/notify/senders";
import { formatDate } from "@/lib/format";
import { absoluteUrl } from "@/lib/site";
import { t } from "@/lib/i18n";
import type { BuyerCompanyRole } from "./authority";
import { authorityLabel, roleLabel } from "./words";

/**
 * Delivering an invitation to a buying company. Board `7b`.
 *
 * The carrier directly, not `notify()`, for the reason `lib/team/invite-email.ts`
 * gives: an invitee may have no `User` row, and `notify` addresses a user.
 *
 * Never throws, and says what happened. The invitation is committed before
 * this runs; a carrier that is down costs the admin a copy of the link, which
 * the screen offers when this returns false.
 */

/** Under `/account`, which `robots` already keeps out of an index. */
export function companyInviteUrl(token: string): string {
  return absoluteUrl(`/account/company/join/${encodeURIComponent(token)}`);
}

export interface CompanyInviteEmail {
  email: string;
  token: string;
  fullName: string;
  companyName: string;
  inviterName: string;
  role: BuyerCompanyRole;
  monthlyLimitAed: number | null;
  expiresAt: Date;
}

export async function sendCompanyInviteEmail(input: CompanyInviteEmail): Promise<boolean> {
  const sender = resolveNotificationSenders().email;
  if (!sender) {
    console.warn("[buyer-company] no email carrier configured; the invitation link was not sent");
    return false;
  }
  try {
    const body = [
      t("company.invite_email.body", {
        name: input.fullName,
        inviter: input.inviterName,
        company: input.companyName,
        role: roleLabel(input.role),
        authority: authorityLabel(input.role, input.monthlyLimitAed),
      }),
      t("company.invite_email.expiry", { date: formatDate(input.expiresAt) }),
    ].join("\n\n");
    const result = await sender.send({
      channel: "email",
      to: input.email,
      subject: t("company.invite_email.subject", { inviter: input.inviterName, company: input.companyName }),
      body,
      actionLabel: t("company.invite_email.cta"),
      actionUrl: companyInviteUrl(input.token),
    });
    if (!result.delivered) {
      console.error("[buyer-company] the invitation email was refused", { detail: result.detail });
    }
    return result.delivered;
  } catch (cause) {
    console.error("[buyer-company] the invitation email could not be sent", {
      cause: cause instanceof Error ? cause.name : "unknown",
    });
    return false;
  }
}
