import Link from "next/link";
import { PageEvent } from "@/components/telemetry/PageEvent";
import { Tabs } from "@/components/structure";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import { defaultAutoReplyBody } from "@/lib/messaging/auto-reply";
import { resolveNotificationSenders } from "@/lib/notify/senders";
import { channelsFor, ADDABLE_KINDS } from "@/lib/team/channels";
import { maySeeOtherSeats, reachabilityFor } from "@/lib/team/reachability";
import { openNow } from "@/lib/trade/open-now";
import type { RamadanHours, WeekHours } from "@/lib/trade/hours";
import { readRamadanCalendar } from "@/lib/trade/ramadan-calendar";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { AlertsForm, type AlertsValue } from "./AlertsForm";
import { AutoReplyForm } from "./AutoReplyForm";
import { ChannelsCard } from "./ChannelsCard";
import { ReachabilityRail } from "./_reachability";
import { confirmChannelCode, dropChannel, sendChannelCode } from "./actions";
import { EVENTS, GOES_TO } from "./matrix";

/**
 * Board 7e — how a lead actually reaches a person.
 *
 * Board 7d decides *which* seat; this decides *how* that seat is told, and
 * whether they can be told at all. The two are one handoff because neither
 * screen alone can specify what happens when the answer is nobody, and a lead
 * that is assigned and never delivered is the worst outcome in the product — it
 * is invisible on both screens and the seller's reply-time band drops for it.
 *
 * ## Two tabs, not five
 *
 * §1 lists Notifications, Contact channels, Security, Integrations and Data &
 * privacy. Two of those exist. A tab that opens nothing is padding with a
 * layout reason, and the rule against it is the same one that says never pad a
 * list to fill a grid — so this ships the two that are real and says nothing
 * about the three that are not.
 *
 * ## Who gets in
 *
 * Any seller seat, and that is a widening. The route was gated on
 * `routing.manage`, which is owner and manager — but §1 gives a sales seat its
 * own channels here, and a sales seat that cannot reach this screen is a seat
 * that can never verify a number and therefore never becomes a routing target.
 * The policy half is still owner and manager, checked here and asserted again
 * in `saveAlerts`.
 */
export const metadata = { title: t("alerts.title") };
export const dynamic = "force-dynamic";

const DEFAULTS: AlertsValue = {
  routing: {
    enquiry_received: ["whatsapp", "in_app"],
    enquiry_escalated: ["whatsapp", "email", "in_app"],
    quote_accepted: ["whatsapp", "email", "in_app"],
    quote_expiring: ["in_app"],
    review_posted: ["email", "in_app"],
    document_expiring: ["email", "in_app"],
    setup_nudge: ["whatsapp"],
    weekly_digest: ["email"],
  },
  quietHoursEnabled: true,
  quietFromHour: 21,
  quietToHour: 7,
  quietOnSunday: true,
  highValueOverrideAed: 50_000,
  escalateAfterMinutes: 120,
  nudgeEnabled: true,
  nudgeAfterHours: 24,
};

