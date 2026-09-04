import "server-only";
import { AdminShell, AppSidebar, PageHeader, resolveNav } from "@/components/structure";
import { ADMIN_NAV } from "@/components/structure/nav-config";
import { prisma } from "@/lib/db/client";
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
  const wanted = {
    queue: seat.actor.roles.some((r) => r === "staff_moderator" || r === "staff_ops_lead"),
    reports: seat.actor.roles.some((r) => r === "staff_moderator" || r === "staff_ops_lead"),
  };

  const [queue, reports] = await Promise.all([
    wanted.queue
      ? prisma.listingChangeRequest.count({ where: { status: "pending" } })
      : Promise.resolve(null),
    wanted.reports
      ? prisma.supplierReport.count({ where: { outcome: null } })
      : Promise.resolve(null),
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
