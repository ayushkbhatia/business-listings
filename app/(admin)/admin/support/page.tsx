import { notFound } from "next/navigation";
import { Panel } from "@/components/structure";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { currentSession, minutesLeft, VIEW_AS_MINUTES } from "@/lib/support/view-as";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { ViewAsForm } from "./ViewAsForm";
import { start, stop } from "./actions";

/**
 * Board 12f — the support desk.
 *
 * One session at a time, capped at thirty minutes, and every one on the record
 * with its ticket. The cap is a column rather than a cookie claim: a session
 * that ends when the tab closes is not capped.
 */

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "support.view_as")) notFound();

  const [session, recent, badges] = await Promise.all([
    currentSession(seat.actor.id),
    prisma.viewAsSession.findMany({
      orderBy: { startedAt: "desc" },
      take: 20,
      select: {
        id: true,
        ticketRef: true,
        startedAt: true,
        endedAt: true,
        staff: { select: { fullName: true } },
        business: { select: { displayName: true } },
      },
    }),
    getAdminNavBadges(seat),
  ]);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/support"
      title={t("admin.support.title")}
      eyebrow={t("admin.support.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.support.meta", { count: formatCount(recent.length) })}
        </span>
      }
    >
      <div className="grid gap-[var(--gutter)] lg:grid-cols-2">
        <Panel title={t("admin.support.start")}>
          <ViewAsForm
            live={
              session
                ? {
                    business: session.business.displayName,
                    ticket: session.ticketRef,
                    minutes: minutesLeft(session.expiresAt),
                  }
                : null
            }
            start={start}
            stop={stop}
          />
          <p className="mt-3 max-w-prose text-caption text-muted">
            {t("admin.support.note", { minutes: String(VIEW_AS_MINUTES) })}
          </p>
        </Panel>

        <Panel title={t("admin.support.recent")}>
          {recent.length === 0 ? (
            <p className="text-caption text-muted">{t("admin.support.recent_empty")}</p>
          ) : (
            <ul className="flex flex-col">
              {recent.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line py-1.5 first:border-t-0"
                >
                  <span className="min-w-0 text-body-sm text-body">
                    {row.staff.fullName} · {row.business.displayName}
                  </span>
                  <span className="shrink-0 font-mono text-eyebrow text-muted">
                    {row.ticketRef} · {formatDate(row.startedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </AdminPage>
  );
}
