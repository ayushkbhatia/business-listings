import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import type { NotificationChannel, NotificationEvent } from "@/lib/db/generated/enums";
import { t } from "@/lib/i18n";
import { sortRows, templateBoard, templateDetail } from "@/lib/notify/templates";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { NotificationTabs } from "./_tabs";
import { presentBoard, presentDetail, readFilters } from "./present";
import { TemplateList } from "./TemplateList";
import { TemplateRail } from "./TemplateRail";

/**
 * Board 12g — notification templates.
 *
 * The messages the platform sends, one row per event and channel, ordered by
 * what was actually sent in thirty days; one open beside the list with its
 * versions, its variables and — on WhatsApp — the Meta queue. Every number on
 * the page is a query (`B1`), and `FIRED BY` and `SERVICES TWIN` are read from
 * the code and the rows rather than typed.
 *
 * Ops lead and moderator read it (`notification.read`); only an ops lead
 * writes (`notification.template.write`), and the rail says so rather than
 * rendering controls that refuse on submit.
 */

export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; sort?: string; t?: string; line?: string }>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "notification.read")) notFound();
  const canWrite = can(seat.actor, "notification.template.write");

  const now = new Date();
  const filters = readFilters(await searchParams);
  const [board, badges] = await Promise.all([templateBoard(now), getAdminNavBadges(seat)]);
  const sorted = sortRows(board.rows, filters.sort);

  /*
     The open template: the one asked for, or the first row the list shows —
     *"as drawn, new_rfq_to_seller open"* — so the rail is never an empty column
     on arrival. A key the board does not hold opens nothing rather than a 404:
     a stale link from yesterday's log is not an error.
  */
  const shown = filters.channel === "all" ? sorted : sorted.filter((row) => row.channel === filters.channel);
  const openRow = (filters.open && board.rows.find((row) => `${row.event}.${row.channel}` === filters.open)) || shown[0] || null;
  // A twin is only asked of a goods body. `?line=services` on a neutral one opens the body itself.
  const line = openRow && openRow.twin !== "neutral" && openRow.twin !== "no_body" ? filters.line : "primary";
  const effective = { ...filters, line, open: openRow ? `${openRow.event}.${openRow.channel}` : null };
  const detail = openRow
    ? await templateDetail(openRow.event as NotificationEvent, openRow.channel as NotificationChannel, effective.line)
    : null;
  const detailView = detail && openRow ? presentDetail(detail, effective, now, openRow.volume.servicesInGoodsWording) : null;
  const view = presentBoard(board, effective, sorted);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/notifications"
      title={t("notifications.title")}
      eyebrow={t("notifications.eyebrow")}
      meta={<span className="font-mono text-eyebrow uppercase text-muted">{view.meta}</span>}
    >
      <NotificationTabs active="templates" />

      <div className="grid items-start gap-[var(--gutter)] board:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <TemplateList view={view} filters={effective} />

        {detail && detailView ? (
          <TemplateRail
            /*
               Remount on a different template or line, not on a save: the save's
               own confirmation lives in the editor, and a remount keyed on the new
               version would clear it the instant it arrived.
            */
            key={`${detailView.key}.${detailView.line}`}
            view={detailView}
            seed={detail.seed}
            origin={detail.origin}
            canWrite={canWrite}
          />
        ) : (
          <div className="rounded-panel border border-line bg-card p-4">
            <p className="text-body-sm text-body">{t("notifications.rail.none")}</p>
            <p className="mt-1 text-caption text-muted">
              <Link href="/admin/notifications/deliveries" className="underline underline-offset-2">
                {t("notifications.rail.none_log")}
              </Link>
            </p>
          </div>
        )}
      </div>
    </AdminPage>
  );
}
