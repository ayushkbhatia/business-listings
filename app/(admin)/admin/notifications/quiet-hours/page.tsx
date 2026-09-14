import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import type { NotificationEvent } from "@/lib/db/generated/enums";
import { formatCount, formatDateTime } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { quietReport } from "@/lib/notify/reports";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { NotificationTabs } from "../_tabs";
import { channelLabel, channelWord } from "../present";

/**
 * Board 12g — quiet hours, as the platform applies them.
 *
 * Read-only on purpose. A seller's window is theirs, on board 7e, and follows
 * their published hours where they have any; a buyer's is the platform default
 * in `routing.ts`, which no screen edits because no buyer has asked for one.
 * This tab states both, counts how sellers have set theirs, and says what is
 * being held right now — so "why did this arrive at seven" has an answer on
 * the console rather than in the code.
 */

export const dynamic = "force-dynamic";

const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-line py-2.5 first:border-t-0">
      <dt className="text-body-sm text-body">
        {label}
        {note ? <span className="block text-caption text-muted">{note}</span> : null}
      </dt>
      <dd className="m-0 text-body-sm tabular-nums text-ink">{value}</dd>
    </div>
  );
}

export default async function QuietHoursPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "notification.read")) notFound();
  const [report, badges] = await Promise.all([quietReport(), getAdminNavBadges(seat)]);
  const { sellers, buyer, held, floor } = report;

  const buyerEvents = Object.entries(buyer.matrix) as [NotificationEvent, readonly string[]][];

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/notifications"
      title={t("notifications.title")}
      eyebrow={t("notifications.eyebrow")}
      meta={
        <span className="font-mono text-eyebrow uppercase text-muted">
          {t("notifications.quiet.meta", { held: formatCount(held.count) })}
        </span>
      }
    >
      <NotificationTabs active="quiet" />

      <div className="grid items-start gap-[var(--gutter)] lg:grid-cols-2">
        <section aria-labelledby="quiet-sellers" className="rounded-panel border border-line bg-card p-4">
          <h2 id="quiet-sellers" className="font-mono text-eyebrow font-normal uppercase text-faint">
            {t("notifications.quiet.sellers_title")}
          </h2>
          <p className="mt-2 max-w-prose text-body-sm text-body">{t("notifications.quiet.sellers_body")}</p>
          <dl className="mt-3">
            <Stat label={t("notifications.quiet.preferences")} value={formatCount(sellers.preferences)} />
            <Stat label={t("notifications.quiet.enabled")} value={formatCount(sellers.enabled)} note={t("notifications.quiet.enabled_note")} />
            <Stat label={t("notifications.quiet.follow_hours")} value={formatCount(sellers.followHours)} note={t("notifications.quiet.follow_hours_note")} />
            <Stat label={t("notifications.quiet.standard")} value={formatCount(sellers.standardWindow)} />
            <Stat label={t("notifications.quiet.custom")} value={formatCount(sellers.customWindow)} />
            <Stat label={t("notifications.quiet.sunday")} value={formatCount(sellers.sundayQuiet)} />
            <Stat label={t("notifications.quiet.override_never")} value={formatCount(sellers.overrideNever)} note={t("notifications.quiet.override_note")} />
          </dl>
        </section>

        <div className="flex flex-col gap-[var(--gutter)]">
          <section aria-labelledby="quiet-buyers" className="rounded-panel border border-line bg-card p-4">
            <h2 id="quiet-buyers" className="font-mono text-eyebrow font-normal uppercase text-faint">
              {t("notifications.quiet.buyers_title")}
            </h2>
            <p className="mt-2 max-w-prose text-body-sm text-body">
              {t(buyer.onSunday ? "notifications.quiet.buyers_body_sunday" : "notifications.quiet.buyers_body", {
                from: hour(buyer.fromHour),
                to: hour(buyer.toHour),
              })}
            </p>
            <table className="mt-3 w-full border-collapse text-body-sm">
              <caption className="sr-only">{t("notifications.quiet.buyers_caption")}</caption>
              <thead>
                <tr className="text-left">
                  <th scope="col" className="py-2 font-mono text-eyebrow font-normal uppercase text-faint">{t("notifications.quiet.col.event")}</th>
                  <th scope="col" className="py-2 font-mono text-eyebrow font-normal uppercase text-faint">{t("notifications.quiet.col.channels")}</th>
                </tr>
              </thead>
              <tbody>
                {buyerEvents.map(([event, channels]) => (
                  <tr key={event} className="border-t border-line">
                    <th scope="row" className="py-2 text-left font-mono text-caption font-normal text-ink">{event}</th>
                    <td className="py-2 text-body">{channels.map((c) => channelLabel(c as never)).join(t("notifications.and"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="quiet-floor" className="rounded-panel border border-line bg-card p-4">
            <h2 id="quiet-floor" className="font-mono text-eyebrow font-normal uppercase text-faint">
              {t("notifications.quiet.floor_title")}
            </h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {(Object.entries(floor) as [NotificationEvent, readonly string[]][]).map(([event, channels]) => (
                <li key={event} className="text-body-sm text-body">
                  {t("notifications.quiet.floor_row", {
                    event: t(`notifications.floor_title.${event}` as MessageKey),
                    channels: channels.map((c) => channelWord(c as never)).join(t("notifications.and")),
                  })}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-caption text-muted">{t("notifications.quiet.floor_note")}</p>
          </section>

          <section aria-labelledby="quiet-held" className="rounded-panel border border-line bg-card p-4">
            <h2 id="quiet-held" className="font-mono text-eyebrow font-normal uppercase text-faint">
              {t("notifications.quiet.held_title")}
            </h2>
            <p className="mt-2 text-body-sm text-body">
              {held.count === 0
                ? t("notifications.quiet.held_none")
                : t("notifications.quiet.held_body", {
                    count: formatCount(held.count),
                    next: held.nextRelease ? formatDateTime(held.nextRelease) : t("notifications.quiet.held_unscheduled"),
                  })}
            </p>
            {held.count > 0 ? (
              <p className="mt-2 text-caption">
                <Link href="/admin/notifications/deliveries?status=deferred" className="text-moss underline underline-offset-2">
                  {t("notifications.quiet.held_link")}
                </Link>
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </AdminPage>
  );
}
