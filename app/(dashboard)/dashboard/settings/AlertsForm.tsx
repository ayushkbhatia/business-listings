"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Input, Select } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { StatusBadge } from "@/components/display/StatusBadge";
import { Tag } from "@/components/display/Tag";
import { cn } from "@/lib/cn";
import { t, type MessageKey } from "@/lib/i18n";
import type { ChoiceSource } from "@/lib/notify/routing";
import { saveAlerts } from "./actions";
import { escalationOptions } from "@/lib/team/escalation";
import { CHANNELS, floorLocked, inAppLocked, type AlertEvent, type AlertGroupKey } from "./matrix";

/**
 * Board 7e — the seller's control panel for their own alerts.
 *
 * A real table. The matrix is events down and channels across, which is tabular
 * data with a header in both directions, and a grid of divs would cost the
 * row-and-column association that makes it readable aloud.
 *
 * Three things the board did not have, and each one closes a gap:
 *
 * **`GOES TO`.** Rows of ticks with no statement of whose handset they reach.
 * The answer is not the same for every row and, for the row that matters most,
 * it is whatever board 7d's routing decided.
 *
 * **In-app is locked on for anything with a deadline** (§2.2), so a seller who
 * turns everything off still has a place the work appears. Rendered as a
 * checked, disabled box with a reason — and enforced again in `saveAlerts`,
 * because a disabled checkbox posts nothing and a form is a suggestion.
 *
 * **A channel with no carrier is disabled and says so**, rather than accepting a
 * tick and silently sending nothing. The list comes from
 * `resolveNotificationSenders`, so the screen cannot claim a channel the
 * deployment does not have.
 */
export interface AlertsValue {
  routing: Record<string, string[]>;
  quietHoursEnabled: boolean;
  quietFromHour: number;
  quietToHour: number;
  quietOnSunday: boolean;
  highValueOverrideAed: number | null;
  escalateAfterMinutes: number;
  nudgeEnabled: boolean;
  nudgeAfterHours: number;
  /** Board 11g reads this. Null falls back to the finance seat, then the owner. */
  billingEmail: string | null;
}

/** What the working week says right now, resolved on the server. */
export interface HoursState {
  /** Absent where nobody has published hours, and then the window applies. */
  published: boolean;
  closedNow: boolean;
}

export interface AlertsFormProps {
  value: AlertsValue;
  whatsappPending: boolean;
  /** Pre-resolved per event: "The assigned seat", "The owner". */
  goesTo: Readonly<Record<string, string>>;
  /** Channels this deployment can actually send on. */
  available: readonly string[];
  hours: HoursState;
  /** Board 7e's groups, in screen order — `ALERT_GROUPS`. */
  groups: readonly { key: AlertGroupKey; events: readonly AlertEvent[] }[];
  /** Where each row's ticks came from: the seller, an inherited row, or ours. */
  sources: Readonly<Record<string, ChoiceSource>>;
  /** For an inherited row, the label of the row it follows. */
  follows: Readonly<Record<string, string>>;
  /** Per event, the channels with a live message. A tick elsewhere reads *Not sent yet*. */
  liveChannels: Readonly<Record<string, readonly string[]>>;
}

/** The groups that hold a row we always send carry one note naming those rows. */
const GROUP_NOTE: Partial<Record<AlertGroupKey, MessageKey>> = {
  leads_quotes: "alerts.group_note.leads_quotes",
  listing: "alerts.group_note.listing",
  billing: "alerts.group_note.billing",
};

const eventLabel = (event: string) => t(`notify.event.${event}` as MessageKey);
const channelLabel = (channel: string) => t(`alerts.channel.${channel}` as "alerts.channel.whatsapp");

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: t("alerts.quiet_hour", { hour: String(hour).padStart(2, "0") }),
}));

