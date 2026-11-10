import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import type { NotificationChannel, NotificationEvent } from "@/lib/db/generated/enums";
import { t } from "@/lib/i18n";
import { COVERAGE_CHANNELS, coverageGrid } from "@/lib/notify/coverage";
import { EVENT_AUDIENCE } from "@/lib/notify/params";
import { sortRows, templateBoard, templateDetail } from "@/lib/notify/templates";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { NotificationTabs } from "./_tabs";
import { CoverageGrid } from "./CoverageGrid";
import { presentBoard, presentCoverage, presentDetail, readFilters } from "./present";
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
  const listed = filters.open ? board.rows.find((row) => `${row.event}.${row.channel}` === filters.open) : undefined;
  /*
     T7.1 — a pair the list does not hold. The coverage grid links every cell
     here, including the ones with no template at all, and the editor opens on
     them in its create mode (`templateDetail` answers a pair with no rows). It
     used to fall through to the first row, so *Write first version* opened some
     other template's editor — the gap could be seen and not fixed.
  */
  const unlisted = !listed && filters.open ? openablePair(filters.open) : null;
  const openRow = listed ?? (unlisted ? null : (shown[0] ?? null));
  const target = openRow
    ? { event: openRow.event, channel: openRow.channel, twin: openRow.twin, servicesInGoods: openRow.volume.servicesInGoodsWording }
    : unlisted
      ? { ...unlisted, twin: "no_body" as const, servicesInGoods: 0 }
      : null;
  // A twin is only asked of a goods body. `?line=services` on a neutral one opens the body itself.
  const line = target && target.twin !== "neutral" && target.twin !== "no_body" ? filters.line : "primary";
  const effective = { ...filters, line, open: target ? `${target.event}.${target.channel}` : null };
  const detail = target ? await templateDetail(target.event, target.channel, effective.line) : null;
  const detailView = detail && target ? presentDetail(detail, effective, now, target.servicesInGoods) : null;
  const view = presentBoard(board, effective, sorted);
  const coverage = presentCoverage(coverageGrid(board.rows), effective, canWrite);

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

      <CoverageGrid view={coverage} />

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

/** An `event.channel` the grid can link to: a declared event on a channel still offered. */
function openablePair(open: string): { event: NotificationEvent; channel: NotificationChannel } | null {
  const [event, channel] = open.split(".") as [string, string];
  if (!(event in EVENT_AUDIENCE)) return null;
  if (!(COVERAGE_CHANNELS as readonly string[]).includes(channel)) return null;
  return { event: event as NotificationEvent, channel: channel as NotificationChannel };
}
