import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { cn } from "@/lib/cn";
import { formatCount, formatDateTime } from "@/lib/format";
import { hasMessage, t, type MessageKey } from "@/lib/i18n";
import { channelHealth, REPORT_WINDOW_DAYS } from "@/lib/notify/reports";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { NotificationTabs } from "../_tabs";
import { channelLabel } from "../present";

/**
 * Board 12g — the channels: what carries each one in this deployment, and
 * what it did in thirty days.
 *
 * The carrier column is the sender `resolveNotificationSenders()` returned for
 * this process — not a setting and not a claim — so "no carrier" here means a
 * message on that channel is recorded as skipped, which is what SMS is in
 * production until a carrier exists. No key, address or provider response
 * body appears; a failure shows the detail the sender wrote for staff.
 */

export const dynamic = "force-dynamic";

function carrierText(carrier: string | null): string {
  if (!carrier) return t("notifications.carrier.none");
  const base = carrier.startsWith("console:") ? "console" : carrier;
  const key = `notifications.carrier.${base}`;
  return hasMessage(key) ? t(key as MessageKey) : carrier;
}

function reasonText(reason: string): string {
  const key = `notifications.reason.${reason}`;
  return hasMessage(key) ? t(key as MessageKey) : reason;
}

export default async function ChannelsPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "notification.read")) notFound();
  const [{ channels }, badges] = await Promise.all([channelHealth(), getAdminNavBadges(seat)]);
  const carried = channels.filter((c) => c.carrier !== null).length;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/notifications"
      title={t("notifications.title")}
      eyebrow={t("notifications.eyebrow")}
      meta={
        <span className="font-mono text-eyebrow uppercase text-muted">
          {t("notifications.channels.meta", { carried: formatCount(carried), channels: formatCount(channels.length) })}
        </span>
      }
    >
      <NotificationTabs active="channels" />

      <div className="overflow-x-auto rounded-panel border border-line bg-card">
        <table className="w-full min-w-[52rem] border-collapse text-body-sm">
          <caption className="sr-only">{t("notifications.channels.caption", { days: formatCount(REPORT_WINDOW_DAYS) })}</caption>
          <thead className="bg-fill">
            <tr>
              {(["channel", "carrier", "sent", "held", "failed", "skipped", "last_failure"] as const).map((col) => (
                <th
                  key={col}
                  scope="col"
                  className={cn(
                    "px-3 py-2.5 font-mono text-eyebrow font-normal uppercase text-faint first:pl-4",
                    col === "sent" || col === "held" || col === "failed" || col === "skipped" ? "text-right" : "text-left",
                  )}
                >
                  {t(`notifications.channels.col.${col}` as MessageKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map((row) => (
              <tr key={row.channel} className="border-t border-line align-top">
                <th scope="row" className="py-3 pl-4 pr-3 text-left font-normal text-ink">
                  {channelLabel(row.channel)}
                </th>
                <td className={cn("px-3 py-3", row.carrier ? "text-body" : "text-bad-ink")}>{carrierText(row.carrier)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-ink">{formatCount(row.sent)}</td>
                <td className="px-3 py-3 text-right tabular-nums text-body">{formatCount(row.deferred)}</td>
                <td className={cn("px-3 py-3 text-right tabular-nums", row.failed > 0 ? "text-bad-ink" : "text-body")}>
                  {row.failed > 0 ? (
                    <Link href={`/admin/notifications/deliveries?status=failed&channel=${row.channel}`} className="underline underline-offset-2">
                      {formatCount(row.failed)}
                    </Link>
                  ) : (
                    formatCount(row.failed)
                  )}
                </td>
                <td className="px-3 py-3 text-right text-body">
                  <span className="block tabular-nums">{formatCount(row.skipped)}</span>
                  {row.topSkips.length > 0 ? (
                    <ul className="mt-1 flex flex-col gap-0.5 text-caption text-muted">
                      {row.topSkips.map((skip) => (
                        <li key={skip.reason}>
                          {t("notifications.channels.skip", { reason: reasonText(skip.reason), count: formatCount(skip.count) })}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-caption text-body">
                  {row.lastFailure ? (
                    <>
                      <span className="block tabular-nums">{formatDateTime(row.lastFailure.at)}</span>
                      <span className="block text-muted">{row.lastFailure.reason ? reasonText(row.lastFailure.reason) : t("notifications.log.no_reason")}</span>
                    </>
                  ) : (
                    <span className="text-muted">{t("notifications.channels.never_failed")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line px-4 py-3 text-caption text-muted">
          {t("notifications.channels.note", { days: formatCount(REPORT_WINDOW_DAYS) })}
        </p>
      </div>
    </AdminPage>
  );
}
