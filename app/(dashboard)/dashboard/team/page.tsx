import { prisma } from "@/lib/db/client";
import { ESCALATION_CHOICES, pendingInvites, teamFor } from "@/lib/team/service";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { cancelInvite, saveLeadRouting, sendInvite } from "./actions";
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
          invites={invites}
          routing={business.leadRouting}
          escalationMinutes={business.leadEscalationMinutes}
          escalationChoices={ESCALATION_CHOICES}
          seatsUsed={seats.length + invites.length}
          seatCap={business.plan?.teamSeats ?? 1}
          inviteAction={sendInvite}
          revokeAction={cancelInvite}
          routingAction={saveLeadRouting}
        />
      </div>
    </SellerPage>
  );
}
