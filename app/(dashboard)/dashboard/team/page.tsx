import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { ESCALATION_CHOICES, pendingInvites, teamFor } from "@/lib/team/service";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { cancelInvite, removeTeamMember, saveLeadRouting, sendInvite } from "./actions";
import { TeamForm } from "./TeamForm";

/**
 * Board 7d — team, roles and lead routing.
 *
 * The routing setting is the one that protects the response score, which is why
 * it lives beside the per-person reply times rather than in settings. A seller
 * looking at who is slow is a seller in the right frame of mind to change where
 * enquiries land.
 */
export const metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const seat = await requireSellerSeat();
  /*
     Board 7d §1: owner and manager only. The nav row has been gated on
     `team.manage` since handoff 3, but the URL was not — so a sales or finance
     seat that typed it read every colleague's median reply time, and after this
     rebuild would read their branch scope and their phone numbers too.

     `notFound` rather than a refusal page: a seat with no business here should
     not learn that the screen exists.
  */
  if (!can(seat.actor, "team.manage")) notFound();

  const [business, seats, invites, badges] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: {
        leadRouting: true,
        leadEscalationMinutes: true,
        plan: { select: { teamSeats: true } },
      },
    }),
    teamFor(seat.businessId),
    pendingInvites(seat.businessId),
    getNavBadges(seat.businessId),
  ]);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/team"
      eyebrow={t("team.eyebrow")}
      title={t("team.title")}
    >
      <div className="flex flex-col gap-4">
        <p className="max-w-prose text-body-sm text-muted">{t("team.intro")}</p>

        <TeamForm
          seats={seats}
          /*
             Whichever channel it used. `pendingInvites` returns both columns
             since board 8d made a mobile invitation possible, and the row shows
             the one that is set.
          */
          invites={invites.map((invite) => ({
            id: invite.id,
            contact: invite.email ?? invite.phone ?? "",
            roles: invite.roles,
          }))}
          /*
             The reader's own id, so their row offers no remove control. It is
             the actor's rather than the seat's: a staff member looking through
             board 12f keeps their own id and only the business changes, so this
             stays the person holding the mouse.
          */
          currentUserId={seat.actor.id}
          routing={business.leadRouting}
          escalationMinutes={business.leadEscalationMinutes}
          escalationChoices={ESCALATION_CHOICES}
          seatsUsed={seats.length + invites.length}
          seatCap={business.plan?.teamSeats ?? 1}
          inviteAction={sendInvite}
          revokeAction={cancelInvite}
          removeAction={removeTeamMember}
          routingAction={saveLeadRouting}
        />
      </div>
    </SellerPage>
  );
}
