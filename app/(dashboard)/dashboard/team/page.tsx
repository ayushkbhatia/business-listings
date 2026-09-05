import { notFound } from "next/navigation";
import { PageEvent } from "@/components/telemetry/PageEvent";
import { can } from "@/lib/auth/can";
import type { StatusTone } from "@/components/display";
import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import { liveWeights } from "@/lib/search/settings";
import { rosterFor, type RosterSeat } from "@/lib/team/roster";
import { ESCALATION_CHOICES } from "@/lib/team/service";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { CapabilityMatrix } from "./_matrix";
import { SeatPerformancePanel } from "./_performance";
import { RoutingCard } from "./RoutingCard";
import { TeamBoard, type InviteRow, type SeatRow } from "./TeamBoard";
import { cancelInvite, removeTeamMember, resendTeamInvite, saveLeadRouting, sendInvite } from "./actions";

/**
 * Board 7d — team, roles and lead routing.
 *
 * The steady state of board 8d. Setup is over: this is where seats are added
 * and removed, and where the seller decides who a lead goes to. Board 3j's
 * assignment behaviour, board 3k's per-seat permissions and board 7e's entire
 * notification matrix all read what is configured here.
 *
 * Every string the interactive parts render is resolved here and handed over as
 * a string. A function cannot cross into a client component, and the plural
 * forms and the channel joins are the sort of thing that wants to be a callback
 * — see the note at the top of TeamBoard.tsx.
 */
export const metadata = { title: "Team" };
export const dynamic = "force-dynamic";

const ROLES = ["seller_manager", "seller_sales", "seller_finance"] as const;
const MODES = ["everyone", "round_robin", "by_branch"] as const;

export default async function TeamPage() {
  const seat = await requireSellerSeat();
  /*
     Board 7d §1: owner and manager only. The nav row has been gated on
     `team.manage` since handoff 3, but the URL was not — so a sales or finance
     seat that typed it read every colleague's median reply time, and after this
     rebuild would read their branch scope and their contact details too.

     `notFound` rather than a refusal page: a seat with no business here should
     not learn that the screen exists.
  */
  if (!can(seat.actor, "team.manage")) notFound();

  const [business, roster, badges, weights, branches] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: { leadRouting: true, leadEscalationMinutes: true, plan: { select: { name: true } } },
    }),
    rosterFor(seat.businessId, seat.actor.id),
    getNavBadges(seat.businessId),
    /*
       Read, not written down. The lede states what reply time is worth in
       search, and board 12c lets staff change that weight — a hardcoded 18
       would be a number on a seller's screen that nothing keeps true.
    */
    liveWeights(),
    prisma.location.findMany({
      where: { businessId: seat.businessId, published: true },
      orderBy: { type: "asc" },
      select: { id: true, addressLine: true, area: { select: { name: true } } },
    }),
  ]);

  const seats: SeatRow[] = roster.seats.map((row) => ({
    userId: row.userId,
    name: row.name,
    contact: row.contact,
    roleLabel: row.roles
      .filter((role) => role.startsWith("seller_"))
      .map((role) => t(`team.role.${role}` as "team.role.seller_owner"))
      .join(", "),
    isOwner: row.isOwner,
    isYou: row.isYou,
    branchLabel: row.branch
      ? t("team.scope_branch", { branch: row.branch.name })
      : t("team.scope_all", { count: roster.branchCount }),
    open: row.open,
    reachLabel: reachLabel(row),
    reachTone: reachTone(row),
    unverifiedNote: unverifiedNote(row),
    statusLabel: row.status === "suspended" ? t("team.status.suspended") : t("team.status.active"),
    statusTone: row.status === "suspended" ? "bad" : "ok",
    removable: row.removable,
    canTakeLeads: row.reach.canTakeLeads,
  }));

  const invites: InviteRow[] = roster.invites.map((invite) => ({
    id: invite.id,
    contact: invite.contact,
    roleLabel: invite.roles
      .map((role) => t(`team.role.${role}` as "team.role.seller_owner"))
      .join(", "),
    branchLabel: invite.branch
      ? t("team.scope_branch", { branch: invite.branch.name })
      : t("team.invite_branch_all"),
    statusLabel: invite.expired ? t("team.status.expired") : t("team.status.invited"),
    statusTone: invite.expired ? "warn" : "info",
    timerLabel: invite.expired
      ? t("team.invite_expired")
      : t("team.invite_expires", { count: daysUntil(invite.expiresAt) }),
    expired: invite.expired,
  }));

  /*
     A seat that cannot be reached is a seat routing skips, and the number of
     them is the leading indicator for `unroutable_lead`. Counted over the seats
     that would otherwise be targets: a finance seat with no channels is not a
     routing problem, it was never a routing target.
  */
  const unreachable = roster.seats.filter(
    (row) => row.reach.canTakeLeads && !row.reach.reachable,
  ).length;

  const measured = [...roster.performance]
    .filter((row) => row.medianReplyMs !== null && row.userId !== null)
    .sort((a, b) => (b.medianReplyMs ?? 0) - (a.medianReplyMs ?? 0));
  const ownerId = roster.seats.find((row) => row.isOwner)?.userId ?? null;
  const ownerIsSlowest = measured.length > 1 && measured[0]?.userId === ownerId;

  const seatsLabel =
    roster.allowance.cap === null
      ? t("team.seats_uncapped", { used: String(roster.allowance.used) })
      : t("team.seats", {
          used: String(roster.allowance.used),
          cap: String(roster.allowance.cap),
        });

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/team"
      eyebrow={t("team.eyebrow")}
      title={t("team.title")}
      /*
         Board 7d §1 puts the seat count in the header, against the plan cap.
         It was on the panel as well, which is the same sentence twice in two
         type sizes about eighty pixels apart.
      */
      meta={
        <span className="text-caption text-muted">
          {roster.invites.length > 0
            ? `${seatsLabel} · ${t("team.invites_pending", { count: roster.invites.length })}`
            : seatsLabel}
        </span>
      }
    >
      <PageEvent
        name="team_viewed"
        props={{ seats: roster.seats.length, invites: roster.invites.length, unreachable }}
      />

      <div className="flex flex-col gap-[var(--gutter)]">
        <p className="max-w-prose text-body-sm text-muted">{t("team.intro")}</p>

        <TeamBoard
          seats={seats}
          invites={invites}
          pendingLabel={
            roster.invites.length > 0
              ? t("team.invites_pending", { count: roster.invites.length })
              : null
          }
          atCap={
            roster.allowance.atCap
              ? {
                  reason: t("team.at_cap_short", { plan: business.plan?.name ?? "Free" }),
                  billingLabel: t("team.at_cap_billing"),
                }
              : null
          }
          /*
             8d §2, product-wide: a single-branch business hides branch pickers
             entirely. A column whose every cell reads "the one branch" is a
             column that costs width and answers nothing.
          */
          showBranchColumn={roster.branchCount > 1}
          branches={branchOptions(branches)}
          roles={ROLES.map((role) => ({
            value: role,
            label: t(`team.role.${role}` as "team.role.seller_owner"),
          }))}
          openNote={
            roster.totalOpen === 0
              ? t("team.open_none")
              : t("team.open_total", { count: roster.totalOpen })
          }
          unassignedNote={
            roster.unassignedOpen > 0
              ? t("team.open_unassigned", { count: roster.unassignedOpen })
              : null
          }
          reachRule={unreachable > 0 ? t("team.reach.rule") : null}
          inviteAction={sendInvite}
          revokeAction={cancelInvite}
          resendAction={resendTeamInvite}
          removeAction={removeTeamMember}
        />

        <CapabilityMatrix />

        <RoutingCard
          routing={business.leadRouting}
          escalationMinutes={business.leadEscalationMinutes}
          modes={MODES.map((mode) => ({
            value: mode,
            label: t(`routing.${mode}` as "routing.everyone"),
            hint: t(`routing.${mode}_hint` as "routing.everyone_hint"),
          }))}
          escalationChoices={ESCALATION_CHOICES.map((minutes) => ({
            value: String(minutes),
            label:
              minutes < 60
                ? t("routing.minutes", { count: minutes })
                : t("routing.hours", { count: minutes / 60 }),
          }))}
          lede={t("routing.lede", {
            points: String(weights.responseTime),
            total: String(
              Object.values(weights).reduce((sum, weight) => sum + weight, 0),
            ),
          })}
          singleSeat={roster.seats.length < 2}
          unreachableNote={
            unreachable > 0 ? t("routing.unreachable_seats", { count: unreachable }) : null
          }
          action={saveLeadRouting}
        />

        <SeatPerformancePanel
          rows={roster.performance}
          total={roster.performanceTotal}
          windowDays={roster.windowDays}
          ownerIsSlowest={ownerIsSlowest}
        />
      </div>
    </SellerPage>
  );
}

