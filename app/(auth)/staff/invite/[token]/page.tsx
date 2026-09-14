import type { Metadata } from "next";
import Link from "next/link";
import { Button, buttonClassName } from "@/components/primitives";
import { signInHref } from "@/lib/auth/next-path";
import { getActor } from "@/lib/auth/session";
import { type StaffRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/db/client";
import { formatDateTime } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { readStaffInvite } from "@/lib/staff/accept";
import { grantCount } from "@/lib/staff/matrix";
import { holdsSellerSeat, staffRoleOf } from "@/lib/staff/policy";
import { AuthCard } from "../../../_components/AuthCard";
import { acceptStaffInviteAction } from "./actions";

/**
 * Board 4i — the screen a staff invitation link opens.
 *
 * Under `/staff`, the console's own door: nothing links here, `robots.ts`
 * disallows the prefix, and the page asks not to be indexed. A live staff
 * invitation in a search result would be a role offered to whoever searched.
 *
 * Every state has its own card and says who to ask. The two a guessed or spent
 * link reaches — not found and used — say nothing about anybody. An expired link
 * names the address it was sent to, because the person holding it needs to know
 * which account to ask about, and the address is on our own domain.
 *
 * The refusals a person cannot fix by trying again — the wrong account, a
 * supplier's seat, a suspended account — are shown before the button rather
 * than after it. The service refuses all of them regardless.
 */

export const metadata: Metadata = {
  title: t("auth.staff_invite.meta_title"),
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function roleLabel(role: StaffRole): string {
  return t(`staff.role.${role}` as MessageKey);
}

export default async function StaffInvitePage({ params, searchParams }: Props) {
  const { token } = await params;
  const query = await searchParams;
  const here = `/staff/invite/${encodeURIComponent(token)}`;

  const actor = await getActor();
  const holder = actor
    ? await prisma.user.findUnique({
        where: { id: actor.id },
        select: { email: true, phone: true, roles: true, businessId: true, suspendedAt: true },
      })
    : null;
  const heldRole = holder ? staffRoleOf(holder.roles) : null;

  // Believed only when the record agrees.
  if (query["accepted"] === "1" && heldRole) {
    return (
      <AuthCard
        title={t("auth.staff_invite.accepted_title")}
        lede={t("auth.staff_invite.accepted_body", { role: roleLabel(heldRole) })}
      >
        <Link href="/admin" className={buttonClassName({ block: true })}>
          {t("auth.staff_invite.to_console")}
        </Link>
      </AuthCard>
    );
  }

  const invite = await readStaffInvite(token);

  if (invite.state === "not_found" || invite.state === "used") {
    return (
      <AuthCard title={t("auth.staff_invite.dead_title")} lede={t("auth.staff_invite.dead_body")}>
        {null}
      </AuthCard>
    );
  }
  if (invite.state === "revoked") {
    return (
      <AuthCard title={t("auth.staff_invite.revoked_title")} lede={t("auth.staff_invite.revoked_body")}>
        {null}
      </AuthCard>
    );
  }
  if (invite.state === "expired") {
    return (
      <AuthCard
        title={t("auth.staff_invite.expired_title")}
        lede={t("auth.staff_invite.expired_body", { email: invite.email })}
      >
        {null}
      </AuthCard>
    );
  }

  const title = t("auth.staff_invite.title", { inviter: invite.inviterName, role: roleLabel(invite.role) });
  const window = t("auth.staff_invite.window", { when: formatDateTime(invite.expiresAt) });

  if (!holder) {
    return (
      <AuthCard title={title} lede={t("auth.staff_invite.sign_in_body", { email: invite.email })}>
        <p className="mb-4 text-body-sm text-body">{window}</p>
        <Link href={signInHref(here)} className={buttonClassName({ block: true })}>
          {t("auth.staff_invite.sign_in")}
        </Link>
      </AuthCard>
    );
  }

  const signedInAs = (holder.email ?? holder.phone ?? "").trim();
  if ((holder.email ?? "").trim().toLowerCase() !== invite.email) {
    return (
      <AuthCard
        title={t("auth.staff_invite.wrong_account_title")}
        lede={t("auth.staff_invite.wrong_account_body", { email: invite.email, current: signedInAs })}
      >
        <Link href={signInHref(here)} className={buttonClassName({ variant: "secondary", block: true })}>
          {t("auth.staff_invite.sign_in_other")}
        </Link>
      </AuthCard>
    );
  }

  if (holder.suspendedAt) {
    return (
      <AuthCard title={t("auth.staff_invite.suspended_title")} lede={t("auth.staff_invite.suspended_body")}>
        {null}
      </AuthCard>
    );
  }
  if (heldRole) {
    return (
      <AuthCard
        title={t("auth.staff_invite.already_title")}
        lede={t("auth.staff_invite.already_body", { role: roleLabel(heldRole) })}
      >
        <Link href="/admin" className={buttonClassName({ block: true })}>
          {t("auth.staff_invite.to_console")}
        </Link>
      </AuthCard>
    );
  }
  if (holdsSellerSeat(holder.roles, holder.businessId)) {
    return (
      <AuthCard title={t("auth.staff_invite.seller_title")} lede={t("auth.staff_invite.seller_body")}>
        {null}
      </AuthCard>
    );
  }

  return (
    <AuthCard title={title} lede={t("auth.staff_invite.accept_body", { email: invite.email })}>
      <p className="mb-2 text-body-sm text-body">
        {t("auth.staff_invite.grants", { role: roleLabel(invite.role), count: grantCount(invite.role) })}
      </p>
      <p className="mb-4 text-body-sm text-body">{window}</p>
      <form action={acceptStaffInviteAction}>
        <input type="hidden" name="token" value={token} />
        <Button type="submit" block>
          {t("auth.staff_invite.accept", { role: roleLabel(invite.role) })}
        </Button>
      </form>
    </AuthCard>
  );
}
