import Link from "next/link";
import { notFound } from "next/navigation";
import { ChipLink } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import type { DeliveryStatus, NotificationChannel, NotificationEvent } from "@/lib/db/generated/enums";
import { cn } from "@/lib/cn";
import { formatCount, formatDateTime } from "@/lib/format";
import { hasMessage, t, type MessageKey } from "@/lib/i18n";
import { CHANNELS } from "@/lib/notify/draft";
import { EVENT_PARAMS } from "@/lib/notify/params";
import { deliveryLog, LOG_STATUSES, REPORT_WINDOW_DAYS, type LogFilters } from "@/lib/notify/reports";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { NotificationTabs } from "../_tabs";
import { channelLabel } from "../present";

/**
 * Board 12g — the delivery log.
 *
 * Where the spec sends a channel outage (*"Delivery log tab, not this one"*) and
 * where a moderator answers a seller asking why they were not told. Every
 * attempt in thirty days — sent, held for quiet hours, failed, or skipped with
 * the reason — newest first, on a keyset cursor. It shows who a message was for
 * as a business or *buyer* and never as an address, because no address is on
 * the row to show.
 *
 * Test sends are left out unless asked for, the same rule every count on the
 * templates tab follows.
 */

export const dynamic = "force-dynamic";

const STATUS_INK: Record<DeliveryStatus, string> = {
  sent: "text-ok-ink",
  deferred: "text-warn-ink",
  queued: "text-warn-ink",
  failed: "text-bad-ink",
  skipped: "text-body",
};

type Search = { status?: string; channel?: string; event?: string; after?: string; tests?: string };

function readLogFilters(raw: Search): LogFilters {
  return {
    status: (LOG_STATUSES as readonly string[]).includes(raw.status ?? "") ? (raw.status as DeliveryStatus) : null,
    channel: (CHANNELS as readonly string[]).includes(raw.channel ?? "") ? (raw.channel as NotificationChannel) : null,
    event: raw.event && raw.event in EVENT_PARAMS ? (raw.event as NotificationEvent) : null,
    cursor: raw.after ?? null,
    tests: raw.tests === "1",
  };
}

function href(filters: LogFilters, change: Partial<LogFilters>): string {
  const next = { ...filters, cursor: null, ...change };
  const params = new URLSearchParams();
  if (next.status) params.set("status", next.status);
  if (next.channel) params.set("channel", next.channel);
  if (next.event) params.set("event", next.event);
  if (next.tests) params.set("tests", "1");
  if (next.cursor) params.set("after", next.cursor);
  const query = params.toString();
  return `/admin/notifications/deliveries${query ? `?${query}` : ""}`;
}

/** A reason code the platform writes has a sentence; a carrier's own detail is shown as it came. */
function reasonText(reason: string | null): { text: string; code: boolean } | null {
  if (!reason) return null;
  const key = `notifications.reason.${reason}`;
  return hasMessage(key) ? { text: t(key as MessageKey), code: false } : { text: reason, code: true };
}