/**
 * What to call each branch in the invite picker.
 *
 * The area is the name a seller uses for a branch — "Al Quoz" — right up to the
 * point where they have two counters in Al Quoz, and then a picker offering the
 * same label twice is a question with no answer. The address only appears where
 * it is doing that work: adding it to every row would push the real name off the
 * end of a select on a phone.
 */
function branchOptions(
  rows: readonly { id: string; addressLine: string; area: { name: string } }[],
): { id: string; label: string }[] {
  const seen = new Map<string, number>();
  for (const row of rows) seen.set(row.area.name, (seen.get(row.area.name) ?? 0) + 1);

  return rows.map((row) => ({
    id: row.id,
    label:
      (seen.get(row.area.name) ?? 0) > 1
        ? t("team.branch_disambiguated", { area: row.area.name, address: row.addressLine })
        : row.area.name,
  }));
}

/** The channels this seat would actually be reached on, in the order tried. */
function reachLabel(row: RosterSeat): string {
  if (!row.reach.canTakeLeads) return t("team.reach.not_lead_seat");
  if (row.reach.verified.length === 0) return t("team.reach.none");
  if (row.reach.slowOnly) return t("team.reach.email_only");
  return row.reach.verified
    .map((kind) => t(`team.channel.${kind}` as "team.channel.whatsapp"))
    .join(" · ");
}

function reachTone(row: RosterSeat): StatusTone {
  /*
     Neutral rather than red for a seat that was never a lead target. A finance
     seat with no channels is not a fault to fix — 7d §2 says it cannot reply to
     an enquiry at all — and colouring it like a broken sales seat would send
     the seller to verify a number that would change nothing.
  */
  if (!row.reach.canTakeLeads) return "neutral";
  if (row.reach.verified.length === 0) return "bad";
  return row.reach.slowOnly ? "warn" : "ok";
}

/** What the seat has entered and not yet proved. Amber, and actionable. */
function unverifiedNote(row: RosterSeat): string | null {
  if (row.reach.unverified.length === 0) return null;
  return t("team.reach.unverified", {
    channels: row.reach.unverified
      .map((kind) => t(`team.channel.${kind}` as "team.channel.whatsapp"))
      .join(" · "),
  });
}

/** Whole days, rounded up: an invitation with six hours left has one day left. */
function daysUntil(when: Date): number {
  return Math.max(1, Math.ceil((when.getTime() - Date.now()) / 86_400_000));
}