export function AlertsForm({
  value,
  whatsappPending,
  goesTo,
  available,
  hours,
  groups,
  sources,
  follows,
  liveChannels,
}: AlertsFormProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
     The matrix is controlled so a *Not sent yet* caption follows the tick as
     the seller makes it, and so the count under the table is the count of what
     is on screen rather than of what was loaded.
  */
  const [matrix, setMatrix] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(groups.flatMap((group) => group.events).map((event) => [event, [...(value.routing[event] ?? [])]])),
  );
  /*
     Spec S1: "Dirty form — sticky save bar with *Unsaved changes*. Leaving
     prompts." Sixteen rows and four headings put Save below the fold at
     1280 x 720, and a change nobody can see the button for is a change lost.
  */
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const lockedAt = (event: AlertEvent, channel: (typeof CHANNELS)[number]) =>
    (inAppLocked(event) && channel === "in_app") || floorLocked(event, channel);
  const isOn = (event: AlertEvent, channel: (typeof CHANNELS)[number]) =>
    lockedAt(event, channel) || (matrix[event] ?? []).includes(channel);
  const notSent = (event: AlertEvent, channel: (typeof CHANNELS)[number]) =>
    isOn(event, channel) && available.includes(channel) && !(liveChannels[event] ?? []).includes(channel);
  const notSentCount = groups
    .flatMap((group) => group.events)
    .reduce((sum, event) => sum + CHANNELS.filter((channel) => notSent(event, channel)).length, 0);
  const anyDefault = groups.some((group) => group.events.some((event) => sources[event] === "default"));

  function toggle(event: string, channel: string, on: boolean) {
    setMatrix((current) => {
      const was = current[event] ?? [];
      return { ...current, [event]: on ? [...new Set([...was, channel])] : was.filter((c) => c !== channel) };
    });
  }

  return (
    <form
      onChange={() => {
        setDirty(true);
        setSavedAt(null);
      }}
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await saveAlerts(formData);
          if (result.ok) {
            setSavedAt(new Date().toLocaleTimeString("en-AE", { hour: "2-digit", minute: "2-digit" }));
            setDirty(false);
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
      className="space-y-[var(--gutter)]"
    >
      <Panel title={t("alerts.matrix_heading")}>
        {whatsappPending ? (
          <p className="mb-3 rounded-ctl border border-warn-line bg-warn-surface px-3 py-2 text-caption text-warn-ink">
            {t("alerts.whatsapp_pending")}
          </p>
        ) : null}

        {/*
           Focusable so a keyboard user can scroll it at 375px, where the three
           channel columns do not fit beside the event names. The event column
           is sticky there, so a tick is never read without its row.
        */}
        <div tabIndex={0} aria-label={t("alerts.matrix_caption")} className="overflow-x-auto focus-visible:outline-none focus-visible:shadow-focus">
          <table className="w-full min-w-[40rem] border-collapse text-left">
            <caption className="sr-only">{t("alerts.matrix_caption")}</caption>
            <thead>
              <tr className="bg-paper-sunk">
                <th scope="col" className="sticky left-0 z-[1] bg-paper-sunk px-3 py-2 text-caption font-normal text-muted">
                  {t("alerts.col.event")}
                </th>
                <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                  {t("alerts.col.goes_to")}
                </th>
                {CHANNELS.map((channel) => (
                  <th key={channel} scope="col" className="w-24 px-3 py-2 text-caption font-normal text-muted">
                    {channelLabel(channel)}
                  </th>
                ))}
              </tr>
            </thead>
            {groups.map((group) => {
              const note = GROUP_NOTE[group.key];
              return (
                <tbody key={group.key}>
                  <tr className="border-t border-line bg-fill">
                    <th
                      scope="rowgroup"
                      colSpan={2 + CHANNELS.length}
                      className="px-3 py-2 text-left font-mono text-eyebrow font-normal uppercase text-muted"
                    >
                      {/*
                         Sticky inside the spanning cell: at 375px the table
                         scrolls sideways, and a heading or note that scrolled
                         with the channels left a grey band with no words.
                      */}
                      <span className="sticky left-3 inline-block">{t(`alerts.group.${group.key}` as MessageKey)}</span>
                    </th>
                  </tr>
                  {group.events.map((event) => {
                    const label = eventLabel(event);
                    const source = sources[event];
                    return (
                      <tr key={event} className="border-t border-line align-top">
                        <th scope="row" className="sticky left-0 z-[1] bg-card px-3 py-2 text-left text-body-sm font-normal text-ink">
                          <span className="block">{label}</span>
                          {source === "default" ? (
                            <span className="mt-1 inline-block">
                              <Tag size="sm">{t("alerts.tag.default")}</Tag>
                            </span>
                          ) : source === "inherited" && follows[event] ? (
                            <span className="mt-1 inline-block">
                              <Tag size="sm">{t("alerts.tag.follows", { event: follows[event] })}</Tag>
                            </span>
                          ) : null}
                        </th>
                        <td className="px-3 py-2 text-caption text-muted">{goesTo[event]}</td>
                        {CHANNELS.map((channel) => {
                          const floorHere = floorLocked(event, channel);
                          const lockedHere = lockedAt(event, channel);
                          const unavailable = !available.includes(channel);
                          return (
                            <td key={channel} className="px-3 py-2">
                              <Checkbox
                                name={`matrix.${event}.${channel}`}
                                checked={isOn(event, channel)}
                                onChange={(change) => toggle(event, channel, change.currentTarget.checked)}
                                disabled={lockedHere || unavailable}
                                /* Named per cell: "WhatsApp for a new enquiry
                                   arrives" is what a screen reader should say, not
                                   "checkbox" forty times. */
                                aria-label={
                                  floorHere
                                    ? t("alerts.floor_locked_cell", { channel: channelLabel(channel), event: label })
                                    : lockedHere
                                      ? t("alerts.in_app_locked_cell", { event: label })
                                      : t("alerts.toggle", { channel: channelLabel(channel), event: label })
                                }
                              />
                              {notSent(event, channel) ? (
                                <span className="mt-1 block text-caption text-muted">{t("alerts.not_sent_cell")}</span>
                              ) : null}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {note ? (
                    <tr className="border-t border-line">
                      <td colSpan={2 + CHANNELS.length} className="px-3 py-2 text-caption text-muted">
                        <span className="sticky left-3 block max-w-[calc(100vw-8rem)] sm:max-w-prose">{t(note)}</span>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              );
            })}
          </table>
        </div>

        <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
          {anyDefault ? <p className="max-w-prose text-caption text-muted">{t("alerts.default_note")}</p> : null}
          {notSentCount > 0 ? (
            <p className="max-w-prose text-caption text-muted">{t("alerts.not_sent_note", { count: notSentCount })}</p>
          ) : null}
          <p className="max-w-prose text-caption text-muted">{t("alerts.nothing_dropped")}</p>
          <p className="max-w-prose text-caption text-muted">{t("alerts.escalation_precedence")}</p>
          {/*
            §2.3: "the channel a buyer arrived on is not this matrix." Outbound
            replies fan out over the channel the buyer used; this screen is
            internal notification only, and merging the two is the mistake the
            rule exists to stop.
          */}
          <p className="max-w-prose text-caption text-muted">{t("alerts.outbound_note")}</p>
          {CHANNELS.filter((channel) => !available.includes(channel)).map((channel) => (
            <p key={channel} className="max-w-prose text-caption text-warn-ink">
              {t("alerts.channel_unavailable", {
                channel: t(`alerts.channel.${channel}` as "alerts.channel.whatsapp"),
              })}
            </p>
          ))}
        </div>
      </Panel>

      <div className="grid gap-[var(--gutter)] lg:grid-cols-2">
        <Panel title={t("alerts.quiet_heading")} description={t("alerts.quiet_body")}>
          <div className="space-y-3">
            <Checkbox
              name="quietHoursEnabled"
              defaultChecked={value.quietHoursEnabled}
              label={t("alerts.quiet_enabled")}
            />
            {/*
              §5: one source for quiet hours, the acknowledgement and board 7d's
              routing skip — the Hours page. A second working week stored here
              is the contradiction that shows up first during Ramadan, with
              quiet hours running to 07:00 while the counter opened at 09:00.

              The stored window below is the fallback and only that: a supplier
              who has published no hours has no week to be outside of.
            */}
            {hours.published ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-caption text-muted">{t("alerts.quiet_source")}</p>
                <p className="text-caption text-muted">
                  {hours.closedNow ? t("alerts.quiet_shut_now") : t("alerts.quiet_open_now")}
                </p>
                <Link
                  href="/dashboard/hours"
                  className="text-caption underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {t("alerts.quiet_hours_link")}
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-caption text-warn-ink">{t("alerts.quiet_no_hours")}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="quietFromHour" className="mb-1.5 block text-body-sm text-ink">
                      {t("alerts.quiet_from")}
                    </label>
                    <Select
                      id="quietFromHour"
                      name="quietFromHour"
                      defaultValue={String(value.quietFromHour)}
                      options={HOURS}
                    />
                  </div>
                  <div>
                    <label htmlFor="quietToHour" className="mb-1.5 block text-body-sm text-ink">
                      {t("alerts.quiet_to")}
                    </label>
                    <Select
                      id="quietToHour"
                      name="quietToHour"
                      defaultValue={String(value.quietToHour)}
                      options={HOURS}
                    />
                  </div>
                </div>
                <Checkbox
                  name="quietOnSunday"
                  defaultChecked={value.quietOnSunday}
                  label={t("alerts.quiet_sunday")}
                />
              </div>
            )}
          </div>
        </Panel>

        <Panel title={t("alerts.override_heading")} description={t("alerts.override_body")}>
          <label htmlFor="highValueOverrideAed" className="mb-1.5 block text-body-sm text-ink">
            {t("alerts.override_label")}
          </label>
          <Input
            id="highValueOverrideAed"
            name="highValueOverrideAed"
            mono
            inputMode="numeric"
            placeholder=""
            defaultValue={value.highValueOverrideAed === null ? "" : String(value.highValueOverrideAed)}
            aria-describedby="override-hint"
          />
          <p id="override-hint" className="mt-1.5 text-caption text-muted">
            {t("alerts.override_none")}
          </p>
        </Panel>

        <Panel title={t("alerts.escalation_heading")} description={t("alerts.escalation_body")}>
          <label htmlFor="escalateAfterMinutes" className="mb-1.5 block text-body-sm text-ink">
            {t("alerts.escalation_minutes")}
          </label>
          <Select
            id="escalateAfterMinutes"
            name="escalateAfterMinutes"
            defaultValue={String(value.escalateAfterMinutes)}
            /*
               The same list and the same words board 7d's routing card uses.
               This screen said "120 minutes" where that one said "2 hours", for
               one stored number — a seller checking the two against each other
               had to do arithmetic to find out whether they agreed.
            */
            options={escalationOptions()}
          />
        </Panel>

        <Panel title={t("alerts.nudge_heading")} description={t("alerts.nudge_body")}>
          <div className="space-y-3">
            <Checkbox
              name="nudgeEnabled"
              defaultChecked={value.nudgeEnabled}
              label={t("alerts.nudge_enabled")}
            />
            <div>
              <label htmlFor="nudgeAfterHours" className="mb-1.5 block text-body-sm text-ink">
                {t("alerts.nudge_after")}
              </label>
              <Select
                id="nudgeAfterHours"
                name="nudgeAfterHours"
                defaultValue={String(value.nudgeAfterHours)}
                options={[12, 24, 48, 72].map((count) => ({
                  value: String(count),
                  label: t("alerts.nudge_option", { count }),
                }))}
              />
            </div>

            <div>
              <label htmlFor="billingEmail" className="mb-1.5 block text-body-sm text-ink">
                {t("alerts.billing_email_label")}
              </label>
              <Input
                id="billingEmail"
                name="billingEmail"
                type="email"
                defaultValue={value.billingEmail ?? ""}
                aria-describedby="billingEmail-hint"
              />
              <p id="billingEmail-hint" className="mt-1.5 text-caption text-muted">
                {t("alerts.billing_email_hint")}
              </p>
            </div>
          </div>
        </Panel>
      </div>

      {error ? (
        <p role="alert" className="rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink">
          {error}
        </p>
      ) : null}

      {/*
         One Save, which sticks to the bottom of the viewport once there is
         something to save — not a second button that appears beside the first.
      */}
      <div
        className={cn(
          "flex items-center justify-end gap-3",
          dirty && "sticky bottom-0 z-10 -mx-[var(--gutter)] border-t border-line bg-card px-[var(--gutter)] py-3 shadow-raised",
        )}
      >
        <p role="status" aria-live="polite" className="mr-auto text-caption text-muted">
          {dirty ? t("alerts.dirty") : null}
          {!dirty && savedAt ? (
            <StatusBadge tone="ok" size="sm" shape="chip">
              {t("alerts.saved", { when: savedAt })}
            </StatusBadge>
          ) : null}
        </p>
        <Button type="submit" loading={pending}>
          {pending ? t("alerts.saving") : t("alerts.save")}
        </Button>
      </div>
    </form>
  );
}