type Tab = "notifications" | "channels";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const seat = await requireSellerSeat();
  const { tab: raw } = await searchParams;
  const tab: Tab = raw === "channels" ? "channels" : "notifications";

  const policy = can(seat.actor, "routing.manage");
  /*
     A sales seat lands on its own channels, because that is the only half of
     this screen it has. Sending it to an empty Notifications tab and letting it
     find the other one is a screen that looks broken to the seat it was
     widened for.
  */
  const effective: Tab = policy ? tab : "channels";

  const [preference, badges, pendingWhatsApp, business, reach, myChannels] = await Promise.all([
    prisma.notificationPreference.findUnique({ where: { businessId: seat.businessId } }),
    getNavBadges(seat.businessId),
    // Said out loud rather than left to look broken: a seller who switches
    // WhatsApp on and hears nothing deserves to know why.
    prisma.notificationTemplate.count({ where: { channel: "whatsapp", status: "pending_meta" } }),
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: {
        autoReplyEnabled: true,
        autoReplyBody: true,
        locations: {
          where: { published: true },
          select: { hours: true, ramadanHours: true },
        },
        team: {
          orderBy: { createdAt: "asc" },
          select: { id: true, fullName: true, email: true, phone: true },
        },
      },
    }),
    reachabilityFor(seat.businessId),
    channelsFor(seat.actor),
  ]);

  const value: AlertsValue = preference
    ? {
        routing: (preference.routing ?? {}) as Record<string, string[]>,
        quietHoursEnabled: preference.quietHoursEnabled,
        quietFromHour: preference.quietFromHour,
        quietToHour: preference.quietToHour,
        quietOnSunday: preference.quietOnSunday,
        highValueOverrideAed: preference.highValueOverrideAed,
        escalateAfterMinutes: preference.escalateAfterMinutes,
        nudgeEnabled: preference.nudgeEnabled,
        nudgeAfterHours: preference.nudgeAfterHours,
      }
    : DEFAULTS;

  /*
     Which channels this deployment can actually send on, read from the senders
     rather than written down. SMS has no carrier — the Bird key has no `sms`
     scope — so the column is offered, disabled, with the reason, rather than
     accepting a tick and silently sending nothing.
  */
  const available = Object.keys(resolveNotificationSenders());

  const ramadan = await readRamadanCalendar();
  const states = business.locations.map((location) =>
    openNow(
      location.hours as WeekHours | null,
      location.ramadanHours as RamadanHours | null,
      new Date(),
      ramadan,
    ),
  );
  const known = states.filter((state) => state.state !== "unknown");

  const seats = business.team.map((member) => ({
    userId: member.id,
    name: member.fullName ?? member.email ?? member.phone ?? "",
    isYou: member.id === seat.actor.id,
    reach: reach.get(member.id)!,
  }));
  const visible = maySeeOtherSeats(seat.actor)
    ? seats
    : seats.filter((row) => row.userId === seat.actor.id);

  const unreachable = seats.filter(
    (row) => row.reach?.canTakeLeads && !row.reach.reachable,
  ).length;

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/settings"
      eyebrow={t("alerts.eyebrow")}
      title={t("alerts.title")}
      meta={<span className="text-caption text-muted">{t("alerts.lede")}</span>}
    >
      <PageEvent name="settings_viewed" props={{ tab: effective, unreachable }} />

      <div className="flex flex-col gap-[var(--gutter)]">
        {policy && (
          <Tabs
            as="a"
            label={t("alerts.tabs_label")}
            active={effective}
            items={[
              {
                key: "notifications",
                label: t("alerts.tab.notifications"),
                href: "/dashboard/settings",
              },
              {
                key: "channels",
                label: t("alerts.tab.channels"),
                href: "/dashboard/settings?tab=channels",
              },
            ]}
          />
        )}

        {effective === "notifications" ? (
          <>
            <AlertsForm
              value={value}
              whatsappPending={pendingWhatsApp > 0}
              goesTo={Object.fromEntries(
                EVENTS.map((event) => [
                  event,
                  t(`alerts.goes_to.${GOES_TO[event]}` as "alerts.goes_to.owner"),
                ]),
              )}
              available={available}
              hours={{
                published: known.length > 0,
                closedNow: known.length > 0 && !known.some((state) => state.state === "open"),
              }}
            />

            <AutoReplyForm
              enabled={business.autoReplyEnabled}
              body={business.autoReplyBody ?? ""}
              defaultBody={defaultAutoReplyBody()}
            />
          </>
        ) : (
          <>
            <ReachabilityRail rows={visible} />

            <ChannelsCard
              rows={myChannels.map((row) => ({
                kind: row.kind,
                kindLabel: t(`channels.kind.${row.kind}` as "channels.kind.whatsapp"),
                address: row.address,
                verified: row.verified,
                awaitingCode: row.awaitingCode,
              }))}
              addable={[...ADDABLE_KINDS]}
              /*
                 Said rather than left as an option that quietly does nothing.
                 §10.3 keeps the SMS column and defaults it off; nothing can
                 prove an SMS number until a carrier exists, and a seat looking
                 for the control deserves the reason.
              */
              smsNote={ADDABLE_KINDS.includes("sms") ? null : t("channels.sms_unavailable")}
              sendAction={sendChannelCode}
              confirmAction={confirmChannelCode}
              removeAction={dropChannel}
            />

            {!policy && (
              <p className="max-w-prose text-caption text-muted">{t("reach.own_only")}</p>
            )}
          </>
        )}

        {/*
           The other half of the handoff, named. This screen decides how a seat
           is told; the one it points at decides which seat, and a seller who
           has just read "the assigned seat" eight times needs to know where
           that is set.
        */}
        <p className="max-w-prose text-caption text-muted">
          <Link
            href="/dashboard/team"
            className="underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("settings.team_link")}
          </Link>
        </p>
      </div>
    </SellerPage>
  );
}
