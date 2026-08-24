"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Input, Select } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { StatusBadge } from "@/components/display/StatusBadge";
import { t } from "@/lib/i18n";
import { saveAlerts } from "./actions";
import { CHANNELS, EVENTS } from "./matrix";

/**
 * Board 7e — the seller's control panel for their own alerts.
 *
 * A real table. The matrix is events down and channels across, which is
 * tabular data with a header in both directions, and a grid of divs would cost
 * the row-and-column association that makes it readable aloud.
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
}

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: t("alerts.quiet_hour", { hour: String(hour).padStart(2, "0") }),
}));

export function AlertsForm({
  value,
  whatsappPending,
}: {
  value: AlertsValue;
  whatsappPending: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await saveAlerts(formData);
          if (result.ok) {
            setSavedAt(new Date().toLocaleTimeString("en-AE", { hour: "2-digit", minute: "2-digit" }));
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

        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-left">
            <caption className="sr-only">{t("alerts.matrix_caption")}</caption>
            <thead>
              <tr className="bg-paper-sunk">
                <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                  {t("alerts.col.event")}
                </th>
                {CHANNELS.map((channel) => (
                  <th
                    key={channel}
                    scope="col"
                    className="w-24 px-3 py-2 text-caption font-normal text-muted"
                  >
                    {t(`alerts.channel.${channel}` as "alerts.channel.whatsapp")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EVENTS.map((event) => {
                const on = value.routing[event] ?? [];
                const eventLabel = t(`alerts.event.${event}` as "alerts.event.enquiry_received");
                return (
                  <tr key={event} className="border-t border-line">
                    <th scope="row" className="px-3 py-2 text-left text-body-sm font-normal text-ink">
                      {eventLabel}
                    </th>
                    {CHANNELS.map((channel) => (
                      <td key={channel} className="px-3 py-2">
                        <Checkbox
                          name={`matrix.${event}.${channel}`}
                          defaultChecked={on.includes(channel)}
                          /* Named per cell: "WhatsApp for a new enquiry
                             arrives" is what a screen reader should say, not
                             "checkbox" forty times. */
                          aria-label={t("alerts.toggle", {
                            channel: t(`alerts.channel.${channel}` as "alerts.channel.whatsapp"),
                            event: eventLabel,
                          })}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
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
            options={[30, 60, 120, 240, 480].map((count) => ({
              value: String(count),
              label: t("alerts.escalation_option", { count }),
            }))}
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
          </div>
        </Panel>
      </div>

      {error ? (
        <p role="alert" className="rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        {savedAt ? (
          <StatusBadge tone="ok" size="sm" shape="chip">
            {t("alerts.saved", { when: savedAt })}
          </StatusBadge>
        ) : null}
        <Button type="submit" loading={pending}>
          {pending ? t("alerts.saving") : t("alerts.save")}
        </Button>
      </div>
    </form>
  );
}
