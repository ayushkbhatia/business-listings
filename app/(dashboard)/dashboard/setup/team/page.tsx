import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { PageEvent } from "@/components/telemetry";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { allowance } from "@/lib/plan/entitlements";
import { WEIGHTS } from "@/lib/metrics/profile-strength";
import { setupHubState } from "@/lib/setup/service";
import { pendingInvites, teamFor } from "@/lib/team/service";
import { contactLabel } from "@/lib/team/contact";
import { formatCount, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { requireSellerSeat, type SellerSeat } from "../../_shell";
import type { TaskSegment } from "../_task-chrome";
import { TeamWorkspace } from "./TeamWorkspace";
import {
  resendInviteAction,
  revokeInviteAction,
  saveRoutingAction,
  sendInvites,
} from "./actions";

/**
 * Board 8d — setup task 3: invite the team.
 *
 * The cheapest of the four and the only one whose outcome depends on somebody
 * who is not the seller. That single fact drives the screen: the task ticks on
 * send rather than on acceptance, the eight points wait for an active seat, and
 * the two disagree out loud rather than confusingly.
 *
 * ## What this board had to build rather than wire
 *
 * The invitation existed after board 8a and could only be emailed. §2 offers one
 * field reading "Mobile or email", and a supplier's staff in this market are
 * reached on WhatsApp — so `TeamInvite.email` became nullable, `phone` arrived
 * beside it, and the send picks its channel from what the seller typed.
 *
 * `User.branchId` arrived with it. `Actor.branchId` has been declared since
 * handoff 0 and read by `withinScope()` ever since, with nothing to populate it
 * from — so every branch-scoping check in the product silently returned true,
 * and board 7d's branch-scoped sales seat scoped nothing. The branch column on
 * an invitation is what finally sets it.
 */
export const metadata = { title: t("team_setup.meta_title") };
export const dynamic = "force-dynamic";

/** §1: owner and manager. A sales seat cannot buy more seats. */
function mayInvite(seat: SellerSeat): boolean {
  return seat.actor.roles.some((role) => role === "seller_owner" || role === "seller_manager");
}

export default async function SetupTeamPage() {
  const seat = await requireSellerSeat();
  if (!mayInvite(seat)) redirect("/dashboard/leads");

  const [hub, seats, invites, caps, business] = await Promise.all([
    setupHubState(seat.businessId),
    teamFor(seat.businessId),
    pendingInvites(seat.businessId),
    effectiveFor(seat.businessId),
    prisma.business.findUnique({
      where: { id: seat.businessId },
      select: {
        leadRouting: true,
        leadEscalationMinutes: true,
        locations: {
          where: { published: true },
          orderBy: { type: "asc" },
          select: { id: true, addressLine: true, area: { select: { name: true } } },
        },
      },
    }),
  ]);
  if (!hub || !business) redirect("/dashboard");
  if (!hub.live) redirect("/onboarding/locations");

  const used = seats.length + invites.length;
  const left = caps ? allowance(caps, "seats", used) : null;

  const segments: TaskSegment[] = hub.tasks.map((task) =>
    task.id === "team"
      ? { id: task.id, filled: Math.min(1, used / Math.max(1, task.progress.target)) }
      : { id: task.id, filled: task.done ? 1 : 0 },
  );

  /*
     Pre-formatted for every count the button can plausibly show. The chrome's
     primary is a client control and cannot call `t()` — and a plural rendered
     in the browser is the hydration mismatch this codebase names first.
  */
  const counts = Array.from({ length: 9 }, (_, index) => index);
  const sendFor = counts.map((count) =>
    t("team_setup.send", { count, formatted: formatCount(count) }),
  );
  const someFailedFor = counts.map((count) =>
    t("team_setup.some_failed", { count, formatted: formatCount(count) }),
  );

  return (
    <>
      <PageEvent name="setup_task_started" props={{ task: "team" }} />
      <TeamWorkspace
        segments={segments}
        openCount={hub.openCount}
        done={hub.tasks.find((task) => task.id === "team")?.done ?? false}
        suspended={hub.suspended}
        routing={business.leadRouting}
        escalationMinutes={business.leadEscalationMinutes}
        branches={business.locations.map((location) => ({
          id: location.id,
          label: location.area?.name ?? location.addressLine,
        }))}
        sent={invites.map((invite) => ({
          id: invite.id,
          contact: contactLabel(invite),
          role: t(
            invite.roles.includes("seller_manager")
              ? "team_setup.role.manager"
              : "team_setup.role.sales",
          ),
          sentAgo: t("team_setup.sent_ago", {
            when: formatRelative(invite.lastSentAt ?? invite.createdAt),
          }),
        }))}
        seatsLeft={left?.remaining ?? 99}
        atCap={left?.atCap ?? false}
        labels={{
          name: t("team_setup.eyebrow"),
          skip: t("team_setup.skip"),
          title: t("team_setup.title"),
          intro: t("team_setup.intro"),
          /*
             The weight, not a number typed into the copy. Board 8d's handoff
             says eight; `WEIGHTS.team` is ten and the meter on the hub renders
             ten, so a sentence claiming eight would be the screen and the meter
             disagreeing about the same lever three lines apart.
          */
          tickNote: t("team_setup.tick_note", { points: formatCount(WEIGHTS.team) }),
          contact: t("team_setup.contact_label"),
          contactPlaceholder: t("team_setup.contact_placeholder"),
          role: t("team_setup.role_label"),
          branch: t("team_setup.branch_label"),
          allBranches: t("team_setup.all_branches"),
          removeRow: t("team_setup.remove_row"),
          addPerson: t("team_setup.add_person"),
          byWhatsApp: t("team_setup.by_whatsapp"),
          byEmail: t("team_setup.by_email"),
          ambiguous: t("team_setup.ambiguous"),
          sentRows: t("team_setup.sent_rows"),
          resend: t("team_setup.resend"),
          resent: t("team_setup.resent"),
          revoke: t("team_setup.revoke"),
          roleManager: t("team_setup.role.manager"),
          roleSales: t("team_setup.role.sales"),
          seatsUsed: t("team_setup.seats_used", {
            used: formatCount(used),
            total: formatCount(left?.cap ?? used),
            plan: caps?.name ?? "",
          }),
          seePricing: t("team_setup.see_pricing"),
          routingTitle: t("team_setup.routing_title"),
          routingNote: t("team_setup.routing_note"),
          /*
             The escalation is real, and this sentence is why. Board 8d §8 said
             to cut it unless the job existed; `lib/enquiry/escalation-job.ts`
             is that job, so the promise stays and names the supplier's own
             threshold rather than a hardcoded two hours.
          */
          escalationNote: t("team_setup.escalation_note", {
            threshold: threshold(business.leadEscalationMinutes),
          }),
          routingOptions: routingOptions(business.locations.length),
          whatEyebrow: t("team_setup.what_eyebrow"),
          whatBody: t("team_setup.what_body"),
          moneyTitle: t("team_setup.money_title"),
          moneyBody: t("team_setup.money_body"),
          sendFor,
          sendNone: t("team_setup.send_none"),
          someFailedFor,
        }}
        send={sendInvites}
        resend={resendInviteAction}
        revoke={revokeInviteAction}
        saveRouting={saveRoutingAction}
      />
    </>
  );
}

/**
 * The threshold in the unit a person would say it in.
 *
 * The escalation email renders `{hours}` — its template is seeded and live, and
 * `onEnquiryEscalated` rounds the supplier's minutes up to fill it. A screen
 * reading "120 minutes" beside a message reading "2 hours" is one fact told two
 * ways, so this says hours whenever the threshold divides into them and falls
 * back to minutes when it does not.
 */
function threshold(minutes: number): string {
  return minutes % 60 === 0
    ? t("team_setup.escalation_hours", {
        count: minutes / 60,
        formatted: formatCount(minutes / 60),
      })
    : t("team_setup.escalation_minutes", { count: minutes, formatted: formatCount(minutes) });
}

/**
 * §7: "Nearest branch" is only offered to a business with two or more.
 *
 * On a single-branch supplier it is a mode that cannot mean anything — every
 * enquiry matches the only branch there is — and offering it would be a control
 * whose two settings behave identically.
 */
function routingOptions(branches: number): { value: string; label: string }[] {
  const options = [
    { value: "round_robin", label: t("team_setup.routing.round_robin") },
    { value: "everyone", label: t("team_setup.routing.everyone") },
  ];
  if (branches > 1) {
    options.splice(1, 0, { value: "by_branch", label: t("team_setup.routing.by_branch") });
  }
  return options;
}
