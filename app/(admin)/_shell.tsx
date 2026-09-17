import "server-only";
import { AdminShell, AppSidebar, PageHeader, resolveNav } from "@/components/structure";
import { ADMIN_NAV } from "@/components/structure/nav-config";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { queueCount } from "@/lib/moderation/queue";
import { reportQueueHealth } from "@/lib/reports/queue";
import type { StaffSeat } from "@/lib/auth/staff";
import { t } from "@/lib/i18n";

/**
 * The staff frame, resolved once and shared by every console screen.
 *
 * Deliberately the same shape as the seller's `_shell.tsx`: same `AppSidebar`,
 * same `PageHeader`, a different nav config and a different density. Staff
 * should never have to wonder which surface they are on, and the way to get
 * that is for the two to be structurally identical and visually distinct.
 *
 * `AdminShell` has existed since handoff 0 and rendered nowhere but the gallery.
 * `app/(admin)/layout.tsx` was eight lines that set `data-density="compact"` and
 * passed children through — no actor, no auth, no shell — which has been
 * harmless only because there were no pages behind it.
 */

/**
 * The counts the sidebar shows.
 *
 * Every one is a real query. `ADMIN_NAV` used to carry `badge: 34` on the
 * queue, `3` on reports and `5` on dunning as placeholders, which is the same
 * shape of invention this project has now caught three times — in the seed's
 * response time, in its profile strength, and here. A number on a queue badge
 * is a claim about how much work is waiting, and the console exists to answer
 * exactly that question.
 *
 * A count nobody may see is not loaded: a moderator has no `revenue.read`, and
 * a badge on a row they cannot open would be telling them about work that is
 * not theirs.
 */
export async function getAdminNavBadges(seat: StaffSeat): Promise<Record<string, number>> {
  /*
     Asked of the matrix, not of role names. Board 4i `B5`: every consuming
     screen reads the same capability table, and this compared role strings —
     the one place in the console that would have kept showing a queue badge to
     a role the matrix had stopped letting open the queue.
  */
  const wanted = {
    queue: can(seat.actor, "queue.decide"),
    reports: can(seat.actor, "report.resolve"),
  };

  const [queue, reports] = await Promise.all([
    // Board 4b: every kind the queue holds, counted the way the queue counts it,
    // so the badge and the page's "All" chip are the same number.
    wanted.queue ? queueCount() : Promise.resolve(null),
    /*
       Board 4h. The badge counts what the board holds, which is supplier
       reports *and* review disputes, collapsed the way the queue collapses
       them. It counted open `supplier_report` rows alone, so the badge and the
       screen's own header disagreed on two counts at once: disputes were
       missing, and three buyers reporting one telephone number were three.
    */
    wanted.reports ? reportQueueHealth().then((health) => health.open) : Promise.resolve(null),
  ]);

  const badges: Record<string, number> = {};
  if (queue !== null) badges["queue"] = queue;
  if (reports !== null) badges["reports"] = reports;
  return badges;
}

export interface AdminPageProps {
  seat: StaffSeat;
  badges?: Readonly<Record<string, number>>;
  activeHref: string;
  title: string;
  eyebrow?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  children: React.ReactNode;
}

export function AdminPage({
  seat,
  badges,
  activeHref,
  title,
  eyebrow,
  meta,
  actions,
  breadcrumb,
  children,
}: AdminPageProps) {
  return (
    <AdminShell
      sidebar={
        <AppSidebar
          label={t("nav.label.admin")}
          groups={resolveNav(ADMIN_NAV, (key) => t(key as never), badges)}
          activeHref={activeHref}
          actor={seat.actor}
          lockedLabel={t("nav.locked")}
          laterLabel={t("nav.later")}
          /*
             Board 6f §1: the item list is a scroll region with the account
             footer pinned. The scroll region has existed since the sidebar did
             — `min-h-0 flex-1 overflow-y-auto`, focusable for the axe rule —
             and so has this slot; nothing has ever passed one, so the nav
             scrolled and the seat's identity scrolled away with it.

             It states who you are and what you hold, and nothing more. There is
             no sign-out control here: signing out is not a thing the console
             owns, and a button that looked like one and was not would be worse
             than its absence.
          */
          footer={
            <div className="flex flex-col gap-0.5">
              <span className="truncate text-caption text-on-ink">{seat.name}</span>
              <span className="font-mono text-eyebrow uppercase text-on-ink-muted">
                {seat.roles.map((role) => t(`staff.role.${role}` as never)).join(" · ")}
              </span>
            </div>
          }
          mark={
            <span className="flex items-center gap-2">
              <span className="font-serif text-h3 text-on-ink">Business Listings</span>
              {/*
                The one visual tell that this is the console and not the
                dashboard. Mono, uppercase, on ink — not a badge tone, because
                a tone here would be borrowing the trust palette to say
                something about a person's job.
              */}
              <span className="rounded-tag bg-moss-on-ink px-1.5 py-px font-mono text-eyebrow uppercase text-moss-on-ink-text">
                {t("admin.mark")}
              </span>
            </span>
          }
        />
      }
      header={
        <PageHeader
          title={title}
          {...(eyebrow ? { eyebrow } : {})}
          {...(meta ? { meta } : {})}
          {...(actions ? { actions } : {})}
          {...(breadcrumb ? { breadcrumb } : {})}
        />
      }
    >
      {children}
    </AdminShell>
  );
}