export default async function DeliveriesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const seat = await requireStaff();
  if (!can(seat.actor, "notification.read")) notFound();

  const filters = readLogFilters(await searchParams);
  const [log, badges] = await Promise.all([deliveryLog(filters), getAdminNavBadges(seat)]);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/notifications"
      title={t("notifications.title")}
      eyebrow={t("notifications.eyebrow")}
      meta={
        <span className="font-mono text-eyebrow uppercase text-muted">
          {t("notifications.log.meta", { total: formatCount(log.total), days: formatCount(REPORT_WINDOW_DAYS) })}
        </span>
      }
    >
      <NotificationTabs active="deliveries" />

      <div className="mb-3 flex flex-col gap-2">
        <nav aria-label={t("notifications.log.filter_status")} className="flex flex-wrap gap-2">
          <ChipLink href={href(filters, { status: null })} selected={filters.status === null}>
            {t("notifications.log.all_statuses")}
          </ChipLink>
          {LOG_STATUSES.map((status) => (
            <ChipLink key={status} href={href(filters, { status })} selected={filters.status === status}>
              {t(`notifications.delivery.${status}` as MessageKey)}
            </ChipLink>
          ))}
        </nav>
        <nav aria-label={t("notifications.log.filter_channel")} className="flex flex-wrap gap-2">
          <ChipLink size="sm" href={href(filters, { channel: null })} selected={filters.channel === null}>
            {t("notifications.log.all_channels")}
          </ChipLink>
          {CHANNELS.map((channel) => (
            <ChipLink key={channel} size="sm" href={href(filters, { channel })} selected={filters.channel === channel}>
              {channelLabel(channel)}
            </ChipLink>
          ))}
          <ChipLink size="sm" dashed href={href(filters, { tests: !filters.tests })} selected={filters.tests}>
            {t("notifications.log.include_tests")}
          </ChipLink>
          {filters.event ? (
            <ChipLink size="sm" href={href(filters, { event: null })} selected>
              {t("notifications.log.event_filter", { event: filters.event })}
            </ChipLink>
          ) : null}
        </nav>
      </div>

      <div tabIndex={0} className="overflow-x-auto rounded-panel border border-line bg-card focus-visible:shadow-focus focus-visible:outline-none">
        <table className="w-full min-w-[56rem] border-collapse text-body-sm">
          <caption className="sr-only">{t("notifications.log.caption")}</caption>
          <thead className="bg-paper-sunk">
            <tr>
              {(["when", "event", "channel", "status", "reason", "recipient", "version"] as const).map((col) => (
                <th key={col} scope="col" className="px-3 py-2.5 text-left font-mono text-colhead font-medium uppercase text-muted first:pl-4">
                  {t(`notifications.log.col.${col}` as MessageKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {log.rows.map((row) => {
              const reason = reasonText(row.reason);
              return (
                <tr key={row.id} className="border-t border-line align-top">
                  <th scope="row" className="whitespace-nowrap py-2.5 pl-4 pr-3 text-left font-normal tabular-nums text-body">
                    {formatDateTime(row.createdAt)}
                  </th>
                  <td className="px-3 py-2.5">
                    <Link href={href(filters, { event: row.event })} className="font-mono text-caption text-ink underline-offset-2 hover:underline">
                      {row.event}
                    </Link>
                    {row.tradeKind === "services" ? (
                      <span className="mt-0.5 block text-caption text-muted">{t("notifications.log.services_brief")}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-body">{channelLabel(row.channel)}</td>
                  <td className={cn("px-3 py-2.5", STATUS_INK[row.status])}>
                    {t(`notifications.delivery.${row.status}` as MessageKey)}
                    {row.test ? <span className="mt-0.5 block text-caption text-muted">{t("notifications.log.test")}</span> : null}
                    {row.status === "deferred" && row.scheduledFor ? (
                      <span className="mt-0.5 block text-caption text-muted">
                        {t("notifications.log.until", { at: formatDateTime(row.scheduledFor) })}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-caption text-body">
                    {reason ? <span className={reason.code ? "font-mono" : undefined}>{reason.text}</span> : <span className="text-muted">{t("notifications.log.no_reason")}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-body">
                    {row.businessName && row.businessSlug ? (
                      <Link href={`/b/${row.businessSlug}`} className="underline-offset-2 hover:underline">
                        {row.businessName}
                      </Link>
                    ) : (
                      t(row.test ? "notifications.log.recipient_staff" : row.audience === "buyer" ? "notifications.log.recipient_buyer" : "notifications.log.recipient_seller")
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-caption text-body">
                    {row.templateVersion !== null
                      ? t("notifications.log.version", {
                          version: String(row.templateVersion),
                          kind: t(`notifications.kind.${row.templateKind}` as MessageKey),
                        })
                      : t("notifications.log.no_template")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {log.rows.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-body-sm text-body">{t("notifications.log.empty")}</p>
            <p className="mx-auto mt-1 max-w-prose text-caption text-muted">{t("notifications.log.empty_body")}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="text-caption text-muted">
            {t("notifications.log.showing", { shown: formatCount(log.rows.length), total: formatCount(log.total) })}
          </p>
          <div className="flex gap-2">
            {filters.cursor ? (
              <Link href={href(filters, {})} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                {t("notifications.log.newest")}
              </Link>
            ) : null}
            {log.nextCursor ? (
              <Link href={href(filters, { cursor: log.nextCursor })} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                {t("notifications.log.older")}
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </AdminPage>
  );
}
